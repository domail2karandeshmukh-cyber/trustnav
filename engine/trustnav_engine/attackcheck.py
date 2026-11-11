"""Real attack check: replay recordings of real jamming and real spoofing through the detector.

    python -m trustnav_engine.attackcheck --out ../paper/figures/attackcheck.json ../dashboard/public/data/attackcheck.json

The recordings are the University of Vaasa's VAARA dataset, made at Jammertest 2024
(Andøya, Norway, 10 to 12 September 2024), an open-air test run by the Norwegian
authorities where jammers and spoofers transmit under licence. Nothing is transmitted
here: the files are downloaded once from the dataset's public repository (pinned to one
commit, checked against their SHA-256) into data/vaara/, which is not committed.

    https://github.com/UniVaasaDigiEco/VAARA

Two sessions are replayed, with the test times from the dataset's own metadata:

A. 11 September, morning. A spoofer in a vehicle of a motorcade (tests 2.6.1 to 2.6.3).
   One car carried a u-blox receiver and a phone logging NMEA with its own system clock
   next to every sentence. The spoofer captured the phone: its satellite time went back
   by about an hour, and when the car drove off the phone kept reporting the parked
   position. It did not capture the u-blox, which lost 20 dB of signal but kept the true
   position; its track is therefore the reference, second by second.
B. 10 September. The same u-blox driving past parked cars with multi-band jammers
   (test 1.10.6, four runs) and starting inside a jammed area (1.10.3 and 1.10.4).

What is measured (all numbers go to the JSON file):

1. the phone, session A: when the capture begins (first second its position is more than
   20 m from the reference), when each detector configuration first alerts, how many of
   the captured seconds are refused, how far the reported position ends from the truth
   and how far the response layer's estimate does (with the reference's speed standing in
   for the odometer and its track for the route, so this last figure is a best case),
   and the alerts on the clean part of the morning;
2. the u-blox, both sessions: alerts while a spoofer or a jammer was on the air, alerts on
   the declared no-test interval and outside every test, for the rules alone and for the
   hybrid with the model re-calibrated on clean driving of the same receiver.

Detector configurations for the phone, each adding one witness:
    published    the 15 rules of version 2.1, the phone's stream alone
    + odometer   the same, with the car's speed as the odometer (speed-mismatch rule)
    + time       the 16th rule: receiver time against the host clock (the phone's own)
    + model      the hybrid, model re-calibrated on the phone's clean first hour
"""

import argparse
import bisect
import copy
import hashlib
import json
import lzma
import math
import re
import statistics
import urllib.request
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from . import receiver as rx
from .demo_feed import chosen_settings
from .features import FeatureExtractor
from .geo import haversine_m
from .model import AnomalyModel
from .pipeline import Detector
from .realcheck import alert_stats, episodes
from .routes import Route

HERE = Path(__file__).parent
CACHE = HERE / "data" / "vaara"
REPO = "https://github.com/UniVaasaDigiEco/VAARA"
COMMIT = "51b5f9cca4af6894d264803cf0a070f6107272f8"
RAW = f"https://raw.githubusercontent.com/UniVaasaDigiEco/VAARA/{COMMIT}/"
FILES = {   # name -> (path in the repository, SHA-256 of the file as published)
    "tests": ("Jammertest_metadata.json", "30aee8494e3d7b558bc3447cf6f26eba9e791a5a877a68bace1cd3090c66c119"),
    "a_ublox": ("2024-09-11/Morning_Motorcade/Test_1/ublox_2024-09-11T075704.ubx.xz", "fd411641dc8465e79230f01557dbf5e8d45f42e74cfa7f2a95e21077270113cd"),
    "a_phone": ("2024-09-11/Morning_Motorcade/Test_1/mobile2/gnss_log_2024_09_11_09_35_21.nmea", "b63ef1a76afe1a39b74a5f496d0aaa064861efe4a9b7e8a06c5b336a78b178fd"),
    "a_phone_other": ("2024-09-11/Morning_Motorcade/Test_1/mobile1/nmea.csv", "dd54ed61184e6a6ffc4b1c2a7ffd82839deefa516fb28a6e6edc5a30ae8f0f88"),
    "b_ublox_1": ("2024-09-10/Test_1/ublox_2024-09-10T073207Z0000.ubx.xz", "f7ab840e405d8014e7ebd40851f64fdcb466d89db11d7757c160c599b8ea8cc0"),
    "b_ublox_2": ("2024-09-10/Test_2/ublox_2024-09-10T115512Z0000.ubx.xz", "4cc1f69b9bfe0558b6b57322bc17f1ad0847607fca8e9fe248041ac9eed9552d"),
}

