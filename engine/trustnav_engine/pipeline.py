"""The detector: one observation in, one scored frame out.

Used the same way for saved scenarios and for the live stream, so the demo
shows exactly the code path a real receiver would use.
"""

from collections import Counter, deque
from statistics import median

from .config import DEFAULT_SETTINGS, PROFILES, Settings
from .features import FeatureExtractor
from .rules import Reason, evaluate

# features shown in the dashboard's observation panel
DISPLAY_FEATURES = [
    "derived_speed_mps",
    "reported_speed_mps",
    "speed_disagreement_mps",
    "acceleration_mps2",
    "distance_m",
    "heading_rate_dps",
    "route_deviation_m",
    "cn0_mean_dbhz",
    "cn0_delta_dbhz",
    "cn0_std_dbhz",
    "pdop",
    "pseudorange_residual_m",
    "clock_drift_delta_nsps",
    "clock_bias_delta_ns",
    "satellite_count",
    "sensor_speed_mismatch_mps",
]

FEATURE_LABELS = {
    "route_deviation_m": "route deviation",
    "cn0_std_dbhz": "C/N0 spread",
    "cn0_mean_dbhz": "mean C/N0",
    "cn0_delta_dbhz": "C/N0 change",
    "clock_bias_delta_ns": "clock bias jump",
    "clock_drift_delta_nsps": "clock drift change",
    "pseudorange_residual_m": "range residual",
    "pseudorange_abs_z": "range residual z-score",
    "satellite_count": "satellites",
    "satellite_count_roll_mean": "satellites (recent mean)",
    "pdop": "PDOP",
    "distance_m": "step distance",
    "derived_speed_mps": "derived speed",
    "acceleration_mps2": "acceleration",
    "sensor_speed_mismatch_mps": "GNSS-inertial mismatch",
    "speed_disagreement_mps": "speed disagreement",
    "doppler_delta_hz": "Doppler change",
}


def trust_status(trust, bands):
    if trust >= bands.trusted_min:
        return "TRUSTED"
    if trust >= bands.degraded_min:
        return "DEGRADED"
    if trust >= bands.suspicious_min:
        return "SUSPICIOUS"
    return "UNTRUSTED"


def fuse(rule_risk, ml_risk, fs, critical, floor):
    """Noisy-OR, not an average.

    Averaging a confident ML alarm (90) with a quiet rule score (20) gives 55,
    weaker than the ML evidence on its own. Noisy-OR treats the two as
    independent witnesses: either one alone can raise the alarm, and two
    together are stronger than either.
    """
    pr = rule_risk / 100.0
    if ml_risk is None:
        risk = 100.0 * (pr if fs.renormalise_when_ml_missing else fs.rule_weight * pr)
    else:
        pm = ml_risk / 100.0
        risk = 100.0 * (1.0 - (1.0 - fs.rule_weight * pr) * (1.0 - fs.ml_weight * pm))
    if critical:
        risk = max(risk, floor)
    return min(100.0, risk)


class IncidentTracker:
    """Opens an incident after sustained low trust, closes it after recovery."""

    def __init__(self, s, device_id, scenario):
        self.s = s
        self.device_id = device_id
        self.scenario = scenario
        self.low_run = []
        self.clean_run = 0
        self.open = None
        self.closed = []

    def update(self, frame):
        low = frame["trust"] < self.s.open_below_trust
        events = []
        if self.open is None:
            if low:
                self.low_run.append(frame)
                if len(self.low_run) >= self.s.consecutive_observations:
                    first = self.low_run[0]
                    self.open = {
                        "device_id": self.device_id,
                        "scenario": self.scenario,
                        "start": first["s"],
                        "opened_at": first["t"],
                        "end": frame["s"],
                        "min_trust": min(f["trust"] for f in self.low_run),
                        "observations": len(self.low_run),
                        "codes": Counter(),
                        "weight": Counter(),
                        "critical": set(),
                        "ml_titles": Counter(),
                        "titles": {},
                        "status": "OPEN",
                    }
                    for f in self.low_run:
                        self._absorb(f)
                    events.append(("opened", self._public(self.open)))
            else:
                self.low_run = []
        else:
            if low:
                self.clean_run = 0
                self.open["end"] = frame["s"]
                self.open["observations"] += 1
                self.open["min_trust"] = min(self.open["min_trust"], frame["trust"])
                self._absorb(frame)
                events.append(("updated", self._public(self.open)))
            else:
                self.clean_run += 1
                if self.clean_run >= self.s.close_after_clean_observations:
                    self.open["status"] = "RESOLVED"
                    self.open["closed_at"] = frame["t"]
                    pub = self._public(self.open)
                    self.closed.append(pub)
                    events.append(("resolved", pub))
                    self.open, self.low_run, self.clean_run = None, [], 0
        return events

    def _absorb(self, f):
        for r in f["why"]:
            c = r["code"]
            self.open["codes"][c] += 1
            self.open["weight"][c] += r["contribution"]
            if r["severity"] == "CRITICAL":
                self.open["critical"].add(c)
            if c == "ML_ANOMALY":
                # the model's title names its most unusual input; keep the most frequent one
                self.open["ml_titles"][r["title"]] += 1
                self.open["titles"][c] = self.open["ml_titles"].most_common(1)[0][0]
            else:
                self.open["titles"][c] = r["title"]

    def _public(self, inc):
        mt = inc["min_trust"]
        sev = ("CRITICAL" if mt < self.s.critical_severity_trust
               else "HIGH" if mt < self.s.high_severity_trust else "MEDIUM")
        top = inc["codes"].most_common(4)
        # lead with the strongest critical evidence, otherwise the strongest overall
        crit = [c for c in inc["critical"]]
        pool = crit if crit else list(inc["weight"])
        lead_code = max(pool, key=lambda c: inc["weight"][c]) if pool else None
        lead = inc["titles"].get(lead_code, "Low trust") if lead_code else "Low trust"
        return {
            "device_id": inc["device_id"],
            "scenario": inc["scenario"],
            "severity": sev,
            "status": inc["status"],
            "title": f"{lead}: {inc['observations']} observations",
            "start": inc["start"],
            "end": inc["end"],
            "opened_at": inc["opened_at"],
            "closed_at": inc.get("closed_at"),
            "min_trust": round(mt, 1),
            "observations": inc["observations"],
            "evidence": [{"code": c, "title": inc["titles"][c], "occurrences": n} for c, n in top],
        }

    def finish(self):
        """Close the books at the end of a recorded run."""
        out = list(self.closed)
        if self.open is not None:
            out.append(self._public(self.open))
        return out


