"""Real-receiver check: replay a recorded drive from a real GNSS receiver through
the detector, re-calibrate the anomaly model on the first part of the drive, and
overlay software attacks on the rest.

    python -m trustnav_engine.realcheck --file data/real/MTV.Local1.ublox-F9K.20200206-181434.nmea \\
        --reference data/real/MTV.Local1.SPAN.20200206-181434.gga --out ../paper/figures/realcheck.json

The default files are a public 27-minute u-blox ZED-F9K recording of a drive in
Mountain View, California (Google gps-measurement-tools, NmeaUtils/example,
Apache-2.0), with a NovAtel SPAN reference trajectory of the same drive.

What is measured (all numbers go to the JSON file):

1. the whole drive, no attack: alerts from the rules alone, from the model trained
   on the simulator, from a C/N0 + satellite-count baseline;
2. the model re-calibrated on this receiver: fit on the first --fit-s seconds,
   calibration on the next --cal-s seconds, then the rest of the drive is the test
   segment: false alarms per hour;
3. three software overlays on the test segment (teleport, slow drift, jamming), as
   the phone page does: detection delay for the rules alone and for the hybrid with
   the re-calibrated model, and the worst position error of the raw fix and of the
   response layer's estimate against the reference trajectory.

The reference trajectory plays two further roles, both optional: its track is the
platform's assigned route (a delivery van follows a planned route; here the route is
the path the car actually drove), and its speed over ground, which comes from the
SPAN's inertial navigation and not from the u-blox receiver, stands in for the
odometer.

Nothing is transmitted: the attacks are arithmetic on a recording.
"""

import argparse
import copy
import json
import math
import statistics
from pathlib import Path

from .demo_feed import chosen_settings
from .evaluate import MODEL_DIR
from .geo import haversine_m
from .model import AnomalyModel
from .phone import DRIFT_BEARING_DEG, DRIFT_MPS, TELEPORT_EAST_M, Overlay
from .pipeline import Detector
from .receiver import _deg, iter_bytes_from_file, nmea_checksum_ok, observations
from .routes import Route

HERE = Path(__file__).resolve().parent
DEFAULT_LOG = HERE / "data" / "real" / "MTV.Local1.ublox-F9K.20200206-181434.nmea"
DEFAULT_REF = HERE / "data" / "real" / "MTV.Local1.SPAN.20200206-181434.gga"


def load_reference(path):
    """Reference GGA lines -> {"hh:mm:ss": (lat, lon)} and the speed over ground each second,
    {"hh:mm:ss": m/s}, from consecutive reference positions (an inertial-grade track at 1 Hz)."""
    pos = {}
    for line in Path(path).read_text(errors="ignore").splitlines():
        line = line.strip()
        if "GGA" not in line[:7] or not nmea_checksum_ok(line):
            continue
        p = line[1:].split("*")[0].split(",")
        tm = p[1][:6]
        lat, lon = _deg(p[2], p[3]), _deg(p[4], p[5])
        if lat is not None and lon is not None and len(tm) == 6:
            pos[f"{tm[0:2]}:{tm[2:4]}:{tm[4:6]}"] = (lat, lon)
    keys = sorted(pos)
    spd = {}
    for a, b in zip(keys[:-1], keys[1:]):
        if int(b[6:8]) - int(a[6:8]) in (1, -59):          # consecutive seconds
            spd[b] = haversine_m(*pos[a], *pos[b])
    return pos, spd


def ref_of(ref, o):
    return ref.get(o["t"][11:19]) if ref else None


def route_from_reference(ref, min_step_m=3.0):
    """The reference track, thinned, as the assigned route."""
    pts, last = [], None
    for key in sorted(ref):
        p = ref[key]
        if last is None or haversine_m(*last, *p) >= min_step_m:
            pts.append(p)
            last = p
    return Route("real_reference", "Reference track of the recorded drive", pts, "real")