CAPTURED_M = 20.0        # the phone counts as captured while its position is this far from the reference
MARGIN_S = 180           # seconds around a declared test that are neither attack nor clean
COLLAPSE_DB = 10.0       # "signal collapsed": mean C/N0 this far under the receiver's clean median
ISO = "%Y-%m-%dT%H:%M:%SZ"


# ------------------------------------------------------------------ files --------------------

def fetch(name, cache=CACHE):
    """Local path of a dataset file: downloaded once, verified, decompressed if it is .xz."""
    rel, sha = FILES[name]
    cache.mkdir(parents=True, exist_ok=True)
    local = cache / rel.replace("/", "__")
    if not local.exists() or hashlib.sha256(local.read_bytes()).hexdigest() != sha:
        print("downloading", rel)
        with urllib.request.urlopen(RAW + rel, timeout=300) as r:
            data = r.read()
        if hashlib.sha256(data).hexdigest() != sha:
            raise SystemExit(f"{rel}: checksum mismatch, the dataset changed; nothing was replayed")
        local.write_bytes(data)
    if local.suffix == ".xz":
        plain = local.with_suffix("")
        if not plain.exists():
            plain.write_bytes(lzma.decompress(local.read_bytes()))
        return plain
    return local


def cached(name, loader):
    """Parsed observations of a dataset file, kept beside it so a second run does not parse 80 MB again."""
    path = fetch(name)
    side = path.with_name(path.name + ".obs.json")
    if side.exists():
        return json.loads(side.read_text())
    obs = loader(path)
    side.write_text(json.dumps(obs))
    return obs


def epoch(t):
    return datetime.strptime(t, ISO).replace(tzinfo=timezone.utc).timestamp()


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime(ISO)


def load_tests(path):
    """The dataset's test log -> [{test, name, start, end}] in epoch seconds (UTC)."""
    out = []
    for x in json.loads(Path(path).read_text())["Tests"]:
        s, e = (datetime.strptime(x[k], "%Y-%m-%dT%H%M%S").replace(tzinfo=timezone.utc).timestamp() for k in ("start_utc", "end_utc"))
        out.append({"test": x["test"], "name": x["name"], "start": s, "end": e, "none": x["test"] == "0.0.1"})
    return out


# ------------------------------------------------------------------ loaders ------------------

def ublox_observations(path):
    """A u-blox log (NMEA mixed with binary) as one observation per second: seconds before the
    receiver knows the time are dropped, and a 2 Hz log is thinned to its whole seconds."""
    out, last = [], None
    for o in rx.observations(rx.iter_bytes_from_file(str(path))):
        if o["time_unknown"] or o["t"] == last:
            continue
        last = o["t"]
        o["seq"] = len(out)
        out.append(o)
    return out


GNSSLOGGER = re.compile(r"^(?:NMEA,)?(\$[^*]+\*[0-9A-Fa-f]{2})(?:,(\d{13}))?$")


def phone_observations(path):
    """An Android GnssLogger NMEA log. Each sentence carries the phone's system clock in
    milliseconds; that clock, set by the network and not by the satellites, is the host
    clock of the observation (host_t), so the receiver's own time can be checked against it."""
    eb, host, out = rx.EpochBuilder(), None, []

    def keep(o):
        if o is None or host is None:
            return
        o["host_t"] = host / 1000.0
        if o["time_unknown"]:
            o["t"] = iso(o["host_t"])
        o["seq"] = len(out)
        out.append(o)

    with open(path, "rb") as fh:
        for raw in fh:
            m = GNSSLOGGER.match(raw.decode("ascii", "ignore").strip())
            p = rx.parse_nmea(m.group(1)) if m else None
            if not p:
                continue
            keep(eb.feed(*p))
            if m.group(2):
                host = int(m.group(2))
    keep(eb.finish())
    return out


# ------------------------------------------------------------------ pieces -------------------

def reference(obs):
    """Second -> (lat, lon, speed) from a receiver taken as the truth."""
    return {int(epoch(o["t"])): (o["lat"], o["lon"], o["speed_mps"]) for o in obs if o["lat"] is not None}