class Detector:
    def __init__(self, model, route=None, profile="generic_road_vehicle", settings: Settings = DEFAULT_SETTINGS,
                 device_id="VEH-01", scenario=""):
        self.model = model
        self.route = route
        self.profile = PROFILES[profile]
        self.settings = settings
        self.fx = FeatureExtractor(route, settings.rolling_window, settings.rules.osnma_lost_memory_s)
        self.ml_hist = deque(maxlen=settings.ml_persistence_window)
        self.incidents = IncidentTracker(settings.incidents, device_id, scenario)
        self.device_id = device_id

    def process(self, o, ml_raw=None, tail_row=None):
        """Score one observation. ml_raw may be precomputed in batch for speed;
        live use leaves it None and the model scores the fix here."""
        st = self.settings
        f, ctx = self.fx.update(o)
        reasons, rule_risk, critical = evaluate(f, ctx, self.profile, st.rules)

        explanation = []
        if self.model is not None and ctx["window_full"] and ctx["has_fix"]:
            if ml_raw is None:
                risks, tails = self.model.score([f])
                ml_raw, tail_row = risks[0], tails[0]
            self.ml_hist.append(ml_raw)
            # trailing median: an isolated spike is suppressed, a sustained
            # anomaly survives; trailing so an epoch never uses its own future
            ml = median(self.ml_hist)
            if ml >= 25:
                explanation = self.model.explain(f, tail_row)
        else:
            ml = None
            if not ctx["has_fix"]:
                self.ml_hist.clear()

        if ml is not None and ml >= 25:
            parts = [
                f"{FEATURE_LABELS.get(e['feature'], e['feature'].replace('_', ' '))} {e['value']:g} "
                f"(normal {e['normal_low']:g} to {e['normal_high']:g})"
                for e in explanation
            ]
            detail = f"Observation window differs from the model's normal profile (anomaly risk {ml:.0f}/100)."
            if parts:
                detail += " Most unusual: " + "; ".join(parts) + "."
            lead = FEATURE_LABELS.get(explanation[0]["feature"], explanation[0]["feature"].replace("_", " ")) if explanation else None
            title = f"Unusual {lead} (model)" if lead else "Anomaly model score"
            reasons.append(Reason("ML_ANOMALY", title, "HIGH" if ml >= 50 else "MEDIUM", ml, detail))
            reasons.sort(key=lambda r: r.contribution, reverse=True)

        hybrid = fuse(rule_risk, ml, st.fusion, critical, st.rules.critical_risk_floor)
        trust = 100.0 - hybrid
        self.last_internal = {"rule_risk": rule_risk, "ml": ml, "critical": critical}
        frame = {
            "device_id": self.device_id,
            "s": o["seq"],
            "t": o["t"],
            "lat": o["lat"],
            "lon": o["lon"],
            "trust": round(trust, 1),
            "st": trust_status(trust, st.trust),
            "rr": round(rule_risk, 1),
            "mr": None if ml is None else round(ml, 1),
            "hr": round(hybrid, 1),
            "spd": o.get("speed_mps"),
            "hdg": o.get("heading_deg"),
            "sats": o.get("sats"),
            "osnma": ctx["osnma"],
            "fix": ctx["has_fix"],
            "atk": o.get("attack"),
            "kind": o.get("attack_kind"),
            "f": {k: (None if f[k] is None else round(f[k], 2)) for k in DISPLAY_FEATURES},
            "why": [r.to_dict() for r in reasons[:5]],
        }
        events = self.incidents.update(frame)
        return frame, events
