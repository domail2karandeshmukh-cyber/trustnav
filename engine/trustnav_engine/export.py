"""Train, evaluate and write everything the dashboard needs to one JSON file.

    python -m trustnav_engine.export            -> out/trustnav_v2.json
"""

import json
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import __version__
from .evaluate import evaluate_all
from .features import FEATURE_NAMES, MODEL_FEATURES
from .routes import load_routes

OUT = Path(__file__).resolve().parents[1] / "out"


def build():
    model, settings, grid, runs, incidents, metrics = evaluate_all()
    routes = load_routes()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    scenarios = []
    for spec, frames in runs:
        tr = [f["trust"] for f in frames]
        route = routes[spec.route]
        scenarios.append({
            "slug": spec.slug,
            "name": spec.name,
            "label": spec.label,
            "attack": spec.attack,
            "description": spec.description,
            "device_id": spec.device_id,
            "profile": route.profile,
            "route": spec.route,
            "seed": spec.seed,
            "observations": len(frames),
            "attack_start": spec.attack_start_s if spec.attack != "none" else None,
            "attack_observations": sum(1 for f in frames if f["atk"]),
            "min_trust": round(min(tr), 1),
            "mean_trust": round(float(np.mean(tr)), 1),
            "incident_count": sum(1 for i in incidents if i["scenario"] == spec.slug),
            "frames": frames,
        })
    used_routes = {s["route"] for s in scenarios}
    return {
        "engine_version": __version__,
        "run_id": run_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "is_synthetic": True,
        "scenarios": scenarios,
        "routes": {k: r.to_dict(max_points=900) for k, r in routes.items() if k in used_routes},
        "route_catalogue": [{"slug": r.slug, "name": r.name, "role": r.role, "profile": r.profile,
                             "length_m": round(r.length_m)} for r in routes.values()],
        "incidents": incidents,
        "experiments": metrics,
        "fusion_search": {"chosen": {"rule_weight": settings.fusion.rule_weight, "ml_weight": settings.fusion.ml_weight},
                          "grid": grid, "split": "validation routes only"},
        "model": model.meta,
        "features": {"all": FEATURE_NAMES, "model": MODEL_FEATURES},
        "settings": settings.to_dict(),
        "limitations": [
            "All observations are deterministic synthetic output. One simulator produces every split, so these numbers are an upper bound on real-world performance.",
            "Attack overlays are textbook versions: a careful adversary who matches C/N0 spread and clock behaviour would be harder to detect.",
            "Route deviation assumes the vehicle follows an assigned route (delivery fleet, survey drone). A driver who changes route will look like drift.",
            "One observation is one evaluation unit. A long attack contributes many correlated rows, so per-observation scores are not per-attack accuracy.",
            "OSNMA status is simulated. A relay (meaconing) attack can pass OSNMA, which the stealth drift scenario shows.",
        ],
    }


def main():
    OUT.mkdir(exist_ok=True)
    data = build()
    path = OUT / "trustnav_v2.json"
    path.write_text(json.dumps(data, separators=(",", ":")))
    # small companions for the dashboard: everything but the frames, and all route geometry
    meta = {k: v for k, v in data.items() if k not in ("scenarios", "routes")}
    meta["scenarios"] = [{k: v for k, v in sc.items() if k != "frames"} for sc in data["scenarios"]]
    (OUT / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    from .scenarios import FLEET_DEVICES
    wanted = {sc["route"] for sc in data["scenarios"]} | {d[3] for d in FLEET_DEVICES}
    routes = load_routes()
    (OUT / "routes.json").write_text(json.dumps({k: routes[k].to_dict(max_points=900) for k in sorted(wanted)},
                                                separators=(",", ":")))
    m = data["experiments"]["hybrid"]
    print(f"wrote {path} ({path.stat().st_size/1e6:.1f} MB): {len(data['scenarios'])} scenarios, "
          f"{len(data['incidents'])} incidents, hybrid F1 {m['f1']}, FPR {m['false_positive_rate']}")


if __name__ == "__main__":
    sys.exit(main())
