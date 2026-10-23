"""Train, choose fusion weights, evaluate on held-out routes, export results."""

import json
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

from .config import DEFAULT_SETTINGS, FusionSettings, Settings
from .features import FeatureExtractor
from .model import AnomalyModel
from .pipeline import Detector
from .routes import load_routes
from .scenarios import heldout_specs, training_specs, validation_specs
from .simulator import simulate

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models" / "current"


def training_rows():
    """Feature rows from normal training runs, split by run (not by row) into
    a fit set and a calibration set, so calibration is out-of-sample."""
    routes = load_routes()
    fit, cal = [], []
    for i, spec in enumerate(training_specs()):
        fx = FeatureExtractor(routes[spec.route])
        target = cal if i % 3 == 0 else fit
        for o in simulate(spec):
            f, ctx = fx.update(o)
            if ctx["window_full"] and ctx["has_fix"]:
                target.append(f)
    return fit, cal


def train():
    fit, cal = training_rows()
    model = AnomalyModel().fit(fit, cal, "seeded synthetic normal runs on train routes only: Loire road, Maine road, "
                                        "Briollay loop, Belle-Beille loop, La Roseraie loop, two drone survey areas")
    model.save(MODEL_DIR)
    return model


def batch_ml(obs, route, model):
    """Score a whole recorded run in one model call (same numbers as live)."""
    fx = FeatureExtractor(route)
    rows, idx = [], []
    for i, o in enumerate(obs):
        f, ctx = fx.update(o)
        if ctx["window_full"] and ctx["has_fix"]:
            rows.append(f); idx.append(i)
    out = [(None, None)] * len(obs)
    if rows and model is not None:
        risks, tails = model.score(rows)
        for i, r, t in zip(idx, risks, tails):
            out[i] = (r, t)
    return out


def run_spec(spec, model, settings: Settings = DEFAULT_SETTINGS, start_time=None, keep_internal=False):
    route = load_routes()[spec.route]
    det = Detector(model, route, route.profile, settings, spec.device_id, spec.slug)
    obs = simulate(spec) if start_time is None else simulate(spec, start_time)
    ml = batch_ml(obs, route, model)
    frames, internal = [], []
    for o, (m, tl) in zip(obs, ml):
        fr, _ = det.process(o, m, tl)
        # simulator ground truth, for replay only (a real receiver has no such thing)
        fr["tl"] = [round(o["true_lat"], 6), round(o["true_lon"], 6)]
        frames.append(fr)
        if keep_internal:
            internal.append({**det.last_internal, "atk": bool(o["attack"])})
    if keep_internal:
        return frames, det.incidents.finish(), internal
    return frames, det.incidents.finish()


def _metrics(y, risk, threshold):
    y = np.asarray(y, bool)
    risk = np.asarray(risk, float)
    pred = risk >= threshold
    tp = int((pred & y).sum()); fp = int((pred & ~y).sum())
    fn = int((~pred & y).sum()); tn = int((~pred & ~y).sum())
    prec = tp / (tp + fp) if tp + fp else 1.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    fpr = fp / (fp + tn) if fp + tn else 0.0
    out = {
        "precision": round(prec, 4), "recall": round(rec, 4), "f1": round(f1, 4),
        "false_positive_rate": round(fpr, 4),
        "balanced_accuracy": round((rec + (1 - fpr)) / 2, 4),
        "confusion_matrix": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
        "support_positive": int(y.sum()), "support_negative": int((~y).sum()),
    }
    if 0 < y.sum() < len(y):
        out["roc_auc"] = round(float(roc_auc_score(y, risk)), 4)
        out["pr_auc"] = round(float(average_precision_score(y, risk)), 4)
    return out


def _risks(frames, method):
    if method == "rules":
        return [f["rr"] for f in frames]
    if method == "ml":
        return [0.0 if f["mr"] is None else f["mr"] for f in frames]
    return [f["hr"] for f in frames]


