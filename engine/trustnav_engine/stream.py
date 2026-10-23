"""Live engine: run the detector in real time and push results to the cloud.

This is the same code path a Raspberry Pi with a real receiver will use:
observations go in one per second, scored frames and incident events go out
to the TrustNav ingest endpoint, and every open dashboard updates instantly.

    export TRUSTNAV_INGEST_URL=https://<project>.supabase.co/functions/v1/ingest
    export TRUSTNAV_TOKEN=<your ingest token>
    python -m trustnav_engine.stream            # the 7-platform fleet, ~7 minutes
    python -m trustnav_engine.stream --dry-run  # print instead of sending
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

from . import __version__
from .demo_feed import chosen_settings
from .evaluate import MODEL_DIR
from .model import AnomalyModel
from .pipeline import Detector
from .routes import load_routes
from .scenarios import FLEET_DEVICES, fleet_specs
from .simulator import simulate


def post(url, token, payload, retries=3):
    body = json.dumps(payload).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, method="POST",
                                         headers={"Content-Type": "application/json", "x-trustnav-token": token})
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read() or b"{}")
        except Exception as e:  # network hiccup: retry, then report and carry on
            if attempt == retries - 1:
                print(f"  ! send failed: {e}", file=sys.stderr)
            time.sleep(0.5 * (attempt + 1))
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--speed", type=float, default=1.0, help="2 = twice real time")
    ap.add_argument("--duration", type=int, default=420)
    args = ap.parse_args(argv)

    url = os.environ.get("TRUSTNAV_INGEST_URL")
    token = os.environ.get("TRUSTNAV_TOKEN")
    if not args.dry_run and not (url and token):
        sys.exit("Set TRUSTNAV_INGEST_URL and TRUSTNAV_TOKEN, or use --dry-run.")

    model = AnomalyModel.load(MODEL_DIR)
    settings = chosen_settings()
    routes = load_routes()
    start = datetime.now(timezone.utc).replace(microsecond=0)
    specs = fleet_specs(args.duration)

    run_id = None
    if not args.dry_run:
        res = post(url, token, {"type": "start_run", "mode": "live_engine", "label": "Live engine: fleet over Angers",
                                "duration_s": args.duration, "engine_version": __version__,
                                "model_version": model.meta["model_version"],
                                "devices": [{"id": d[0], "name": d[1], "kind": d[2], "route_slug": d[3],
                                             "profile": routes[d[3]].profile} for d in FLEET_DEVICES]})
        if not res or "run_id" not in res:
            sys.exit(f"Could not start a run: {res}")
        run_id = res["run_id"]
    print(f"run {run_id or '(dry run)'} started {start:%H:%M:%S} UTC, model {model.meta['model_version']}")

    streams = []
    for spec in specs:
        route = routes[spec.route]
        streams.append((spec, Detector(model, route, route.profile, settings, spec.device_id, spec.slug),
                        iter(simulate(spec, start))))

    t0 = time.monotonic()
    for sec in range(args.duration):
        frames, events = [], []
        for spec, det, it in streams:
            o = next(it)
            fr, ev = det.process(o)
            frames.append(fr)
            events += [inc for _, inc in ev]
        low = [f"{f['device_id']} {f['trust']:.0f}" for f in frames if f["trust"] < 50]
        print(f"t+{sec:3d}s  " + ("ALERT " + ", ".join(low) if low else "all trusted"))
        if not args.dry_run:
            post(url, token, {"type": "frames", "run_id": run_id, "frames": frames, "incidents": events})
        # keep wall-clock pace even if scoring or sending took a moment
        time.sleep(max(0.0, t0 + (sec + 1) / args.speed - time.monotonic()))

    if not args.dry_run:
        post(url, token, {"type": "end_run", "run_id": run_id})
    print("run finished")


if __name__ == "__main__":
    main()
