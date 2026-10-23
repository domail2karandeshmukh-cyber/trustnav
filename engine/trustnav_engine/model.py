"""Unsupervised anomaly layer, trained on normal observations only.

Because it never sees an attack, it cannot overfit to the attack shapes this
simulator happens to produce. It flags what is unlike normal operation.

Two detectors, because each misses what the other sees:

* Isolation Forest finds unusual combinations of inputs. It is weak when a
  single input is extreme and the rest look normal, because a tree only
  rarely picks that one input to split on.
* A per-feature tail detector finds single extreme inputs, such as a fix
  90 m off the road while every signal statistic is clean. Its explanation
  is exact: it reports which input was improbable and how improbable.

Calibration. Each detector's score is turned into a tail probability p on a
calibration set of normal runs that the detectors were not fitted on: the
fraction of normal fixes at least as anomalous as this one. The two are
combined as p = min(2 x min(p_forest, p_tail), 1) (Bonferroni for two tests),
and risk = 100 x min(1, -log10(p) / 4). Risk 50 therefore means roughly a
1-in-100 event under normal operation. A plain percentile rank would make
normal data uniform over 0-100, so a risk-50 alert would fire on half of all
clean fixes by construction.
"""

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

from .features import MODEL_FEATURES

# inputs where only large values are suspicious; the rest are two-sided
UPPER_TAIL = {
    "distance_m", "derived_speed_mps", "speed_disagreement_mps", "heading_rate_dps", "route_deviation_m",
    "pseudorange_residual_m", "pseudorange_roll_mean_m", "pseudorange_abs_z", "sensor_speed_mismatch_mps",
    "jamming_indicator", "pdop", "delta_t_s",
}


class TailModel:
    """Empirical tail probability for each feature, with an exponential tail
    beyond the observed range so a fix 8 km away is not scored the same as
    one 20 m away."""

    def __init__(self, X):
        self.sorted = np.sort(X, axis=0)
        self.n = X.shape[0]
        self.q = np.percentile(X, [1, 5, 95, 99], axis=0)
        # tail scale: decay rate of the extrapolated tail. Floored at half a
        # standard deviation so near-discrete inputs (satellite count change,
        # usually 0 or 1) do not get an impossibly steep tail.
        floor = np.maximum(0.5 * X.std(axis=0), 1e-3)
        self.scale_hi = np.maximum((self.q[3] - self.q[2]) / math.log(5), floor)
        self.scale_lo = np.maximum((self.q[1] - self.q[0]) / math.log(5), floor)
        self.upper = np.array([k in UPPER_TAIL for k in MODEL_FEATURES])

    def neg_log_p(self, X):
        """-log10 tail probability, per row and feature."""
        n = self.n
        out = np.zeros_like(X)
        for j in range(X.shape[1]):
            col = self.sorted[:, j]
            x = X[:, j]
            above = (n - np.searchsorted(col, x, side="left") + 1) / (n + 1)
            below = (np.searchsorted(col, x, side="right") + 1) / (n + 1)
            # exponential extrapolation past the 99th / 1st percentile
            hi_ext = 0.01 * np.exp(-np.maximum(x - self.q[3, j], 0.0) / self.scale_hi[j])
            lo_ext = 0.01 * np.exp(-np.maximum(self.q[0, j] - x, 0.0) / self.scale_lo[j])
            above = np.where(x > self.q[3, j], np.minimum(above, hi_ext), above)
            below = np.where(x < self.q[0, j], np.minimum(below, lo_ext), below)
            p = above if self.upper[j] else np.minimum(1.0, 2.0 * np.minimum(above, below))
            out[:, j] = -np.log10(np.clip(p, 1e-15, 1.0))
        return out


