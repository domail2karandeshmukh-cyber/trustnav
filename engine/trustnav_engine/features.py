"""Per-observation feature vector, computed incrementally (works live).

Every fix becomes a fixed-length vector over a short rolling window of the
previous observations. Missing inputs are explicit missing_* flags instead of
silent zeros, so the model and the rules can tell "absent" from "zero".
"""

import math
from collections import deque
from datetime import datetime

from .geo import angle_diff_deg, bearing_deg, haversine_m

FEATURE_NAMES = [
    "delta_t_s",
    "distance_m",
    "derived_speed_mps",
    "reported_speed_mps",
    "speed_disagreement_mps",
    "acceleration_mps2",
    "heading_change_deg",
    "heading_rate_dps",
    "route_deviation_m",
    "satellite_count",
    "satellite_count_delta",
    "satellite_count_roll_mean",
    "cn0_mean_dbhz",
    "cn0_roll_mean_dbhz",
    "cn0_delta_dbhz",
    "cn0_std_dbhz",
    "pdop",
    "pdop_delta",
    "pseudorange_residual_m",
    "pseudorange_roll_mean_m",
    "pseudorange_abs_z",
    "doppler_mean_hz",
    "doppler_delta_hz",
    "clock_bias_delta_ns",
    "clock_drift_delta_nsps",
    "imu_horizontal_accel_mps2",
    "sensor_speed_mismatch_mps",
    "jamming_indicator",
    "missing_speed",
    "missing_cn0",
    "missing_dop",
    "missing_pseudorange",
    "missing_imu",
    "missing_route_reference",
    "osnma_failed",
    "osnma_lost",
]

# Inputs the anomaly model sees: one per independent physical quantity.
# Duplicates (heading change vs heading rate at 1 Hz), geometry-dependent
# absolutes (mean Doppler) and context-only rolling means are left out.
# OSNMA and missing flags never vary in normal data, so a model trained on
# normal data could not learn them; the rules layer handles those.
MODEL_FEATURES = [
    "derived_speed_mps",
    "speed_disagreement_mps",
    "acceleration_mps2",
    "heading_rate_dps",
    "route_deviation_m",
    "satellite_count",
    "satellite_count_delta",
    "cn0_mean_dbhz",
    "cn0_delta_dbhz",
    "cn0_std_dbhz",
    "pdop",
    "pdop_delta",
    "pseudorange_residual_m",
    "pseudorange_abs_z",
    "doppler_delta_hz",
    "clock_bias_delta_ns",
    "clock_drift_delta_nsps",
    "sensor_speed_mismatch_mps",
    "jamming_indicator",
]


