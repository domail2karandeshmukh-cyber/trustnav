"""TrustNav Phone: a phone's own GNSS fixes become a live TrustNav device.

The /phone page of the console (https://trustnav.vercel.app/phone) sends the
phone's position, speed, heading and accuracy once a second to the cloud.
This bridge, running on any laptop, pulls those fixes, scores them with the
same detector and response layer as every other receiver, and posts the
frames, so the live console shows the phone moving over Angers with a real
trust score.

    export TRUSTNAV_INGEST_URL=https://<project>.supabase.co/functions/v1/ingest
    export TRUSTNAV_TOKEN=<ingest token>
    python -m trustnav_engine.phone --device PHONE-01 --name "Karan's phone"
    python -m trustnav_engine.phone --device PHONE-01 --route angers_centre_loop --model

A phone reports no per-satellite signal strength, no clock, no OSNMA; those
inputs stay None and the engine's missing_* flags take over, so the physics
rules (jumps, impossible speed, acceleration, heading) and the route rule do
the work. The model is off unless --model is given: its idea of "normal"
comes from the simulator (see docs/ROADMAP.md).

Attack overlay (chosen on the phone page, applied here, nothing transmitted):
    teleport  the reported position jumps 8 km east and stays there
    drift     the reported position is pulled away at 0.7 m/s
    jam       no fix at all
The phone's real speed stands in for the odometer, so the response layer can
dead-reckon through the overlay exactly as it would with a vehicle's CAN bus.
"""

import argparse
import math
import os
import sys
import time
from datetime import datetime, timezone

from . import __version__
from .demo_feed import chosen_settings
from .evaluate import MODEL_DIR
from .geo import offset
from .model import AnomalyModel
from .pipeline import Detector
from .routes import load_routes
from .stream import post

TELEPORT_EAST_M = 8000.0
DRIFT_MPS = 0.7
DRIFT_BEARING_DEG = 45.0


class Overlay:
    """Turns one real fix into the fix a spoofed or jammed receiver would report."""

    def __init__(self):
        self.kind = "none"
        self.started = None  # wall-clock seconds when the current overlay began

    def apply(self, o, kind, now):
        if kind != self.kind:
            self.kind, self.started = kind, now
        o["attack"] = kind != "none"
        o["attack_kind"] = {"teleport": "teleport", "drift": "drift", "jam": "jamming"}.get(kind)
        if kind == "none" or o["lat"] is None:
            return o
        if kind == "jam":
            o.update({"lat": None, "lon": None, "speed_mps": None, "heading_deg": None, "sats": 0, "pdop": None})
            return o
        if kind == "teleport":
            east, north = TELEPORT_EAST_M, 0.0
        else:  # drift
            d = DRIFT_MPS * max(0.0, now - self.started)
            east, north = d * math.sin(math.radians(DRIFT_BEARING_DEG)), d * math.cos(math.radians(DRIFT_BEARING_DEG))
        o["lat"], o["lon"] = offset(o["lat"], o["lon"], east, north)
        return o


def to_observation(row, seq):
    """A phone_observations row -> the observation dict the detector expects."""
    has_fix = row.get("lat") is not None and row.get("lon") is not None
    t = row["t"]
    if t.endswith("+00:00"):
        t = t[:-6] + "Z"
    return {
        "seq": seq,
        "t": t,
        "lat": row.get("lat") if has_fix else None,
        "lon": row.get("lon") if has_fix else None,
        "speed_mps": row.get("speed_mps") if has_fix else None,
        "heading_deg": row.get("heading_deg") if has_fix else None,
        "sats": None,
        "cn0_mean_dbhz": None,
        "cn0_std_dbhz": None,
        "pdop": None,
        "pr_residual_m": None,
        "doppler_mean_hz": None,
        "clock_bias_ns": None,
        "clock_drift_nsps": None,
        "jam_ind": None,
        # the phone's real speed stands in for the odometer (see module docstring)
        "imu_speed_mps": row.get("speed_mps") if has_fix else None,
        "imu_accel_mps2": None,
        "osnma": "unknown",
        "attack": None,
        "attack_kind": None,
        "accuracy_m": row.get("accuracy_m"),
        "overlay": row.get("overlay") or "none",
    }