class AnomalyModel:
    def __init__(self, n_estimators=300, seed=20261113):
        self.n_estimators = n_estimators
        self.seed = seed
        self.meta = {}

    def _matrix(self, rows):
        X = np.array([[np.nan if r.get(k) is None else float(r[k]) for k in MODEL_FEATURES] for r in rows])
        idx = np.where(np.isnan(X))
        X[idx] = np.take(self.medians, idx[1])
        return X

    def fit(self, fit_rows, calibration_rows, training_source=""):
        X0 = np.array([[np.nan if r.get(k) is None else float(r[k]) for k in MODEL_FEATURES] for r in fit_rows])
        self.medians = np.nan_to_num(np.nanmedian(X0, axis=0))
        X = self._matrix(fit_rows)
        self.forest = IsolationForest(n_estimators=self.n_estimators, max_samples=512, random_state=self.seed).fit(X)
        self.tails = TailModel(X)
        self.quantiles = np.percentile(X, [1, 99], axis=0)

        C = self._matrix(calibration_rows)
        self.cal_forest = np.sort(-self.forest.decision_function(C))  # higher = more anomalous
        self.cal_tail = np.sort(self.tails.neg_log_p(C).max(axis=1))
        self.n_cal = len(C)

        digest = hashlib.sha1(X.tobytes()).hexdigest()[:8]
        now = datetime.now(timezone.utc)
        self.meta = {
            "model_version": f"hybrid-anomaly-{now:%Y%m%d}-{digest}",
            "model_type": "isolation_forest + per-feature tail detector",
            "feature_names": MODEL_FEATURES,
            "feature_count": len(MODEL_FEATURES),
            "trained_at": now.isoformat(),
            "fit_rows": int(len(X)),
            "calibration_rows": int(len(C)),
            "training_source": training_source,
            "n_estimators": self.n_estimators,
            "seed": self.seed,
            "risk_formula": "risk = 100 * min(1, -log10(p) / 4), p = min(1, 2 * min(p_forest, p_tail))",
        }
        return self

    def _p_cal(self, cal_sorted, score, extrapolate):
        n = self.n_cal
        k = n - np.searchsorted(cal_sorted, score, side="left")
        p = (k + 1) / (n + 1)
        if extrapolate:
            # beyond the most extreme calibration fix, each extra unit of
            # -log10 p_feature makes the event ten times rarer
            excess = score - cal_sorted[-1]
            p = np.where(excess > 0, np.minimum(p, (1.0 / (n + 1)) * np.power(10.0, -np.maximum(excess, 0.0))), p)
        return p

    @staticmethod
    def risk_from_p(p):
        return 100.0 * min(1.0, -math.log10(max(float(p), 1e-12)) / 4.0)

    def score(self, rows):
        """(risk list, per-row tail matrix) for feature rows."""
        X = self._matrix(rows)
        sf = -self.forest.decision_function(X)
        tl = self.tails.neg_log_p(X)
        st = tl.max(axis=1)
        p = np.minimum(1.0, 2.0 * np.minimum(self._p_cal(self.cal_forest, sf, False), self._p_cal(self.cal_tail, st, True)))
        return [self.risk_from_p(x) for x in p], tl

    def risk(self, rows):
        return self.score(rows)[0]

    def explain(self, row, tail_row=None, top=3):
        """Inputs with the most improbable values, most improbable first."""
        if tail_row is None:
            tail_row = self.score([row])[1][0]
        tl = np.asarray(tail_row)[None, :]
        order = np.argsort(-tl[0])
        out = []
        for j in order[:top]:
            if tl[0, j] < 1.5:  # not unusual: better than 1 in 30
                break
            v = row.get(MODEL_FEATURES[j])
            if v is None:
                continue
            out.append({"feature": MODEL_FEATURES[j], "value": round(float(v), 2),
                        "normal_low": round(float(self.quantiles[0, j]), 2),
                        "normal_high": round(float(self.quantiles[1, j]), 2),
                        "neg_log10_p": round(float(tl[0, j]), 2)})
        return out

    def save(self, path):
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        joblib.dump({k: getattr(self, k) for k in
                     ("forest", "tails", "medians", "quantiles", "cal_forest", "cal_tail", "n_cal")}, path / "model.joblib")
        (path / "model.json").write_text(json.dumps(self.meta, indent=2))

    @classmethod
    def load(cls, path):
        path = Path(path)
        m = cls()
        for k, v in joblib.load(path / "model.joblib").items():
            setattr(m, k, v)
        m.meta = json.loads((path / "model.json").read_text())
        return m