JAM_CN0_DROP_DBHZ = 15.0   # the noise floor rises: every satellite loses this much C/N0
JAM_FIX_LOST_AFTER_S = 2   # then the receiver cannot compute a fix


class RealOverlay(Overlay):
    """The phone overlay, with jamming as a receiver reports it: C/N0 collapses, satellites
    drop, then the fix is lost."""

    def apply(self, o, kind, now):
        if kind != "jam":
            return super().apply(o, kind, now)
        if kind != self.kind:
            self.kind, self.started = kind, now
        o["attack"], o["attack_kind"] = True, "jamming"
        if now - self.started < JAM_FIX_LOST_AFTER_S:
            if o["cn0_mean_dbhz"] is not None:
                o["cn0_mean_dbhz"] = max(10.0, o["cn0_mean_dbhz"] - JAM_CN0_DROP_DBHZ)
            if o["cn0_std_dbhz"] is not None:
                o["cn0_std_dbhz"] += 3.0
            o["sats"] = max(3, (o["sats"] or 0) - 8)
            return o
        o.update({"lat": None, "lon": None, "speed_mps": None, "heading_deg": None, "sats": 0, "pdop": None,
                  "cn0_mean_dbhz": None, "cn0_std_dbhz": None, "pr_residual_m": None})
        return o


def replay(obs, model, settings, route=None, device="RX-REAL"):
    det = Detector(model, route, "generic_road_vehicle", settings, device, "receiver")
    return [det.process(o)[0] for o in obs]


def episodes(idx):
    out = []
    for i in idx:
        if out and i == out[-1][-1] + 1:
            out[-1].append(i)
        else:
            out.append([i])
    return out


def alert_stats(frames, hours):
    al = [i for i, f in enumerate(frames) if (f["hr"] or 0) >= 50]
    eps = episodes(al)
    return {"alert_seconds": len(al), "episodes": len(eps), "longest_episode_s": max((len(e) for e in eps), default=0),
            "alert_seconds_per_hour": round(len(al) / hours, 1), "episodes_per_hour": round(len(eps) / hours, 1),
            "min_trust": min(f["trust"] for f in frames), "mean_trust": round(statistics.fmean(f["trust"] for f in frames), 1)}


def feature_rows(obs, settings, route=None):
    """Feature rows the model trains on, from a run of normal observations."""
    det = Detector(None, route, "generic_road_vehicle", settings, "RX-REAL", "receiver")
    rows = []
    for o in obs:
        f, ctx = det.fx.update(o)
        if ctx["window_full"] and ctx["has_fix"]:
            rows.append(f)
    return rows