def _parse_t(t):
    return datetime.strptime(t, "%Y-%m-%dT%H:%M:%SZ").timestamp()


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _std(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return None
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


class FeatureExtractor:
    """Stateful: call update() once per observation, in time order."""

    def __init__(self, route=None, window=5, osnma_memory_s=120.0):
        self.route = route
        self.window = window
        self.osnma_memory_s = osnma_memory_s
        self.hist = deque(maxlen=window)
        self.prev_fix = None
        self.prev_derived_speed = None
        self.prev_move_bearing = None
        self.last_verified_t = None
        self.last_fix_t = None
        self.count = 0

    @property
    def window_full(self):
        return self.count > self.window

    def update(self, o):
        t = _parse_t(o["t"])
        has_fix = o.get("lat") is not None and o.get("lon") is not None
        f = dict.fromkeys(FEATURE_NAMES)

        # --- motion ---
        if has_fix and self.prev_fix is not None:
            dt = max(1e-3, t - self.prev_fix["_t"])
            dist = haversine_m(self.prev_fix["lat"], self.prev_fix["lon"], o["lat"], o["lon"])
            dspeed = dist / dt
            f["delta_t_s"] = dt
            f["distance_m"] = dist
            f["derived_speed_mps"] = dspeed
            if self.prev_derived_speed is not None:
                f["acceleration_mps2"] = (dspeed - self.prev_derived_speed) / dt
            if dist > 2.0:
                mb = bearing_deg(self.prev_fix["lat"], self.prev_fix["lon"], o["lat"], o["lon"])
                if self.prev_move_bearing is not None:
                    ch = abs(angle_diff_deg(self.prev_move_bearing, mb))
                    f["heading_change_deg"] = ch
                    f["heading_rate_dps"] = ch / dt
                self.prev_move_bearing = mb
            else:
                f["heading_change_deg"] = 0.0
                f["heading_rate_dps"] = 0.0
            self.prev_derived_speed = dspeed
        elif has_fix:
            f["delta_t_s"] = 1.0

        rs = o.get("speed_mps")
        f["reported_speed_mps"] = rs
        if rs is not None and f["derived_speed_mps"] is not None:
            f["speed_disagreement_mps"] = abs(f["derived_speed_mps"] - rs)

        if has_fix and self.route is not None:
            f["route_deviation_m"] = self.route.distance_to(o["lat"], o["lon"])

        # --- signal statistics against the previous window ---
        prev = list(self.hist)
        sats = o.get("sats")
        f["satellite_count"] = sats
        ps = [p.get("sats") for p in prev]
        if prev and sats is not None and ps[-1] is not None:
            f["satellite_count_delta"] = sats - ps[-1]
        f["satellite_count_roll_mean"] = _mean(ps)

        cn0 = o.get("cn0_mean_dbhz")
        f["cn0_mean_dbhz"] = cn0
        rm = _mean([p.get("cn0_mean_dbhz") for p in prev])
        f["cn0_roll_mean_dbhz"] = rm
        if cn0 is not None and rm is not None:
            f["cn0_delta_dbhz"] = cn0 - rm
        f["cn0_std_dbhz"] = o.get("cn0_std_dbhz")

        pdop = o.get("pdop")
        f["pdop"] = pdop
        if pdop is not None and prev and prev[-1].get("pdop") is not None:
            f["pdop_delta"] = pdop - prev[-1]["pdop"]

        pr = o.get("pr_residual_m")
        f["pseudorange_residual_m"] = pr
        prs = [p.get("pr_residual_m") for p in prev]
        f["pseudorange_roll_mean_m"] = _mean(prs)
        sd = _std(prs)
        if pr is not None and f["pseudorange_roll_mean_m"] is not None:
            f["pseudorange_abs_z"] = abs(pr - f["pseudorange_roll_mean_m"]) / max(sd or 0.0, 0.5)

        dop = o.get("doppler_mean_hz")
        f["doppler_mean_hz"] = dop
        if dop is not None and prev and prev[-1].get("doppler_mean_hz") is not None:
            f["doppler_delta_hz"] = dop - prev[-1]["doppler_mean_hz"]

        cb, cd = o.get("clock_bias_ns"), o.get("clock_drift_nsps")
        if has_fix and self.prev_fix is not None and cb is not None and self.prev_fix.get("clock_bias_ns") is not None:
            dt = f["delta_t_s"] or 1.0
            expected = self.prev_fix["clock_bias_ns"] + (cd or 0.0) * dt
            f["clock_bias_delta_ns"] = cb - expected
        if cd is not None and self.prev_fix is not None and self.prev_fix.get("clock_drift_nsps") is not None:
            f["clock_drift_delta_nsps"] = cd - self.prev_fix["clock_drift_nsps"]

        # --- inertial cross-check ---
        f["imu_horizontal_accel_mps2"] = o.get("imu_accel_mps2")
        imu_v = o.get("imu_speed_mps")
        if imu_v is not None and f["derived_speed_mps"] is not None:
            f["sensor_speed_mismatch_mps"] = abs(f["derived_speed_mps"] - imu_v)

        # receiver's own interference monitor (u-blox MON-RF jamInd, 0-255)
        f["jamming_indicator"] = o.get("jam_ind")

        # --- explicit missing flags ---
        f["missing_speed"] = 1.0 if f["derived_speed_mps"] is None else 0.0
        f["missing_cn0"] = 1.0 if cn0 is None else 0.0
        f["missing_dop"] = 1.0 if pdop is None else 0.0
        f["missing_pseudorange"] = 1.0 if pr is None else 0.0
        f["missing_imu"] = 1.0 if imu_v is None else 0.0
        f["missing_route_reference"] = 1.0 if f["route_deviation_m"] is None else 0.0

        # --- Galileo OSNMA ---
        status = o.get("osnma") or "unknown"
        if status == "verified":
            self.last_verified_t = t
        f["osnma_failed"] = 1.0 if status == "failed" else 0.0
        lost = (
            status == "unavailable"
            and self.last_verified_t is not None
            and t - self.last_verified_t <= self.osnma_memory_s
        )
        f["osnma_lost"] = 1.0 if lost else 0.0

        # --- state for next call ---
        if has_fix:
            self.prev_fix = {**o, "_t": t}
            self.last_fix_t = t
        seconds_without_fix = 0.0 if has_fix else (t - self.last_fix_t if self.last_fix_t else 0.0)
        self.hist.append(o)
        self.count += 1
        context = {
            "has_fix": has_fix,
            "seconds_without_fix": seconds_without_fix,
            "osnma": status,
            "seconds_since_verified": None if self.last_verified_t is None else t - self.last_verified_t,
            "window_full": self.window_full,
        }
        return f, context