def ref_at(ref, ts):
    k = int(round(ts))
    for d in (0, -1, 1):
        if k + d in ref:
            return ref[k + d]
    return None


def route_of(ref, min_step_m=3.0):
    pts, last = [], None
    for k in sorted(ref):
        p = ref[k][:2]
        if last is None or haversine_m(*last, *p) >= min_step_m:
            pts.append(p)
            last = p
    return Route("vaara_reference", "Reference track of the recorded drive", pts, "real")


def state(ts, tests):
    """'attack', 'none' (declared no-test interval), 'margin' or 'clean' for one second."""
    for x in tests:
        if x["start"] <= ts <= x["end"]:
            return "none" if x["none"] else "attack"
    for x in tests:
        if not x["none"] and x["start"] - MARGIN_S <= ts <= x["end"] + MARGIN_S:
            return "margin"
    return "clean"


def feature_rows(obs, settings, route=None):
    """(index, feature row) for every observation the model can score."""
    fx = FeatureExtractor(route, settings.rolling_window, settings.rules.osnma_lost_memory_s)
    out = []
    for i, o in enumerate(obs):
        f, ctx = fx.update(o)
        if ctx["window_full"] and ctx["has_fix"]:
            out.append((i, f))
    return out


def fit_model(obs, settings, route, name):
    """Re-calibrate the anomaly model on a run of clean observations recorded before any test:
    alternate minutes fit it and calibrate it, so both see the parked and the driving part."""
    rows = feature_rows(obs, settings, route)
    fit = [f for i, f in rows if (i // 60) % 2 == 0]
    cal = [f for i, f in rows if (i // 60) % 2 == 1]
    return AnomalyModel().fit(fit, cal, name), {"fit_rows": len(fit), "calibration_rows": len(cal)}


def replay(obs, model, settings, route=None):
    """Every observation through the detector; the model's scores are computed in one batch."""
    det = Detector(model, route, "generic_road_vehicle", settings, "RX-REAL", "receiver")
    pre = {}
    if model is not None:
        rows = feature_rows(obs, settings, route)
        if rows:
            risks, tails = model.score([f for _, f in rows])
            pre = {i: (r, t) for (i, _), r, t in zip(rows, risks, tails)}
    return [det.process(o, *pre.get(i, (None, None)))[0] for i, o in enumerate(obs)]


def alerted(f):
    return (f["hr"] or 0) >= 50


def refused(f):
    return f["resp"]["mode"] != "accept"


def summary(frames, idx):
    """Alert statistics over a subset of frame indices."""
    al = [i for i in idx if alerted(frames[i])]
    hours = max(len(idx), 1) / 3600.0
    return {"seconds": len(idx), "alert_seconds": len(al), "alert_share": round(len(al) / max(len(idx), 1), 3),
            "alert_seconds_per_hour": round(len(al) / hours, 1), "alert_episodes": len(episodes(al)),
            "min_trust": min((frames[i]["trust"] for i in idx), default=None)}


# ------------------------------------------------------------------ session A: the phone ----

def phone_session(tests, settings, verbose=True):
    ub = cached("a_ublox", ublox_observations)
    ph = cached("a_phone", phone_observations)
    ref = reference(ub)
    route = route_of(ref)

    # the phone's fixes lag its clock by a constant (the time a sentence takes to reach the log)
    lag = statistics.median(epoch(o["t"]) - o["host_t"] for o in ph[:600] if not o["time_unknown"])
    truth = [ref_at(ref, o["host_t"] + lag) for o in ph]
    err = [None if (o["lat"] is None or r is None) else haversine_m(o["lat"], o["lon"], r[0], r[1]) for o, r in zip(ph, truth)]
    st = [state(o["host_t"], tests) for o in ph]

    # calibration: everything the phone logged before the first test of the day (less the margin)
    first_test = min(x["start"] for x in tests if x["start"] > ph[0]["host_t"] and not x["none"])
    n_cal = next(i for i, o in enumerate(ph) if o["host_t"] >= first_test - MARGIN_S)

    # capture: from the first run of five fixes in a row more than CAPTURED_M from the reference,
    # to the last fix of that unbroken run of wrong positions
    cap0 = next(i for i in range(n_cal, len(ph) - 5) if all(e is not None and e > CAPTURED_M for e in err[i:i + 5]))
    cap1 = cap0
    while cap1 + 1 < len(ph) and (err[cap1 + 1] is None or err[cap1 + 1] > CAPTURED_M) and ph[cap1 + 1]["host_t"] - ph[cap0]["host_t"] < 3600:
        cap1 += 1
    while err[cap1] is None:
        cap1 -= 1
    captured = [i for i in range(cap0, cap1 + 1) if err[i] is not None]
    clean = [i for i in range(n_cal, cap0) if st[i] == "clean"]
    no_test = [i for i, x in enumerate(st) if x == "none" and err[i] is not None]
    lie = [i for i in range(n_cal, len(ph)) if err[i] is not None and err[i] > 50.0]

    def with_odometer(obs):
        out = copy.deepcopy(obs)
        for o, r in zip(out, truth):
            o["imu_speed_mps"] = None if r is None else r[2]
        return out

    def every_second(obs):
        """The stream as a vehicle's gateway sees it: one observation a second on its own clock, the odometer
        always there, the receiver silent in the seconds the phone logged nothing."""
        out, where, k = [], {}, 0
        for sec in range(int(obs[0]["host_t"]), int(obs[-1]["host_t"]) + 1):
            while k < len(obs) and int(obs[k]["host_t"]) < sec:
                k += 1
            r = ref_at(ref, sec + lag)
            if k < len(obs) and int(obs[k]["host_t"]) == sec:
                o = copy.deepcopy(obs[k])
                j = k
                while j < len(obs) and int(obs[j]["host_t"]) == sec:      # two fixes logged in one second share it
                    where[j] = len(out)
                    j += 1
            else:
                o = {"t": iso(sec), "host_t": float(sec), "time_unknown": True, "lat": None, "lon": None, "speed_mps": None, "heading_deg": None,
                     "sats": None, "cn0_mean_dbhz": None, "cn0_std_dbhz": None, "pdop": None, "osnma": "unknown", "attack": None, "attack_kind": None}
            o["seq"], o["imu_speed_mps"] = len(out), None if r is None else r[2]
            out.append(o)
        return out, where

    v21 = replace(settings, rules=replace(settings.rules, time_jump_s=float("inf")))      # the rules as published
    no_host = [{k: v for k, v in o.items() if k != "host_t"} for o in ph]
    model, rows = fit_model(ph[:n_cal], settings, None, "VAARA mobile2, before the first test of 11 September 2024")
    grid, where = every_second(ph)
    grid_frames = replay(grid, None, settings, route)
    configs = [
        ("published", "The 15 rules of version 2.1, the phone's stream alone", replay(no_host, None, v21)),
        ("odometer", "The same, with the car's speed as the odometer", replay(with_odometer(no_host), None, v21)),
        ("hybrid_v21", "The 15 rules and the model re-calibrated on the phone's first 28 minutes", replay(no_host, model, v21)),
        ("time", "The 16 rules: receiver time is checked against the phone's own clock", replay(ph, None, settings)),
        ("hybrid", "The 16 rules and the re-calibrated model", replay(ph, model, settings)),
        ("full", "The 16 rules with the odometer and the route, one observation a second", [grid_frames[where[i]] for i in range(len(ph))]),
    ]
    jump_at = next(i for i in range(n_cal, len(ph)) if not ph[i]["time_unknown"] and abs(epoch(ph[i]["t"]) - ph[i]["host_t"] - lag) > 5)
    # is the u-blox a fair reference? A second phone in the car, which the spoofer did not capture either,
    # logged its position every second: the two should agree all morning
    other = []
    for line in fetch("a_phone_other").read_text().splitlines()[1:]:
        stamp, la, lo = (x.strip() for x in line.split(","))
        r = ref.get(int(datetime.strptime(stamp, "%Y-%m-%dT%H%M%S").replace(tzinfo=timezone.utc).timestamp()))
        if r and float(la):
            other.append(haversine_m(float(la), float(lo), r[0], r[1]))
    out = {
        "device": "Android phone (GnssLogger NMEA, 1 Hz), file mobile2",
        "reference": "u-blox receiver in the same car, not captured",
        "reference_check": {"against": "a second phone in the car (file mobile1), not captured", "seconds": len(other),
                            "median_m": round(statistics.median(other), 1), "p99_m": round(sorted(other)[int(0.99 * len(other))], 1), "max_m": round(max(other), 1)},
        "epochs": len(ph), "start": iso(ph[0]["host_t"]), "end": iso(ph[-1]["host_t"]),
        "clock_lag_s": round(lag, 2),
        "calibration": {"seconds": n_cal, "until": iso(ph[n_cal]["host_t"]), **rows},
        "capture": {
            "start": iso(ph[cap0]["host_t"]), "end": iso(ph[cap1]["host_t"]),
            "duration_s": round(ph[cap1]["host_t"] - ph[cap0]["host_t"]),
            "fixes": len(captured),
            "declared_test": "2.6.2", "declared_test_start": iso(next(x["start"] for x in tests if x["test"] == "2.6.2")),
            "time_jump_first_s": round(epoch(ph[jump_at]["t"]) - ph[jump_at]["host_t"] - lag),
            "time_offset_median_s": round(statistics.median(epoch(ph[i]["t"]) - ph[i]["host_t"] - lag for i in captured)),
            "time_jump_before_position_s": round(ph[cap0]["host_t"] - ph[jump_at]["host_t"]),
            "offset_while_parked_m": round(statistics.median(err[i] for i in captured[:300]), 1),
            "reported_max_error_m": round(max(err[i] for i in captured)),
            "cn0_before_dbhz": round(statistics.median(o["cn0_mean_dbhz"] for o in ph[cap0 - 300:cap0] if o["cn0_mean_dbhz"]), 1),
            "cn0_during_dbhz": round(statistics.median(ph[i]["cn0_mean_dbhz"] for i in captured if ph[i]["cn0_mean_dbhz"]), 1),
        },
        "clean_seconds": len(clean), "no_test_seconds": len(no_test), "lie_over_50m_seconds": len(lie),
        "configurations": [],
    }
    for key, label, fr in configs:
        first = next((i for i in range(cap0, cap1 + 1) if alerted(fr[i])), None)
        prot = []
        if key == "full":       # every second of the capture, the silent ones included
            for g in range(where[cap0], where[cap1] + 1):
                r, resp = ref_at(ref, grid[g]["host_t"] + lag), grid_frames[g]["resp"]
                if r and resp.get("lat") is not None:
                    prot.append(haversine_m(resp["lat"], resp["lon"], r[0], r[1]))
        c = {
            "key": key, "label": label,
            "first_alert_delay_s": None if first is None else round(ph[first]["host_t"] - ph[cap0]["host_t"]),
            "captured_alerted": sum(1 for i in captured if alerted(fr[i])),
            "captured_refused": sum(1 for i in captured if refused(fr[i])),
            "lie_over_50m_refused": sum(1 for i in lie if refused(fr[i])),
            "clean": summary(fr, clean), "no_test": summary(fr, no_test),
            "evidence": sorted({w["code"] for i in captured for w in fr[i]["why"]}),
            "handed_on_max_error_m": round(max(prot), 1) if prot else None,
            "handed_on_median_error_m": round(statistics.median(prot), 1) if prot else None,
        }
        out["configurations"].append(c)
        if verbose:
            print(f"  phone {key:9s} first alert {c['first_alert_delay_s']} s, refused {c['captured_refused']}/{len(captured)} captured, "
                  f"{c['lie_over_50m_refused']}/{len(lie)} lies over 50 m; clean alerts {c['clean']['alert_seconds']}/{len(clean)}, "
                  f"no-test {c['no_test']['alert_seconds']}/{len(no_test)}; handed on {c['handed_on_max_error_m']}")
    # for drawing: the car's real track around the capture, the spoofed spot, and error and trust through it
    full = dict((k, fr) for k, _, fr in configs)["full"]
    step = max(1, len(captured) // 200)
    out["capture"]["silent_seconds"] = where[cap1] - where[cap0] + 1 - len(set(where[i] for i in range(cap0, cap1 + 1)))
    out["capture"]["drive_off_after_s"] = next(round(ph[i]["host_t"] - ph[cap0]["host_t"]) for i in range(cap0, cap1) if truth[i] and (truth[i][2] or 0) > 2.0)
    c0, c1 = ph[cap0]["host_t"] + lag, ph[cap1]["host_t"] + lag
    out["track"] = {
        "unit": "metres east and north of the car when the capture began; third value: 1 while the phone was captured",
        "points": [xy(truth[cap0], ref[k][:2]) + [1 if c0 <= k <= c1 else 0] for k in range(int(c0) - 300, int(c1) + 120, 5) if k in ref],
        "spoofed": xy(truth[cap0], (ph[cap0 + 60]["lat"], ph[cap0 + 60]["lon"])),
    }
    out["timeline"] = {
        "unit": "seconds since the capture began, error of the reported position (m), error of the position handed on (m), trust",
        "rows": [[round(ph[i]["host_t"] - ph[cap0]["host_t"]), round(err[i]),
                  round(haversine_m(full[i]["resp"]["lat"], full[i]["resp"]["lon"], truth[i][0], truth[i][1])), full[i]["trust"]] for i in captured[::step]],
    }
    return out


def xy(origin, p):
    kx = 111320.0 * math.cos(math.radians(origin[0]))
    return [round((p[1] - origin[1]) * kx), round((p[0] - origin[0]) * 110540.0)]


# ------------------------------------------------------------------ the u-blox ---------------

def ublox_day(files):
    obs = []
    for f in files:
        obs += cached(f, ublox_observations)
    for i, o in enumerate(obs):
        o["seq"] = i
    return obs


def ublox_session(name, obs, tests, settings, model, skip=0, verbose=True):
    """One day of the u-blox, from observation `skip` on (what comes before calibrated the model): the rules
    alone and the hybrid, by what the signal was doing. No odometer and no reference exist for this receiver,
    so only detection is measured, not the response layer."""
    ts = [epoch(o["t"]) for o in obs]
    st = [state(t, tests) if i >= skip else "calibration" for i, t in enumerate(ts)]
    day = [x for x in tests if ts[0] - 3600 <= x["start"] <= ts[-1]]
    level = statistics.median(o["cn0_mean_dbhz"] for i, o in enumerate(obs) if st[i] in ("clean", "calibration") and o["cn0_mean_dbhz"])

    def signal(o):
        if o["lat"] is None:
            return "no_fix"
        return "collapsed" if (o["cn0_mean_dbhz"] or 99.0) < level - COLLAPSE_DB else "normal"

    sig = [signal(o) for o in obs]
    groups = {
        "tests_collapsed": [i for i in range(skip, len(obs)) if st[i] == "attack" and sig[i] == "collapsed"],
        "tests_no_fix": [i for i in range(skip, len(obs)) if st[i] == "attack" and sig[i] == "no_fix"],
        "tests_normal_signal": [i for i in range(skip, len(obs)) if st[i] == "attack" and sig[i] == "normal"],
        "no_test": [i for i in range(skip, len(obs)) if st[i] == "none"],
        "outside_normal_signal": [i for i in range(skip, len(obs)) if st[i] == "clean" and sig[i] == "normal"],
        "outside_collapsed_or_no_fix": [i for i in range(skip, len(obs)) if st[i] == "clean" and sig[i] != "normal"],
    }
    # exposures: runs of collapsed or lost signal inside the declared tests (gaps of up to 5 s bridged), 3 s or longer
    bad = [i for i in range(skip, len(obs)) if st[i] == "attack" and sig[i] != "normal"]
    exposures, cur = [], []
    for i in bad:
        if cur and i - cur[-1] > 6:
            exposures.append(cur)
            cur = []
        cur.append(i)
    if cur:
        exposures.append(cur)
    exposures = [e for e in exposures if e[-1] - e[0] + 1 >= 3]

    out = {
        "device": "u-blox receiver (NMEA, thinned to 1 Hz)", "day": name, "epochs": len(obs) - skip, "start": obs[skip]["t"], "end": obs[-1]["t"],
        "clean_cn0_median_dbhz": round(level, 1), "time_steps_back": sum(1 for a, b in zip(ts, ts[1:]) if b < a),
        "exposures": len(exposures), "exposure_seconds": sum(e[-1] - e[0] + 1 for e in exposures),
        "longest_exposure_s": max((e[-1] - e[0] + 1 for e in exposures), default=0),
        "groups": {k: len(v) for k, v in groups.items()}, "detectors": [], "tests": [],
    }
    frames = {"rules": replay(obs, None, settings), "hybrid": replay(obs, model, settings)}
    for key, fr in frames.items():
        d = {"key": key}
        for g, idx in groups.items():
            d[g] = {"seconds": len(idx), "alert_seconds": sum(1 for i in idx if alerted(fr[i])),
                    "below_trusted_seconds": sum(1 for i in idx if fr[i]["trust"] < 75.0)}
        d["exposures_alerted"] = sum(1 for e in exposures if any(alerted(fr[i]) for i in range(e[0], e[-1] + 1)))
        d["exposures_below_trusted"] = sum(1 for e in exposures if any(fr[i]["trust"] < 75.0 for i in range(e[0], e[-1] + 1)))
        delays = [next(i for i in range(e[0], e[-1] + 1) if alerted(fr[i])) - e[0] for e in exposures if any(alerted(fr[i]) for i in range(e[0], e[-1] + 1))]
        d["alert_delay_median_s"] = statistics.median(delays) if delays else None
        out["detectors"].append(d)
        if verbose:
            print(f"  u-blox {name} {key:6s} exposures alerted {d['exposures_alerted']}/{len(exposures)} (trust under 75: {d['exposures_below_trusted']}), "
                  f"collapsed {d['tests_collapsed']['alert_seconds']}/{d['tests_collapsed']['seconds']}, no fix {d['tests_no_fix']['alert_seconds']}/{d['tests_no_fix']['seconds']}, "
                  f"no-test {d['no_test']['alert_seconds']}/{d['no_test']['seconds']}, outside tests with normal signal {d['outside_normal_signal']['alert_seconds']}/{d['outside_normal_signal']['seconds']}")
    base = {i for i, o in enumerate(obs) if i >= skip and ((o["cn0_mean_dbhz"] is not None and o["cn0_mean_dbhz"] < 35.0) or (o["sats"] is not None and o["sats"] < 5))}
    out["baseline_cn0_sats"] = {g: sum(1 for i in idx if i in base) for g, idx in groups.items()}
    out["baseline_cn0_sats"]["exposures_alerted"] = sum(1 for e in exposures if any(i in base for i in range(e[0], e[-1] + 1)))
    for x in day:
        idx = [i for i, t in enumerate(ts) if x["start"] <= t <= x["end"] and i >= skip]
        if not idx:
            continue
        row = {"test": x["test"], "name": x["name"], "start": iso(x["start"]), "seconds": len(idx), "none": x["none"],
               "collapsed_seconds": sum(1 for i in idx if sig[i] == "collapsed"), "no_fix_seconds": sum(1 for i in idx if sig[i] == "no_fix"),
               "min_cn0_dbhz": min((obs[i]["cn0_mean_dbhz"] for i in idx if obs[i]["cn0_mean_dbhz"]), default=None)}
        for key, fr in frames.items():
            al = [i for i in idx if alerted(fr[i])]
            row[key] = {"alert_seconds": len(al), "below_trusted_seconds": sum(1 for i in idx if fr[i]["trust"] < 75.0),
                        "min_trust": min(fr[i]["trust"] for i in idx)}
        out["tests"].append(row)
    return out, frames


# ------------------------------------------------------------------ main ---------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", nargs="+", default=None, help="write the results as JSON here (one or more paths)")
    args = ap.parse_args(argv)
    settings = chosen_settings()
    tests = load_tests(fetch("tests"))
    res = {
        "dataset": "VAARA: University of Vaasa Jammertest 2024 dataset", "repository": REPO, "commit": COMMIT,
        "event": "Jammertest 2024, Andøya, Norway, 10 to 12 September 2024",
        "definitions": {"captured_m": CAPTURED_M, "margin_s": MARGIN_S, "collapse_db": COLLAPSE_DB, "alert": "combined risk of 50 or more"},
    }
    print("session A, the phone (11 September 2024, spoofing in a motorcade)")
    res["phone"] = phone_session(tests, settings)

    # the u-blox: the model is re-calibrated once, on what it recorded on 10 September before the first test
    day_b, day_a = ublox_day(["b_ublox_1", "b_ublox_2"]), ublox_day(["a_ublox"])
    first = min(x["start"] for x in tests)
    n_cal = next(i for i, o in enumerate(day_b) if epoch(o["t"]) >= first - MARGIN_S)
    model, rows = fit_model(day_b[:n_cal], settings, None, "VAARA u-blox, before the first test of 10 September 2024")
    res["ublox_calibration"] = {"seconds": n_cal, "from": day_b[0]["t"], "until": day_b[n_cal]["t"], **rows}
    print("session B, the u-blox (10 September 2024, jammers)")
    res["ublox_jamming"], _ = ublox_session("10 September 2024", day_b, tests, settings, model, skip=n_cal)
    print("session A, the u-blox (11 September 2024, spoofer)")
    res["ublox_spoofing"], _ = ublox_session("11 September 2024", day_a, tests, settings, model)
    for out in args.out or []:
        Path(out).write_text(json.dumps(res, indent=2))
        print("wrote", out)
    return res


if __name__ == "__main__":
    main()
