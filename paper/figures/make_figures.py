#!/usr/bin/env python3
"""Vector figures for the IEEE paper, drawn from the evaluation data the engine
exports (dashboard/public/data/replay.json). Run from anywhere:

    python3 paper/figures/make_figures.py

Writes fig_timeline_{en,fr}.pdf, fig_map_{en,fr}.pdf, fig_roc_{en,fr}.pdf,
fig_sens_{en,fr}.pdf and analysis.json next to this script. Every number shown is computed from the per-second frames,
so the figures agree with the tables by construction.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from matplotlib.lines import Line2D
from sklearn.metrics import precision_recall_curve, roc_curve, roc_auc_score, average_precision_score

HERE = Path(__file__).resolve().parent
DATA = HERE.parent.parent / "dashboard" / "public" / "data" / "replay.json"

plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["Liberation Serif", "TeX Gyre Termes", "Times New Roman", "DejaVu Serif"],
    "font.size": 7,
    "axes.titlesize": 7.5,
    "axes.labelsize": 7,
    "legend.fontsize": 6.3,
    "xtick.labelsize": 6.3,
    "ytick.labelsize": 6.3,
    "axes.linewidth": 0.5,
    "lines.linewidth": 0.9,
    "xtick.major.width": 0.5,
    "ytick.major.width": 0.5,
    "xtick.major.size": 2.2,
    "ytick.major.size": 2.2,
    "pdf.fonttype": 42,
    "legend.frameon": False,
    "axes.spines.top": False,
    "axes.spines.right": False,
})

# Okabe-Ito palette (colour-blind safe); series also differ by line style so
# that greyscale prints stay legible
C_HYBRID = "#0072B2"   # blue
C_RULES = "#E69F00"    # orange
C_MODEL = "#CC79A7"    # purple
C_RAW = "#D55E00"      # vermilion
C_PROT = "#009E73"     # green
C_ATTACK = "#e6e6e6"   # attack window shading
C_ROUTE = "#9a9a9a"
C_DETECT = "#000000"   # detection instant
BOX = dict(boxstyle="round,pad=0.12", fc="white", ec="none", alpha=0.85)

T = {
    "en": {
        "trust": "Trust (0–100)", "err": "Position error vs truth (m)", "time": "Time (s)",
        "hybrid": "combined", "rules": "rules only", "model": "model only", "alert": "alert line (50)",
        "attack": "attack active", "raw": "raw fix (what a plain screen shows)", "prot": "protected estimate",
        "nofix": "no fix for 100 s", "first": "first alert",
        "sc": {"teleport_spoof": "(a) Teleport spoof, 8 km jump", "stealth_drift_spoof": "(b) Stealth drift (OSNMA verified)",
               "jamming_recovery": "(c) Jamming with recovery", "drone_drift_spoof": "(d) Drone pushed off its survey"},
        "east": "East (m)", "north": "North (m)", "route": "assigned route",
        "map_a": "(a) OSNMA forgery, delivery van", "map_b": "(b) Drone survey, spoofed",
        "lie": "error", "alert_after": "first alert, hold begins", "hold": "held: odometer along the route",
        "roc_x": "False-alarm rate", "roc_y": "Detection rate", "pr_x": "Recall", "pr_y": "Precision",
        "roc_t": "(a) ROC", "pr_t": "(b) Precision–recall", "auc": "AUC", "ap": "AP",
        "th_x": "Alert threshold (risk)", "th_t": "(a) Threshold sweep", "f1": "F$_1$", "recall": "recall", "fpr": "false-alarm rate",
        "cal_t": "(b) Reliability", "cal_x": "Combined risk", "cal_y": "Attack share", "n": "n",
        "w_t": "(c) Fusion weights", "w_x": "Model weight $w_m$", "w_y": "F$_1$ (validation)", "wr": "$w_r$",
    },
    "fr": {
        "trust": "Confiance", "err": "Erreur (m)", "time": "Temps (s)",
        "hybrid": "combiné", "rules": "règles seules", "model": "modèle seul", "alert": "seuil d'alerte (50)",
        "attack": "attaque en cours", "raw": "position brute (écran classique)", "prot": "estimation protégée",
        "nofix": "pas de position pendant 100 s", "first": "première alerte",
        "sc": {"teleport_spoof": "(a) Leurrage « téléportation », saut de 8 km", "stealth_drift_spoof": "(b) Dérive furtive (OSNMA vérifié)",
               "jamming_recovery": "(c) Brouillage puis reprise", "drone_drift_spoof": "(d) Drone détourné de son relevé"},
        "east": "Est (m)", "north": "Nord (m)", "route": "itinéraire prévu",
        "map_a": "(a) Falsification OSNMA, camionnette", "map_b": "(b) Relevé par drone, leurré",
        "lie": "erreur", "alert_after": "première alerte, début du maintien", "hold": "maintien : odomètre le long de l'itinéraire",
        "roc_x": "Taux de fausses alertes", "roc_y": "Taux de détection", "pr_x": "Rappel", "pr_y": "Précision",
        "roc_t": "(a) ROC", "pr_t": "(b) Précision–rappel", "auc": "AUC", "ap": "AP",
        "th_x": "Seuil d'alerte (risque)", "th_t": "(a) Balayage du seuil", "f1": "F$_1$", "recall": "rappel", "fpr": "fausses alertes",
        "cal_t": "(b) Fiabilité", "cal_x": "Risque combiné", "cal_y": "Part sous attaque", "n": "n",
        "w_t": "(c) Poids de fusion", "w_x": "Poids du modèle $w_m$", "w_y": "F$_1$ (validation)", "wr": "$w_r$",
    },
}


def num(v, lang, nd=1):
    """1 decimal, French comma when lang == 'fr'."""
    t = f"{v:.{nd}f}"
    return t.replace(".", ",") if lang == "fr" else t


def hav(a, b):
    if a is None or b is None or a[0] is None or b[0] is None:
        return None
    r = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def enu(points, lat0, lon0):
    k = 111320.0
    return [((lon - lon0) * k * math.cos(math.radians(lat0)), (lat - lat0) * k) for lat, lon in points]


def load():
    d = json.loads(DATA.read_text())
    return {s["slug"]: s for s in d["scenarios"]}, d["routes"]


def fig_timeline(sc, lang, height=2.2):
    """Two rows x four scenarios; height in inches (the French paper uses a shorter panel)."""
    t = T[lang]
    slugs = ["teleport_spoof", "stealth_drift_spoof", "jamming_recovery", "drone_drift_spoof"]
    fig, axes = plt.subplots(2, 4, figsize=(7.16, height), sharex="col")
    for j, slug in enumerate(slugs):
        s = sc[slug]
        fr = s["frames"]
        x = [f["s"] for f in fr]
        atk = [f["atk"] for f in fr]
        a0 = s["attack_start"]
        a1 = max(f["s"] for f in fr if f["atk"])
        first = next((f["s"] for f in fr if f["atk"] and (f["hr"] or 0) >= 50), None)
        ax = axes[0, j]
        ax.axvspan(a0, a1, color=C_ATTACK, lw=0, zorder=0)
        ax.axhline(50, color="black", lw=0.5, ls=(0, (2, 2)), zorder=1)
        ax.plot(x, [100 - (f["rr"] or 0) for f in fr], color=C_RULES, lw=0.7, ls="--", zorder=2)
        ax.plot(x, [100 - (f["mr"] if f["mr"] is not None else 0) for f in fr], color=C_MODEL, lw=0.7, ls=":", zorder=3)
        ax.plot(x, [f["trust"] for f in fr], color=C_HYBRID, lw=1.0, zorder=4)
        if first is not None:
            ax.axvline(first, color=C_DETECT, lw=0.5, ls=(0, (3, 2)), zorder=1)
            ax.plot([first], [50], marker="v", color=C_HYBRID, ms=4, zorder=5, clip_on=False)
            ax.annotate(f"+{first - a0} s", (first, 50), xytext=(-3, 7), textcoords="offset points", ha="right", fontsize=6, color=C_HYBRID)
        ax.set_ylim(0, 102)
        ax.set_title(t["sc"][slug], loc="left", fontsize=7, pad=3)
        if j == 0:
            ax.set_ylabel(t["trust"])
        ax.set_yticks([0, 25, 50, 75, 100])
        # errors
        ax = axes[1, j]
        ax.axvspan(a0, a1, color=C_ATTACK, lw=0, zorder=0)
        if first is not None:
            ax.axvline(first, color=C_DETECT, lw=0.5, ls=(0, (3, 2)), zorder=1)
        raw = [hav((f["lat"], f["lon"]), tuple(f["tl"])) if f["fix"] and f["lat"] is not None else None for f in fr]
        prot = [hav((f["resp"]["lat"], f["resp"]["lon"]), tuple(f["tl"])) if f["resp"] and f["resp"].get("lat") is not None else None for f in fr]
        floor = 0.5
        ax.plot(x, [max(v, floor) if v is not None else float("nan") for v in raw], color=C_RAW, lw=0.9, zorder=3)
        ax.plot(x, [max(v, floor) if v is not None else float("nan") for v in prot], color=C_PROT, lw=0.9, zorder=4)
        ax.set_yscale("log")
        ax.set_ylim(floor, 2e4)
        ax.set_yticks([1, 10, 100, 1000, 10000])
        ax.set_yticklabels(["1", "10", "100", "1 k", "10 k"])
        if j == 0:
            ax.set_ylabel(t["err"])
        ax.set_xlabel(t["time"])
        if slug == "jamming_recovery":
            gap = [f["s"] for f in fr if not f["fix"]]
            ax.annotate(t["nofix"], ((gap[0] + gap[-1]) / 2, 3000), ha="center", fontsize=6, color=C_RAW)
            ax.annotate("", (gap[0], 1500), (gap[-1], 1500), arrowprops=dict(arrowstyle="<->", color=C_RAW, lw=0.6))
        rawmax = max((v for v, f in zip(raw, fr) if v is not None and f["atk"]), default=0)
        protmax = max((v for v, f in zip(prot, fr) if v is not None and f["atk"]), default=0)
        close = max(rawmax, floor) / max(protmax, floor) < 3
        ax.annotate(f"{rawmax:,.0f} m".replace(",", "\u202f") if rawmax >= 10 else f"{num(rawmax, lang)} m",
                    (x[-1], max(rawmax, floor)), xytext=(-2, 10 if close else 3), textcoords="offset points", ha="right", fontsize=6, color=C_RAW)
        # label the protected maximum below the curve, or above it when the curve sits near the floor
        prot_off = (-28, 10) if close else ((-2, -9) if protmax >= 10 else (-2, 3))
        ax.annotate(f"{protmax:.0f} m" if protmax >= 10 else f"{num(protmax, lang)} m",
                    (x[-1], max(protmax, floor)), xytext=prot_off, textcoords="offset points", ha="right", fontsize=6, color=C_PROT)
    handles = [
        Line2D([], [], color=C_HYBRID, lw=1.0, label=t["hybrid"]),
        Line2D([], [], color=C_RULES, lw=0.7, ls="--", label=t["rules"]),
        Line2D([], [], color=C_MODEL, lw=0.7, ls=":", label=t["model"]),
        Line2D([], [], color="black", lw=0.5, ls=(0, (2, 2)), label=t["alert"]),
        Line2D([], [], marker="v", color=C_HYBRID, lw=0, ms=4, label=t["first"]),
        Patch(color=C_ATTACK, label=t["attack"]),
        Line2D([], [], color=C_RAW, lw=0.9, label=t["raw"]),
        Line2D([], [], color=C_PROT, lw=0.9, label=t["prot"]),
    ]
    fig.legend(handles=handles, loc="lower center", ncol=8, bbox_to_anchor=(0.5, -0.02), columnspacing=1.1, handlelength=1.8)
    fig.subplots_adjust(left=0.07, right=0.995, top=1 - 0.21 / height, bottom=0.54 / height, wspace=0.22, hspace=0.36)
    fig.savefig(HERE / f"fig_timeline_{lang}.pdf")
    plt.close(fig)


def fig_map(sc, routes, lang):
    t = T[lang]
    fig, axes = plt.subplots(1, 2, figsize=(3.5, 2.05 if lang == "en" else 2.2))
    for ax, slug, title in [(axes[0], "osnma_forgery", t["map_a"]), (axes[1], "drone_drift_spoof", t["map_b"])]:
        s = sc[slug]
        fr = s["frames"]
        route = routes[s["route"]]["points"]
        lat0 = sum(p[0] for p in route) / len(route)
        lon0 = sum(p[1] for p in route) / len(route)
        rx = enu(route, lat0, lon0)
        ax.plot([p[0] for p in rx], [p[1] for p in rx], color=C_ROUTE, lw=1.6, solid_capstyle="round", zorder=1, alpha=0.8)
        atk = [f for f in fr if f["atk"] and f["lat"] is not None]
        raw = enu([(f["lat"], f["lon"]) for f in atk], lat0, lon0)
        prot = enu([(f["resp"]["lat"], f["resp"]["lon"]) for f in atk if f["resp"] and f["resp"].get("lat") is not None], lat0, lon0)
        ax.plot([p[0] for p in raw], [p[1] for p in raw], color=C_RAW, lw=0.9, zorder=3)
        ax.plot([p[0] for p in prot], [p[1] for p in prot], color=C_PROT, lw=1.1, zorder=4)
        # worst lie: segment between raw and truth at the attack's largest error
        worst = max(atk, key=lambda f: hav((f["lat"], f["lon"]), tuple(f["tl"])))
        wr = enu([(worst["lat"], worst["lon"])], lat0, lon0)[0]
        wt = enu([tuple(worst["tl"])], lat0, lon0)[0]
        ax.plot([wr[0], wt[0]], [wr[1], wt[1]], color=C_RAW, lw=0.6, ls=(0, (1.5, 1.5)), zorder=2)
        d = hav((worst["lat"], worst["lon"]), tuple(worst["tl"]))
        ax.annotate(f"{t['lie']} {d:.0f} m", ((wr[0] + wt[0]) / 2, (wr[1] + wt[1]) / 2), xytext=(5, -7), textcoords="offset points", fontsize=6, color=C_RAW, va="center", bbox=BOX)
        ax.set_aspect("equal")
        ax.set_title(title, loc="left", fontsize=7, pad=3)
        ax.set_xlabel(t["east"])
        if ax is axes[0]:
            ax.set_ylabel(t["north"])
        ax.tick_params(labelsize=5.8)
        xs = [p[0] for p in raw] + [p[0] for p in prot]
        ys = [p[1] for p in raw] + [p[1] for p in prot]
        pad = 130
        ax.set_xlim(min(xs) - pad, max(xs) + pad)
        ax.set_ylim(min(ys) - pad, max(ys) + pad)
        first = next(f for f in fr if f["atk"] and (f["hr"] or 0) >= 50)
        fp = enu([(first["lat"], first["lon"])], lat0, lon0)[0]
        ax.plot([fp[0]], [fp[1]], marker="v", color=C_HYBRID, ms=4.5, zorder=6, clip_on=False)
        ax.annotate(f"+{first['s'] - s['attack_start']} s", fp, xytext=(4, -10), textcoords="offset points", ha="left", fontsize=6, color=C_HYBRID, bbox=BOX)
    handles = [
        Line2D([], [], color=C_ROUTE, lw=1.6, label=t["route"]),
        Line2D([], [], color=C_RAW, lw=0.9, label=t["raw"].split(" (")[0]),
        Line2D([], [], color=C_PROT, lw=1.1, label=t["prot"]),
        Line2D([], [], marker="v", color=C_HYBRID, lw=0, ms=4.5, label=t["alert_after"]),
    ]
    if lang == "en":
        fig.legend(handles=handles, loc="lower center", ncol=4, bbox_to_anchor=(0.5, -0.03), columnspacing=1.0, handlelength=1.6)
        fig.subplots_adjust(left=0.13, right=0.99, top=0.9, bottom=0.3, wspace=0.3)
    else:
        fig.legend(handles=handles, loc="lower center", ncol=2, bbox_to_anchor=(0.5, -0.03), columnspacing=1.6, handlelength=1.6)
        fig.subplots_adjust(left=0.13, right=0.99, top=0.9, bottom=0.36, wspace=0.3)
    fig.savefig(HERE / f"fig_map_{lang}.pdf")
    plt.close(fig)


def fig_roc(sc, lang):
    t = T[lang]
    y, scores = [], {"rules": [], "model": [], "hybrid": []}
    for s in sc.values():
        for f in s["frames"]:
            y.append(1 if f["atk"] else 0)
            scores["rules"].append(f["rr"] or 0)
            scores["model"].append(f["mr"] if f["mr"] is not None else 0)
            scores["hybrid"].append(f["hr"] or 0)
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(3.5, 1.45))
    styles = {"hybrid": (C_HYBRID, "-", 1.1), "rules": (C_RULES, "--", 0.8), "model": (C_MODEL, ":", 0.9)}
    for k in ["rules", "model", "hybrid"]:
        c, ls, lw = styles[k]
        fpr, tpr, _ = roc_curve(y, scores[k])
        a1.plot(fpr, tpr, color=c, ls=ls, lw=lw, label=f"{t[k]} ({t['auc']} {num(roc_auc_score(y, scores[k]), lang, 3)})")
        p, r, _ = precision_recall_curve(y, scores[k])
        a2.plot(r, p, color=c, ls=ls, lw=lw, label=f"{t[k]} ({t['ap']} {num(average_precision_score(y, scores[k]), lang, 3)})")
    a1.plot([0, 1], [0, 1], color="#bbbbbb", lw=0.5, ls=(0, (2, 2)))
    a1.set_xlabel(t["roc_x"]); a1.set_ylabel(t["roc_y"]); a1.set_title(t["roc_t"], loc="left", fontsize=7, pad=3)
    a2.set_xlabel(t["pr_x"]); a2.set_ylabel(t["pr_y"]); a2.set_title(t["pr_t"], loc="left", fontsize=7, pad=3)
    for ax in (a1, a2):
        ax.set_xlim(0, 1); ax.set_ylim(0, 1.02)
        ax.set_xticks([0, 0.5, 1]); ax.set_yticks([0, 0.5, 1])
    a1.legend(loc="lower right", fontsize=5.6, handlelength=1.6)
    a2.legend(loc="lower left", fontsize=5.6, handlelength=1.6)
    fig.subplots_adjust(left=0.12, right=0.99, top=0.87, bottom=0.24, wspace=0.35)
    fig.savefig(HERE / f"fig_roc_{lang}.pdf")
    plt.close(fig)


def analysis(sc, grid):
    """Event-level metrics, baselines, threshold sweep, scenario bootstrap and
    calibration, computed from the per-second frames. Written to analysis.json
    so that every number quoted in the paper can be checked."""
    import random
    ys, hr, feats = [], [], []
    clean = fa_secs = fa_eps = 0
    lat = {}
    for s in sc.values():
        prev = False
        for f in s["frames"]:
            ys.append(1 if f["atk"] else 0); hr.append(f["hr"] or 0); feats.append(f["f"] or {})
            if not f["atk"]:
                clean += 1
                a = (f["hr"] or 0) >= 50
                fa_secs += a
                if a and not prev:
                    fa_eps += 1
                prev = a
            else:
                prev = False
        if s["attack_start"] is not None:
            first = next((f["s"] for f in s["frames"] if f["atk"] and (f["hr"] or 0) >= 50), None)
            lat[s["slug"]] = None if first is None else first - s["attack_start"]

    def prf(pred):
        tp = sum(1 for y, p in zip(ys, pred) if y and p); fp = sum(1 for y, p in zip(ys, pred) if not y and p)
        fn = sum(1 for y, p in zip(ys, pred) if y and not p); tn = len(ys) - tp - fp - fn
        P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn) if tp + fn else 0.0
        return {"precision": P, "recall": R, "f1": 2 * P * R / (P + R) if P + R else 0.0, "fpr": fp / (fp + tn), "tp": tp, "fp": fp, "fn": fn, "tn": tn}

    sweep = {th: prf([h >= th for h in hr]) for th in (25, 30, 40, 50, 60, 70, 75)}
    mops = prf([((f.get("cn0_mean_dbhz") is not None and f["cn0_mean_dbhz"] < 35) or (f.get("satellite_count") is not None and f["satellite_count"] < 5)) for f in feats])
    jump = prf([(f.get("distance_m") or 0) > 250 for f in feats])
    random.seed(1)
    boots = []
    items = list(sc.values())
    for _ in range(2000):
        pick = [random.choice(items) for _ in items]
        tp = fp = fn = tn = 0
        for s in pick:
            for f in s["frames"]:
                y, p = bool(f["atk"]), (f["hr"] or 0) >= 50
                tp += y and p; fp += (not y) and p; fn += y and not p; tn += (not y) and not p
        if tp + fp and tp + fn:
            P, R = tp / (tp + fp), tp / (tp + fn)
            boots.append((P, R, 2 * P * R / (P + R), fp / (fp + tn)))
    def ci(i):
        v = sorted(b[i] for b in boots); return [v[int(0.025 * len(v))], v[int(0.975 * len(v))]]
    bins = [(0, 25), (25, 50), (50, 75), (75, 101)]
    cal = []
    for lo, hi in bins:
        sel = [y for y, h in zip(ys, hr) if lo <= h < hi]
        cal.append({"bin": [lo, hi], "n": len(sel), "attack_share": (sum(sel) / len(sel)) if sel else None})
    out = {"clean_seconds": clean, "false_alarm_seconds": fa_secs, "false_alarm_episodes": fa_eps,
           "false_alarm_seconds_per_hour": fa_secs / (clean / 3600), "false_alarm_episodes_per_hour": fa_eps / (clean / 3600),
           "latency_s": lat, "latency_median_s": sorted(v for v in lat.values() if v is not None)[len(lat) // 2],
           "latency_max_s": max(v for v in lat.values() if v is not None),
           "threshold_sweep": sweep, "baseline_mops_cn0_35_sats_5": mops, "baseline_jump_only_250m": jump,
           "bootstrap_ci95_over_scenarios": {"precision": ci(0), "recall": ci(1), "f1": ci(2), "fpr": ci(3), "resamples": len(boots)},
           "calibration": cal, "fusion_grid": grid}
    (HERE / "analysis.json").write_text(json.dumps(out, indent=1))
    return out


def fig_sens(an, lang):
    t = T[lang]
    fig, (a1, a2, a3) = plt.subplots(1, 3, figsize=(3.5, 1.35))
    ths = sorted(an["threshold_sweep"])
    sw = an["threshold_sweep"]
    a1.plot(ths, [sw[k]["f1"] for k in ths], color=C_HYBRID, marker="o", ms=2.5, lw=0.9, label=t["f1"])
    a1.plot(ths, [sw[k]["recall"] for k in ths], color=C_MODEL, marker="s", ms=2.3, lw=0.8, ls="--", label=t["recall"])
    a1.plot(ths, [sw[k]["fpr"] * 10 for k in ths], color=C_RAW, marker="^", ms=2.5, lw=0.8, ls=":", label=t["fpr"] + " ×10")
    a1.axvline(50, color="#888888", lw=0.5, ls=(0, (2, 2)))
    a1.set_ylim(0, 1.02); a1.set_xlabel(t["th_x"]); a1.set_title(t["th_t"], loc="left", fontsize=7, pad=3)
    a1.legend(loc="center right", fontsize=5.2, handlelength=1.4, borderpad=0.2, labelspacing=0.25)
    cal = an["calibration"]
    xs = range(len(cal))
    a2.bar(xs, [c["attack_share"] or 0 for c in cal], color=[C_PROT, C_RULES, C_RAW, C_RAW], width=0.7)
    for x, c in zip(xs, cal):
        a2.annotate(f"{t['n']}={c['n']}", (x, (c["attack_share"] or 0) + 0.03), ha="center", fontsize=4.8)
    a2.set_xticks(list(xs)); a2.set_xticklabels([f"{c['bin'][0]}–{min(c['bin'][1], 100)}" for c in cal], fontsize=5.0, rotation=35)
    a2.set_ylim(0, 1.12); a2.set_xlabel(t["cal_x"]); a2.set_ylabel(t["cal_y"]); a2.set_title(t["cal_t"], loc="left", fontsize=7, pad=3)
    grid = an["fusion_grid"]
    for wr, c, ls in ((0.6, C_HYBRID, "-"), (0.8, C_MODEL, "--"), (1.0, C_RULES, ":")):
        pts = sorted((g["ml_weight"], g["f1"]) for g in grid if abs(g["rule_weight"] - wr) < 1e-9)
        a3.plot([p[0] for p in pts], [p[1] for p in pts], color=c, ls=ls, marker="o", ms=2.3, lw=0.8, label=f"{t['wr']} = {num(wr, lang)}")
    a3.set_xlabel(t["w_x"]); a3.set_ylabel(t["w_y"]); a3.set_title(t["w_t"], loc="left", fontsize=7, pad=3)
    a3.set_xticks([0.6, 0.8, 1.0]); a3.set_xticklabels([num(v, lang) for v in (0.6, 0.8, 1.0)])
    a3.set_ylim(0.85, 1.0); a3.legend(loc="lower right", fontsize=5.4, handlelength=1.4, borderpad=0.2, labelspacing=0.25)
    a1.set_yticks([0, 0.5, 1]); a2.set_yticks([0, 0.5, 1]); a3.set_yticks([0.85, 0.9, 0.95, 1.0])
    if lang == "fr":
        for ax in (a1, a2, a3):
            ax.set_yticklabels([("%g" % v).replace(".", ",") for v in ax.get_yticks()])
    fig.subplots_adjust(left=0.09, right=0.995, top=0.85, bottom=0.32, wspace=0.5)
    fig.savefig(HERE / f"fig_sens_{lang}.pdf")
    plt.close(fig)


if __name__ == "__main__":
    scenarios, routes = load()
    grid = json.loads(DATA.read_text())["fusion_search"]["grid"]
    an = analysis(scenarios, grid)
    for lang in ("en", "fr"):
        fig_timeline(scenarios, lang, height=2.2 if lang == "en" else 1.9)
        fig_map(scenarios, routes, lang)
        fig_roc(scenarios, lang)
        fig_sens(an, lang)
    print("figures written to", HERE)
