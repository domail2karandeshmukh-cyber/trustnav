"""Real receiver adapter: a GNSS receiver on a serial port (or a saved log)
becomes a live TrustNav device.

    python -m trustnav_engine.receiver --port /dev/ttyACM0 --device VAN-REAL --name "Real van"
    python -m trustnav_engine.receiver --file drive.nmea --speed 0        # replay a log, no waiting
    python -m trustnav_engine.receiver --port COM5 --route angers_centre_loop --dry-run

Reads NMEA 0183 sentences (GGA, RMC, VTG, GSA, GSV) and, when the receiver
sends them, u-blox UBX messages (NAV-PVT, NAV-CLOCK, NAV-STATUS, NAV-SAT,
MON-HW). Every second the sentences are folded into one observation with
the same keys the simulator produces, so the detector, the response layer
and the dashboard need no change. Inputs a receiver does not provide stay
None and the engine's missing_* flags take over.

What each input needs:

    position, speed, heading, satellites     NMEA GGA + RMC/VTG, or UBX NAV-PVT
    C/N0 mean and spread                     NMEA GSV (SNR per satellite) or UBX NAV-SAT
    PDOP                                     NMEA GSA or UBX NAV-PVT
    pseudorange residuals                    UBX NAV-SAT (prRes per satellite)
    receiver clock bias and drift            UBX NAV-CLOCK
    jamming indicator (0-255)                UBX MON-HW (jamInd)
    receiver's own spoofing flag             UBX NAV-STATUS (spoofDetState), logged alongside
    Galileo OSNMA                            not in NMEA/UBX; needs the raw I/NAV pages and an
                                             OSNMA library (roadmap), so it stays "unknown"
    inertial / odometer speed                not from the receiver: pass --imu to read a second
                                             source (OBD-II or phone) when available

On a u-blox receiver the UBX messages are enabled with u-center (View >
Messages View, right-click > Enable) or a CFG-MSG; NMEA alone already gives
position, speed, satellites, C/N0 and PDOP, which is enough for a first
live demonstration. The receiver only ever listens: nothing is transmitted.
"""

import argparse
import json
import math
import os
import statistics
import struct
import sys
import time
from datetime import datetime, timezone

from . import __version__
from .demo_feed import chosen_settings
from .evaluate import MODEL_DIR
from .model import AnomalyModel
from .pipeline import Detector
from .routes import load_routes
from .stream import post

# ------------------------------------------------------------------ NMEA ---------------------


def nmea_checksum_ok(line):
    if not line.startswith("$") or "*" not in line:
        return False
    body, _, cs = line[1:].partition("*")
    x = 0
    for ch in body:
        x ^= ord(ch)
    try:
        return x == int(cs[:2], 16)
    except ValueError:
        return False


