"""Deterministic checks. Each one names the value it measured and the
threshold it crossed, so an analyst can verify every alert by hand.

Thresholds sit where a physical implausibility begins, not where a spoof
becomes likely. That keeps rules quiet on normal data (few false alarms)
at the cost of missing slow, careful attacks, which the model layer covers.
"""

from dataclasses import dataclass

from .config import Profile, RuleSettings


@dataclass
class Reason:
    code: str
    title: str
    severity: str
    contribution: float
    detail: str

    def to_dict(self):
        return {
            "code": self.code,
            "title": self.title,
            "severity": self.severity,
            "contribution": round(self.contribution, 1),
            "detail": self.detail,
        }


def _severity(value, threshold):
    """0.5 at the threshold, rising to 1.0 at three times the threshold."""
    ratio = abs(value) / threshold
    return min(1.0, 0.5 + 0.25 * (ratio - 1.0))


def _label(s):
    return "HIGH" if s >= 0.75 else "MEDIUM"


def evaluate(f, ctx, profile: Profile, rs: RuleSettings):
    """Return (reasons, rule_risk 0-100, critical flag)."""
    reasons = []

    def fire(code, title, value, threshold, weight, detail, critical=False):
        s = _severity(value, threshold)
        sev = "CRITICAL" if critical else _label(s)
        reasons.append(Reason(code, title, sev, weight * s, detail))

    v = f.get("distance_m")
    if v is not None and v > profile.max_position_jump_m:
        crit = v >= rs.critical_jump_factor * profile.max_position_jump_m
        fire("R_POSITION_JUMP", "Position jump", v, profile.max_position_jump_m, rs.position_jump_weight,
             f"Fix moved {v:,.0f} m in {f['delta_t_s']:.0f} s (limit {profile.max_position_jump_m:.0f} m).", crit)

    v = f.get("derived_speed_mps")
    if v is not None and v > profile.max_speed_mps:
        fire("R_IMPOSSIBLE_SPEED", "Impossible speed", v, profile.max_speed_mps, rs.impossible_speed_weight,
             f"Derived speed {v:,.1f} m/s exceeds the {profile.name.replace('_', ' ')} limit of {profile.max_speed_mps:.0f} m/s.")

    v = f.get("acceleration_mps2")
    if v is not None and abs(v) > profile.max_acceleration_mps2:
        fire("R_ACCELERATION_SPIKE", "Acceleration spike", v, profile.max_acceleration_mps2, rs.acceleration_spike_weight,
             f"Acceleration {v:,.1f} m/s² exceeds {profile.max_acceleration_mps2:.0f} m/s².")

    v = f.get("heading_rate_dps")
    spd = f.get("derived_speed_mps") or 0.0
    if v is not None and v > profile.max_heading_rate_dps and spd > rs.heading_min_speed_mps:
        fire("R_HEADING_DISCONTINUITY", "Heading discontinuity", v, profile.max_heading_rate_dps,
             rs.heading_discontinuity_weight,
             f"Track turned at {v:.0f} °/s while moving at {spd:.1f} m/s (limit {profile.max_heading_rate_dps:.0f} °/s).")

    v = f.get("route_deviation_m")
    if v is not None and v > rs.route_deviation_m:
        fire("R_ROUTE_DEVIATION", "Deviation from expected route", v, rs.route_deviation_m, rs.route_deviation_weight,
             f"Fix lies {v:,.1f} m from the expected route corridor (width {rs.route_deviation_m:.0f} m).")

    v = f.get("satellite_count_delta")
    if v is not None and abs(v) >= rs.satellite_drop:
        fire("R_SATELLITE_SHIFT", "Sudden satellite change", v, rs.satellite_drop, rs.satellite_shift_weight,
             f"Tracked satellites changed by {v:+.0f} in one epoch (threshold ±{rs.satellite_drop:.0f}).")

    v = f.get("cn0_delta_dbhz")
    if v is not None and abs(v) >= rs.cn0_shift_dbhz:
        word = "rose" if v > 0 else "fell"
        fire("R_CN0_SHIFT", "Signal strength shift", v, rs.cn0_shift_dbhz, rs.cn0_shift_weight,
             f"Mean C/N0 {word} {abs(v):.1f} dB-Hz against the last {5} epochs (threshold {rs.cn0_shift_dbhz:.0f} dB-Hz).")

    v = f.get("pdop")
    if v is not None and v > rs.pdop_threshold:
        fire("R_DOP_DEGRADATION", "Geometry degraded", v, rs.pdop_threshold, rs.dop_degradation_weight,
             f"PDOP {v:.1f} exceeds {rs.pdop_threshold:.0f}.")

    v = f.get("pseudorange_residual_m")
    if v is not None and v > rs.pseudorange_residual_m:
        fire("R_PSEUDORANGE_RESIDUAL", "Pseudorange residual", v, rs.pseudorange_residual_m, rs.pseudorange_weight,
             f"Range residual {v:.1f} m exceeds {rs.pseudorange_residual_m:.0f} m: measurements disagree with the solution.")

    v = f.get("clock_drift_delta_nsps")
    if v is not None and abs(v) > rs.clock_drift_delta_nsps:
        fire("R_CLOCK_ANOMALY", "Receiver clock anomaly", v, rs.clock_drift_delta_nsps, rs.clock_anomaly_weight,
             f"Receiver clock drift changed by {abs(v):.0f} ns/s between fixes (threshold {rs.clock_drift_delta_nsps:.0f} ns/s).")

    v = f.get("sensor_speed_mismatch_mps")
    if v is not None and v > rs.sensor_speed_mismatch_mps:
        fire("R_SENSOR_GNSS_MISMATCH", "GNSS and inertial motion disagree", v, rs.sensor_speed_mismatch_mps,
             rs.sensor_mismatch_weight,
             f"GNSS-derived speed differs from the inertial estimate by {v:.1f} m/s (threshold {rs.sensor_speed_mismatch_mps:.0f} m/s).")

    v = f.get("jamming_indicator")
    if v is not None and v > rs.jamming_indicator:
        fire("R_JAMMING_INDICATOR", "RF interference detected", v, rs.jamming_indicator, rs.jamming_weight,
             f"Receiver jamming indicator {v:.0f}/255 exceeds {rs.jamming_indicator:.0f}: broadband noise in the GNSS band.")

    if f.get("osnma_failed"):
        reasons.append(Reason("R_OSNMA_FAILED", "Galileo authentication failed", "CRITICAL", rs.osnma_failed_weight,
                              "OSNMA tag verification failed: the Galileo navigation data was not signed by the Galileo system."))

    if f.get("osnma_lost"):
        since = ctx.get("seconds_since_verified") or 0
        tail = "while the receiver still reports a fix" if ctx.get("has_fix") else "and the fix is gone too"
        reasons.append(Reason("R_OSNMA_LOST", "Galileo authentication lost", "MEDIUM", rs.osnma_lost_weight,
                              f"Authenticated Galileo data stopped {since:.0f} s ago {tail}."))

    wf = ctx.get("seconds_without_fix") or 0.0
    if not ctx.get("has_fix") and wf >= rs.fix_lost_after_s:
        reasons.append(Reason("R_FIX_LOST", "Position fix lost", "MEDIUM", rs.fix_lost_weight,
                              f"No position solution for {wf:.0f} s; {f.get('satellite_count') or 0} satellites tracked."))

    # noisy-OR across rules: independent pieces of evidence reinforce each other
    keep = 1.0
    for r in reasons:
        keep *= 1.0 - min(r.contribution, 100.0) / 100.0
    risk = 100.0 * (1.0 - keep)
    critical = any(r.severity == "CRITICAL" for r in reasons)
    if critical:
        risk = max(risk, rs.critical_risk_floor)
    reasons.sort(key=lambda r: r.contribution, reverse=True)
    return reasons, risk, critical