def run_overlay(test_obs, kind, start, model, settings, ref, route=None):
    """One attack overlay on the test segment, scored by rules alone and by the hybrid."""
    ov = RealOverlay()
    atk = []
    for i, o in enumerate(test_obs):
        o = copy.deepcopy(o)
        if i >= start:
            o = ov.apply(o, kind, i - start)
        atk.append(o)
    out = {"kind": kind, "attack_start_s": start, "attack_seconds": len(test_obs) - start}
    for label, m in (("rules", None), ("hybrid", model)):
        fr = replay(atk, m, settings, route)
        first = next((i for i in range(start, len(fr)) if (fr[i]["hr"] or 0) >= 50), None)
        false_before = sum(1 for i in range(start) if (fr[i]["hr"] or 0) >= 50)
        hold_after = next((i for i in range(start, len(fr)) if fr[i]["resp"]["mode"] != "accept"), None)
        raw_err, prot_err, raw_blank, prot_blank = [], [], 0, 0
        for i in range(start, len(fr)):
            r = ref_of(ref, test_obs[i])
            o, f = atk[i], fr[i]
            if o["lat"] is None:
                raw_blank += 1
            elif r:
                raw_err.append(haversine_m(o["lat"], o["lon"], r[0], r[1]))
            rp = f["resp"]
            if rp.get("lat") is None:
                prot_blank += 1
            elif r:
                prot_err.append(haversine_m(rp["lat"], rp["lon"], r[0], r[1]))
        out[label] = {
            "first_alert_delay_s": None if first is None else first - start,
            "false_alerts_before_s": false_before,
            "hold_after_s": None if hold_after is None else hold_after - start,
            "held_seconds": sum(1 for i in range(start, len(fr)) if fr[i]["resp"]["mode"] != "accept"),
            "raw_max_error_m": round(max(raw_err), 1) if raw_err else None,
            "protected_max_error_m": round(max(prot_err), 1) if prot_err else None,
            "protected_mean_error_m": round(statistics.fmean(prot_err), 1) if prot_err else None,
            "raw_blank_s": raw_blank, "protected_blank_s": prot_blank,
        }
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", default=str(DEFAULT_LOG), help="NMEA/UBX recording of a normal drive")
    ap.add_argument("--reference", default=str(DEFAULT_REF), help="reference trajectory (GGA lines), optional")
    ap.add_argument("--fit-s", type=int, default=720, help="seconds of the drive used to fit the re-calibrated model")
    ap.add_argument("--cal-s", type=int, default=420, help="seconds used to calibrate it; the rest is the test segment")
    ap.add_argument("--attack-at", type=int, default=90, help="seconds into the test segment when each overlay starts")
    ap.add_argument("--no-route", action="store_true", help="do not use the reference track as the assigned route")
    ap.add_argument("--no-odometer", action="store_true", help="do not use the reference speed as the odometer")
    ap.add_argument("--out", default=None, help="write the results as JSON here")
    args = ap.parse_args(argv)

    settings = chosen_settings()
    obs = list(observations(iter_bytes_from_file(args.file)))
    ref, ref_speed = load_reference(args.reference) if args.reference and Path(args.reference).exists() else ({}, {})
    route = route_from_reference(ref) if ref and not args.no_route else None
    if ref_speed and not args.no_odometer:
        for o in obs:
            o["imu_speed_mps"] = ref_speed.get(o["t"][11:19])
    n = len(obs)
    hours = n / 3600.0
    speeds = [o["speed_mps"] for o in obs if o["speed_mps"] is not None]
    res = {
        "source": Path(args.file).name,
        "reference": Path(args.reference).name if ref else None,
        "epochs": n, "duration_min": round(n / 60.0, 1),
        "start": obs[0]["t"], "end": obs[-1]["t"],
        "moving_seconds": sum(1 for v in speeds if v > 1.0),
        "max_speed_mps": round(max(speeds), 1),
        "cn0_mean_dbhz": round(statistics.fmean(o["cn0_mean_dbhz"] for o in obs if o["cn0_mean_dbhz"]), 1),
        "pdop_max": max(o["pdop"] for o in obs if o["pdop"]),
        "no_fix_seconds": sum(1 for o in obs if o["lat"] is None),
        "inputs_missing": ["pseudorange residuals", "clock", "jamming indicator", "OSNMA"]
                          + (["odometer"] if not (ref_speed and not args.no_odometer) else []) + (["route"] if route is None else []),
        "route": None if route is None else {"points": len(route.points), "length_m": round(route.length_m), "is_loop": route.is_loop},
        "odometer": "speed over ground from the reference track" if (ref_speed and not args.no_odometer) else None,
    }
    if ref:
        errs = [haversine_m(o["lat"], o["lon"], *ref_of(ref, o)) for o in obs if o["lat"] is not None and ref_of(ref, o)]
        res["raw_fix_error_vs_reference_m"] = {"median": round(statistics.median(errs), 2), "p95": round(sorted(errs)[int(0.95 * len(errs))], 2), "max": round(max(errs), 2)}

    # 1. whole drive, no attack
    rules = replay(obs, None, settings, route)
    res["whole_drive_rules_only"] = alert_stats(rules, hours)
    res["whole_drive_rules_only"]["evidence"] = sorted({w["code"] for f in rules for w in f["why"]})
    sim_model = AnomalyModel.load(MODEL_DIR)
    sim = replay(obs, sim_model, settings, route)
    res["whole_drive_simulator_model"] = alert_stats(sim, hours)
    base = [o for o in obs if (o["cn0_mean_dbhz"] is not None and o["cn0_mean_dbhz"] < 35.0) or (o["sats"] or 0) < 5]
    res["whole_drive_cn0_sats_baseline"] = {"alert_seconds": len(base), "alert_seconds_per_hour": round(len(base) / hours, 1)}

    # 2. re-calibration on this receiver
    fit_obs, cal_obs, test_obs = obs[:args.fit_s], obs[args.fit_s:args.fit_s + args.cal_s], obs[args.fit_s + args.cal_s:]
    real_model = AnomalyModel().fit(feature_rows(fit_obs, settings, route), feature_rows(cal_obs, settings, route),
                                    f"{Path(args.file).name}: first {args.fit_s} s fit, next {args.cal_s} s calibration")
    test_hours = len(test_obs) / 3600.0
    test_frames = replay(test_obs, real_model, settings, route)
    res["recalibrated"] = {
        "fit_seconds": len(fit_obs), "calibration_seconds": len(cal_obs), "test_seconds": len(test_obs),
        "test_moving_seconds": sum(1 for o in test_obs if (o["speed_mps"] or 0) > 1.0),
        "test_no_attack": alert_stats(test_frames, test_hours),
        "test_no_attack_rules_only": alert_stats(replay(test_obs, None, settings, route), test_hours),
        "test_no_attack_simulator_model": alert_stats(replay(test_obs, sim_model, settings, route), test_hours),
    }

    # 3. overlays on the test segment
    res["overlays"] = {"teleport_east_m": TELEPORT_EAST_M, "drift_mps": DRIFT_MPS, "drift_bearing_deg": DRIFT_BEARING_DEG,
                       "jam_cn0_drop_dbhz": JAM_CN0_DROP_DBHZ, "jam_fix_lost_after_s": JAM_FIX_LOST_AFTER_S,
                       "runs": [run_overlay(test_obs, k, args.attack_at, real_model, settings, ref, route) for k in ("teleport", "drift", "jam")]}

    print(f"{res['source']}: {res['duration_min']} min, {res['moving_seconds']} s moving, max {res['max_speed_mps']} m/s")
    print(f"  rules only, whole drive: {res['whole_drive_rules_only']['alert_seconds']} alert s, min trust {res['whole_drive_rules_only']['min_trust']}")
    print(f"  simulator model, whole drive: {res['whole_drive_simulator_model']['alert_seconds']} alert s of {n}")
    print(f"  C/N0+sats baseline, whole drive: {res['whole_drive_cn0_sats_baseline']['alert_seconds']} alert s")
    t = res["recalibrated"]
    print(f"  re-calibrated model, test {t['test_seconds']} s: {t['test_no_attack']['alert_seconds']} alert s, "
          f"{t['test_no_attack']['episodes']} episodes ({t['test_no_attack']['alert_seconds_per_hour']} s/h)")
    for r in res["overlays"]["runs"]:
        print(f"  {r['kind']:8s} rules {r['rules']['first_alert_delay_s']} s / hybrid {r['hybrid']['first_alert_delay_s']} s; "
              f"raw max {r['hybrid']['raw_max_error_m']} m, protected max {r['hybrid']['protected_max_error_m']} m, "
              f"blank {r['hybrid']['raw_blank_s']}/{r['hybrid']['protected_blank_s']} s, false before {r['hybrid']['false_alerts_before_s']}")
    if args.out:
        Path(args.out).write_text(json.dumps(res, indent=2))
        print("wrote", args.out)
    return res


if __name__ == "__main__":
    main()