def _deg(v, hemi):
    """ddmm.mmmm (lat) or dddmm.mmmm (lon) to signed decimal degrees."""
    if not v:
        return None
    try:
        x = float(v)
    except ValueError:
        return None
    d = int(x // 100)
    m = x - d * 100
    out = d + m / 60.0
    return -out if hemi in ("S", "W") else out


def _f(v):
    try:
        return float(v) if v not in ("", None) else None
    except ValueError:
        return None


# NMEA 4.10 signal IDs of each constellation's primary band (talker ID -> signal ID)
PRIMARY_SIGNAL = {"GP": "1", "GL": "1", "GA": "7", "GB": "1", "GQ": "1", "GN": "1"}


def parse_nmea(line):
    """One sentence -> (kind, dict) or None. Talker IDs (GP, GN, GA, GL, GB) are ignored."""
    line = line.strip()
    if not nmea_checksum_ok(line):
        return None
    body = line[1:].split("*")[0]
    parts = body.split(",")
    kind = parts[0][2:] if len(parts[0]) == 5 else parts[0]
    try:
        if kind == "GGA":
            return "GGA", {"time": parts[1], "lat": _deg(parts[2], parts[3]), "lon": _deg(parts[4], parts[5]),
                           "quality": int(parts[6] or 0), "sats": int(parts[7] or 0), "hdop": _f(parts[8])}
        if kind == "RMC":
            return "RMC", {"time": parts[1], "valid": parts[2] == "A", "lat": _deg(parts[3], parts[4]),
                           "lon": _deg(parts[5], parts[6]), "speed_mps": None if _f(parts[7]) is None else _f(parts[7]) * 0.514444,
                           "heading_deg": _f(parts[8]), "date": parts[9]}
        if kind == "VTG":
            return "VTG", {"heading_deg": _f(parts[1]), "speed_mps": None if _f(parts[7]) is None else _f(parts[7]) / 3.6}
        if kind == "GSA":
            return "GSA", {"fix_type": int(parts[2] or 1), "pdop": _f(parts[15]), "hdop": _f(parts[16]), "vdop": _f(parts[17])}
        if kind == "GSV":
            # NMEA 4.10 appends a signal ID; a multi-band receiver then sends one GSV
            # set per band. C/N0 statistics are taken on the primary band only (GPS L1 C/A,
            # GLONASS L1, Galileo E1, BeiDou B1), which is what the simulator and the rules
            # describe; older receivers without the field are single band and pass as is.
            sats = parts[4:]
            signal = None
            if len(sats) % 4 == 1:
                signal, sats = sats[-1], sats[:-1]
            primary = PRIMARY_SIGNAL.get(parts[0][:2], "1")
            snr = []
            if signal in (None, "", primary):
                for k in range(0, len(sats) - 3, 4):
                    s = _f(sats[k + 3])
                    if s is not None and sats[k]:
                        snr.append(s)
            return "GSV", {"total": int(parts[1] or 1), "n": int(parts[2] or 1), "in_view": int(parts[3] or 0), "snr": snr}
    except (ValueError, IndexError):
        return None
    return None


# ------------------------------------------------------------------ UBX ----------------------

UBX_SYNC = b"\xb5\x62"


def ubx_frames(buf):
    """Split a byte buffer into (class, id, payload) frames; return remaining bytes."""
    out = []
    i = 0
    while True:
        j = buf.find(UBX_SYNC, i)
        if j < 0 or len(buf) < j + 6:
            return out, buf[j if j >= 0 else len(buf):]
        cls, mid, ln = buf[j + 2], buf[j + 3], struct.unpack_from("<H", buf, j + 4)[0]
        if ln > 4096:                      # not a real frame: sync bytes inside other data
            i = j + 2
            continue
        end = j + 6 + ln + 2
        if len(buf) < end:
            return out, buf[j:]
        body = buf[j + 2:j + 6 + ln]
        a = b = 0
        for x in body:
            a = (a + x) & 0xFF
            b = (b + a) & 0xFF
        if (a, b) == (buf[end - 2], buf[end - 1]):
            out.append((cls, mid, bytes(buf[j + 6:j + 6 + ln])))
            i = end
        else:
            i = j + 2


def parse_ubx(cls, mid, p):
    """Known UBX messages -> (kind, dict); unknown ones -> None."""
    try:
        if (cls, mid) == (0x01, 0x07) and len(p) >= 92:      # NAV-PVT
            y, mo, d, h, mi, s = struct.unpack_from("<HBBBBB", p, 4)
            fix_type, flags, _, num_sv = struct.unpack_from("<BBBB", p, 20)
            lon, lat = struct.unpack_from("<ii", p, 24)
            g_speed, head = struct.unpack_from("<ii", p, 60)
            pdop = struct.unpack_from("<H", p, 76)[0] / 100.0
            ok = fix_type >= 2 and (flags & 1)
            return "PVT", {"t": f"{y:04d}-{mo:02d}-{d:02d}T{h:02d}:{mi:02d}:{s:02d}Z", "fix": ok,
                           "lat": lat * 1e-7 if ok else None, "lon": lon * 1e-7 if ok else None,
                           "speed_mps": g_speed / 1000.0 if ok else None, "heading_deg": head * 1e-5 if ok else None,
                           "sats": num_sv, "pdop": pdop if ok else None}
        if (cls, mid) == (0x01, 0x22) and len(p) >= 20:      # NAV-CLOCK
            _, clk_b, clk_d = struct.unpack_from("<Iii", p, 0)
            return "CLOCK", {"clock_bias_ns": float(clk_b), "clock_drift_nsps": float(clk_d)}
        if (cls, mid) == (0x01, 0x03) and len(p) >= 16:      # NAV-STATUS
            flags2 = p[7]
            return "STATUS", {"spoof_state": (flags2 >> 3) & 0x3}   # 0 unknown, 1 none, 2 indicated, 3 multiple
        if (cls, mid) == (0x01, 0x35) and len(p) >= 8:       # NAV-SAT
            n = p[5]
            cno, res = [], []
            for k in range(n):
                o = 8 + 12 * k
                if o + 12 > len(p):
                    break
                _, _, c, _, _, pr_res, fl = struct.unpack_from("<BBBbhhI", p, o)
                used = (fl >> 3) & 1
                if used and c > 0:
                    cno.append(float(c))
                    res.append(abs(pr_res) / 10.0)
            return "SAT", {"cno": cno, "pr_res": res}
        if (cls, mid) == (0x0A, 0x09) and len(p) >= 60:      # MON-HW
            return "MONHW", {"jam_ind": p[45], "jamming_state": (p[22] >> 2) & 0x3, "agc": struct.unpack_from("<H", p, 18)[0]}
    except struct.error:
        return None
    return None


# ------------------------------------------------------------------ epochs -------------------

FLUSH_ON = {"GGA", "RMC", "VTG", "PVT", "CLOCK", "STATUS", "SAT", "MONHW"}


class EpochBuilder:
    """Folds one second of sentences into one observation dict."""

    def __init__(self):
        self.seq = 0
        self.cur = {}
        self.seen = set()
        self.date = None          # last date seen in an RMC sentence (ddmmyy), carried over seconds without one
        self.last_t = None        # last timestamp emitted

    def feed(self, kind, d):
        """Return a finished observation when a new second begins, else None."""
        done = None
        if kind in self.seen and kind in FLUSH_ON:
            done = self.finish()
        self.seen.add(kind)
        if kind == "GSV":
            self.cur.setdefault("snr", []).extend(d["snr"])
            self.cur["in_view"] = d["in_view"]
        else:
            for k, v in d.items():
                if v is not None or k not in self.cur:
                    self.cur[k] = v
        return done

    def finish(self):
        c, self.cur, self.seen = self.cur, {}, set()
        if not c:
            return None
        has_fix = c.get("fix", True) and c.get("quality", 1) > 0 and c.get("valid", True) and c.get("lat") is not None
        snr = [s for s in (c.get("cno") or c.get("snr") or []) if s > 0]
        t = c.get("t")
        time_unknown = False
        if t is None:
            raw = c.get("time") or ""
            dt = c.get("date")
            if dt and len(dt) == 6:
                self.date = dt
            dt = self.date
            if len(raw) >= 6 and raw[:6].isdigit():
                tm = raw[:6]
                day = f"20{dt[4:6]}-{dt[2:4]}-{dt[0:2]}" if dt else datetime.now(timezone.utc).strftime("%Y-%m-%d")
                t = f"{day}T{tm[0:2]}:{tm[2:4]}:{tm[4:6]}Z"
            else:
                # a receiver without a fix may send no time at all: count on from the last second it gave
                time_unknown = True
                last = datetime.strptime(self.last_t, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) if self.last_t else datetime.now(timezone.utc)
                t = datetime.fromtimestamp(last.timestamp() + 1, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.last_t = t
        frac = (c.get("time") or "")[6:]
        o = {
            "seq": self.seq,
            "t": t,
            "t_frac": float("0" + frac) if frac.startswith(".") and frac[1:].isdigit() else 0.0,
            "time_unknown": time_unknown,
            "lat": c.get("lat") if has_fix else None,
            "lon": c.get("lon") if has_fix else None,
            "speed_mps": c.get("speed_mps") if has_fix else None,
            "heading_deg": c.get("heading_deg") if has_fix else None,
            # satellites used come from GGA or NAV-PVT only: when an overloaded receiver drops that sentence the count
            # is unknown, not the number of signals with a C/N0 (which would make it jump from 12 to 30 and back)
            "sats": c["sats"] if "sats" in c else (None if snr else 0),
            "cn0_mean_dbhz": round(statistics.fmean(snr), 2) if snr else None,
            "cn0_std_dbhz": round(statistics.pstdev(snr), 2) if len(snr) > 1 else None,
            "pdop": c.get("pdop") if has_fix else None,
            "pr_residual_m": round(statistics.fmean(c["pr_res"]), 2) if c.get("pr_res") else None,
            "doppler_mean_hz": None,
            "clock_bias_ns": c.get("clock_bias_ns"),
            "clock_drift_nsps": c.get("clock_drift_nsps"),
            "jam_ind": c.get("jam_ind"),
            "imu_speed_mps": c.get("imu_speed_mps"),
            "imu_accel_mps2": None,
            "osnma": "unknown",
            "attack": None,
            "attack_kind": None,
            "rx_spoof_state": c.get("spoof_state"),
            "rx_jamming_state": c.get("jamming_state"),
        }
        self.seq += 1
        return o


def iter_bytes_from_port(port, baud):
    try:
        import serial  # pyserial
    except ImportError:
        sys.exit("pip install pyserial  (needed for --port)")
    with serial.Serial(port, baud, timeout=1) as s:
        while True:
            chunk = s.read(512)
            if chunk:
                yield chunk


def iter_bytes_from_file(path):
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(4096)
            if not chunk:
                return
            yield chunk


def observations(byte_source):
    """Bytes in (mixed NMEA text and UBX binary), observation dicts out."""
    eb = EpochBuilder()
    buf = b""
    text = b""
    for chunk in byte_source:
        buf += chunk
        frames, buf = ubx_frames(buf)
        for cls, mid, p in frames:
            r = parse_ubx(cls, mid, p)
            if r:
                o = eb.feed(*r)
                if o:
                    yield o
        # NMEA lines may be interleaved with binary; keep only printable lines
        text += chunk
        while b"\n" in text:
            line, text = text.split(b"\n", 1)
            try:
                s = line.decode("ascii", "ignore").strip()
            except Exception:
                continue
            if not s.startswith("$"):
                # the first sentence after a binary frame arrives glued to it on the same line;
                # the checksum decides whether what follows the last "$" really is a sentence
                k = s.rfind("$")
                if k < 0:
                    continue
                s = s[k:]
            r = parse_nmea(s)
            if r:
                o = eb.feed(*r)
                if o:
                    yield o
    o = eb.finish()
    if o:
        yield o


# ------------------------------------------------------------------ main ---------------------


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--port", help="serial port, e.g. /dev/ttyACM0 or COM5")
    src.add_argument("--file", help="saved NMEA/UBX log to replay")
    ap.add_argument("--baud", type=int, default=38400)
    ap.add_argument("--device", default="RX-01")
    ap.add_argument("--name", default="Real receiver")
    ap.add_argument("--kind", choices=["vehicle", "drone"], default="vehicle")
    ap.add_argument("--route", help="route slug the platform is expected to follow (optional)")
    ap.add_argument("--profile", default=None, help="generic_road_vehicle or small_uav (default from kind)")
    ap.add_argument("--speed", type=float, default=1.0, help="file replay pace: 1 = real time, 0 = as fast as possible")
    ap.add_argument("--dry-run", action="store_true", help="print, do not send")
    ap.add_argument("--no-model", action="store_true",
                    help="rules and OSNMA only. Use this until the model has been calibrated on this receiver's own "
                         "normal drives: its idea of normal comes from the simulator (see docs/ROADMAP.md)")
    ap.add_argument("--jsonl", help="also append every observation and frame to this file")
    args = ap.parse_args(argv)

    url, token = os.environ.get("TRUSTNAV_INGEST_URL"), os.environ.get("TRUSTNAV_TOKEN")
    if not args.dry_run and not (url and token):
        sys.exit("Set TRUSTNAV_INGEST_URL and TRUSTNAV_TOKEN, or use --dry-run.")

    model = None if args.no_model else AnomalyModel.load(MODEL_DIR)
    settings = chosen_settings()
    route = load_routes()[args.route] if args.route else None
    profile = args.profile or (route.profile if route else ("small_uav" if args.kind == "drone" else "generic_road_vehicle"))
    det = Detector(model, route, profile, settings, args.device, "receiver")

    run_id = None
    if not args.dry_run:
        res = post(url, token, {"type": "start_run", "mode": "receiver", "label": f"Receiver: {args.name}",
                                "engine_version": __version__, "model_version": model.meta["model_version"] if model else None,
                                "devices": [{"id": args.device, "name": args.name, "kind": args.kind,
                                             "route_slug": args.route, "profile": profile}]})
        if not res or "run_id" not in res:
            sys.exit(f"Could not start a run: {res}")
        run_id = res["run_id"]
    print(f"run {run_id or '(dry run)'}: {args.name} on {args.port or args.file}, "
          f"model {model.meta['model_version'] if model else 'off (rules only)'}")

    source = iter_bytes_from_port(args.port, args.baud) if args.port else iter_bytes_from_file(args.file)
    log = open(args.jsonl, "a") if args.jsonl else None
    last = time.monotonic()
    try:
        for o in observations(source):
            fr, ev = det.process(o)
            resp = fr["resp"]
            fix = "fix" if fr["fix"] else "NO FIX"
            print(f"{o['t']}  trust {fr['trust']:5.1f} {fr['st']:10s} {fix:6s} sats {o['sats'] or 0:2d} "
                  f"cn0 {o['cn0_mean_dbhz'] or 0:4.1f}  resp {resp['mode']}/{resp['action']}"
                  + (f"  why: {fr['why'][0]['title']}" if fr["why"] else ""))
            if log:
                log.write(json.dumps({"obs": o, "frame": fr}) + "\n")
            if not args.dry_run:
                post(url, token, {"type": "frames", "run_id": run_id, "frames": [fr], "incidents": [inc for _, inc in ev]})
            if args.file and args.speed > 0:
                time.sleep(max(0.0, last + 1.0 / args.speed - time.monotonic()))
                last = time.monotonic()
    except KeyboardInterrupt:
        pass
    finally:
        if log:
            log.close()
        if not args.dry_run:
            post(url, token, {"type": "end_run", "run_id": run_id})
    print("receiver run finished")


if __name__ == "__main__":
    main()