def pull(url, token, device, since):
    res = post(url, token, {"type": "phone_pull", "device_id": device, "since": since})
    return (res or {}).get("obs") or []


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--device", default="PHONE-01", help="device id typed on the phone page (A-Z, 0-9, -)")
    ap.add_argument("--name", default="Phone")
    ap.add_argument("--route", help="route slug the phone is expected to follow (optional)")
    ap.add_argument("--profile", default=None, help="generic_road_vehicle (default) or small_uav")
    ap.add_argument("--model", action="store_true", help="also run the anomaly model (uncalibrated for phones)")
    ap.add_argument("--poll", type=float, default=1.0, help="seconds between pulls")
    ap.add_argument("--from-start", action="store_true", help="replay every stored fix instead of only new ones")
    ap.add_argument("--dry-run", action="store_true", help="pull and print, do not post frames")
    args = ap.parse_args(argv)

    url, token = os.environ.get("TRUSTNAV_INGEST_URL"), os.environ.get("TRUSTNAV_TOKEN")
    if not (url and token):
        sys.exit("Set TRUSTNAV_INGEST_URL and TRUSTNAV_TOKEN (the phone bridge needs them even for --dry-run).")

    model = AnomalyModel.load(MODEL_DIR) if args.model else None
    settings = chosen_settings()
    route = load_routes()[args.route] if args.route else None
    profile = args.profile or (route.profile if route else "generic_road_vehicle")
    det = Detector(model, route, profile, settings, args.device, "phone")
    overlay = Overlay()

    # start after the newest stored fix unless asked to replay history
    since = 0
    if not args.from_start:
        rows = pull(url, token, args.device, 0)
        while len(rows) == 200:
            since = rows[-1]["id"]
            rows = pull(url, token, args.device, since)
        if rows:
            since = rows[-1]["id"]

    run_id = None
    if not args.dry_run:
        res = post(url, token, {"type": "start_run", "mode": "receiver", "label": f"Phone: {args.name}",
                                "engine_version": __version__, "model_version": model.meta["model_version"] if model else None,
                                "devices": [{"id": args.device, "name": args.name, "kind": "vehicle",
                                             "route_slug": args.route, "profile": profile}]})
        if not res or "run_id" not in res:
            sys.exit(f"Could not start a run: {res}")
        run_id = res["run_id"]
    print(f"run {run_id or '(dry run)'}: {args.name} ({args.device}), route {args.route or 'none'}, "
          f"model {'on' if model else 'off (rules only)'}. Waiting for fixes from the phone page...")

    seq = 0
    try:
        while True:
            rows = pull(url, token, args.device, since)
            if not rows:
                time.sleep(args.poll)
                continue
            frames, events = [], []
            for row in rows:
                since = row["id"]
                o = overlay.apply(to_observation(row, seq), row.get("overlay") or "none", time.time())
                seq += 1
                fr, ev = det.process(o)
                frames.append(fr)
                events += [inc for _, inc in ev]
                resp = fr["resp"]
                print(f"{o['t']}  trust {fr['trust']:5.1f} {fr['st']:10s} {'fix' if fr['fix'] else 'NO FIX':6s} "
                      f"acc {o['accuracy_m'] or 0:4.0f} m  overlay {o['overlay']:8s} resp {resp['mode']}/{resp['action']}"
                      + (f"  why: {fr['why'][0]['title']}" if fr["why"] else ""))
            if not args.dry_run:
                for i in range(0, len(frames), 100):
                    post(url, token, {"type": "frames", "run_id": run_id, "frames": frames[i:i + 100],
                                      "incidents": events if i == 0 else []})
            if len(rows) < 200:
                time.sleep(args.poll)
    except KeyboardInterrupt:
        pass
    finally:
        if not args.dry_run and run_id:
            post(url, token, {"type": "end_run", "run_id": run_id})
    print("phone run finished")


if __name__ == "__main__":
    main()