def score_runs(runs, threshold):
    """runs: list of (spec, frames). Returns per-method metrics."""
    out = {}
    for method in ("rules", "ml", "hybrid"):
        y, r = [], []
        per = []
        lat = []
        for spec, frames in runs:
            ys = [bool(f["atk"]) for f in frames]
            rs = _risks(frames, method)
            y += ys; r += rs
            alerts = sum(1 for a in rs if a >= threshold)
            first = next((i for i, (yy, a) in enumerate(zip(ys, rs)) if yy and a >= threshold), None)
            start = next((i for i, yy in enumerate(ys) if yy), None)
            latency = None if first is None or start is None else first - start
            if latency is not None:
                lat.append(latency)
            per.append({"scenario": spec.slug, "label": spec.label, "observations": len(frames),
                        "attack_observations": sum(ys), "alerts": alerts,
                        "false_alerts": sum(1 for yy, a in zip(ys, rs) if not yy and a >= threshold),
                        "detection_latency_obs": latency, "detected": first is not None or start is None})
        m = _metrics(y, r, threshold)
        m["mean_detection_latency_obs"] = round(float(np.mean(lat)), 2) if lat else None
        m["per_scenario"] = per
        out[method] = m
    return out


def choose_fusion(model, threshold):
    """Pick fusion weights on validation routes only (never on held-out).

    Rules and ML do not depend on the weights, so each validation run is
    scored once and only the fusion step is repeated for every candidate.
    """
    from .pipeline import fuse

    specs = validation_specs()
    cached = [(s, run_spec(s, model, keep_internal=True)[2]) for s in specs]
    best = None
    grid = []
    for wr in (0.6, 0.8, 1.0):
        for wm in (0.6, 0.8, 1.0):
            fs = FusionSettings(rule_weight=wr, ml_weight=wm)
            runs = []
            for s, internal in cached:
                frames = [{"atk": x["atk"], "rr": x["rule_risk"], "mr": x["ml"],
                           "hr": fuse(x["rule_risk"], x["ml"], fs, x["critical"], DEFAULT_SETTINGS.rules.critical_risk_floor)}
                          for x in internal]
                runs.append((s, frames))
            m = score_runs(runs, threshold)["hybrid"]
            # prefer fewer false alarms when F1 ties: an operator ignores a noisy console
            key = (round(m["f1"], 3), -m["false_positive_rate"])
            grid.append({"rule_weight": wr, "ml_weight": wm, "f1": m["f1"], "false_positive_rate": m["false_positive_rate"]})
            if best is None or key > best[0]:
                best = (key, wr, wm)
    return best[1], best[2], grid


def evaluate_all():
    model = train()
    th = DEFAULT_SETTINGS.alert_threshold_risk
    wr, wm, grid = choose_fusion(model, th)
    (MODEL_DIR / "fusion.json").write_text(json.dumps({"rule_weight": wr, "ml_weight": wm, "chosen_on": "validation routes"}))
    settings = replace(DEFAULT_SETTINGS, fusion=FusionSettings(rule_weight=wr, ml_weight=wm))
    runs, incidents = [], []
    for spec in heldout_specs():
        frames, inc = run_spec(spec, model, settings)
        runs.append((spec, frames))
        incidents += inc
    metrics = score_runs(runs, th)
    return model, settings, grid, runs, incidents, metrics


def main():
    model, settings, grid, runs, incidents, metrics = evaluate_all()
    print("model", model.meta["model_version"], "fit", model.meta["fit_rows"], "cal", model.meta["calibration_rows"])
    print("fusion chosen on validation:", settings.fusion.rule_weight, settings.fusion.ml_weight)
    for k, m in metrics.items():
        print(f"{k:7s} P {m['precision']:.3f} R {m['recall']:.3f} F1 {m['f1']:.3f} FPR {m['false_positive_rate']:.4f} "
              f"ROC {m.get('roc_auc')} lat {m['mean_detection_latency_obs']}")
    print()
    for p in metrics["hybrid"]["per_scenario"]:
        r = next(x for x in metrics["rules"]["per_scenario"] if x["scenario"] == p["scenario"])
        ml = next(x for x in metrics["ml"]["per_scenario"] if x["scenario"] == p["scenario"])
        print(f"{p['scenario']:22s} atk {p['attack_observations']:3d} | hybrid {p['alerts']:3d} fa {p['false_alerts']:2d} "
              f"lat {p['detection_latency_obs']} | rules {r['alerts']:3d} lat {r['detection_latency_obs']} | ml {ml['alerts']:3d} lat {ml['detection_latency_obs']}")
    for (spec, frames) in runs:
        tr = [f["trust"] for f in frames]
        print(f"{spec.slug:22s} min {min(tr):5.1f} mean {np.mean(tr):5.1f}  incidents {sum(1 for i in incidents if i['scenario']==spec.slug)}")


if __name__ == "__main__":
    main()
