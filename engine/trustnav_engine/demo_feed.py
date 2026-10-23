"""Precompute the fleet demo with the real detector, for the cloud demo feed.

    python -m trustnav_engine.demo_feed     -> out/demo_fleet.json
"""

import json
from dataclasses import replace
from pathlib import Path

from . import __version__
from .config import DEFAULT_SETTINGS, FusionSettings
from .evaluate import MODEL_DIR, batch_ml
from .model import AnomalyModel
from .pipeline import Detector
from .routes import load_routes
from .scenarios import FLEET_DEVICES, fleet_specs
from .simulator import simulate

OUT = Path(__file__).resolve().parents[1] / "out"


def chosen_settings():
    meta = json.loads((MODEL_DIR / "fusion.json").read_text())
    return replace(DEFAULT_SETTINGS, fusion=FusionSettings(rule_weight=meta["rule_weight"], ml_weight=meta["ml_weight"]))


def build():
    model = AnomalyModel.load(MODEL_DIR)
    settings = chosen_settings()
    routes = load_routes()
    devices, frames, events = [], [], []
    for (dev, name, kind, route_slug, attack, *_), spec in zip(FLEET_DEVICES, fleet_specs()):
        route = routes[route_slug]
        devices.append({"id": dev, "name": name, "kind": kind, "profile": route.profile, "route_slug": route_slug})
        det = Detector(model, route, route.profile, settings, dev, spec.slug)
        obs = simulate(spec)
        for o, (m, tl) in zip(obs, batch_ml(obs, route, model)):
            fr, ev = det.process(o, m, tl)
            fr = {k: v for k, v in fr.items() if k not in ("device_id", "t")}
            frames.append({"device_id": dev, "offset_s": o["seq"], "frame": fr})
            for kind_, inc in ev:
                if kind_ in ("opened", "resolved") or o["seq"] % 5 == 0:
                    events.append({"device_id": dev, "offset_s": o["seq"], "incident": inc})
    frames[0]["frame"]["engine_version"] = __version__
    frames[0]["frame"]["model_version"] = model.meta["model_version"]
    return {"devices": devices, "frames": frames, "events": events,
            "routes": {d["route_slug"]: routes[d["route_slug"]].to_dict(max_points=900) for d in devices}}


def main():
    OUT.mkdir(exist_ok=True)
    data = build()
    p = OUT / "demo_fleet.json"
    p.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {p} ({p.stat().st_size/1e6:.1f} MB): {len(data['frames'])} frames, {len(data['events'])} incident events")


if __name__ == "__main__":
    main()
