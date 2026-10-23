"""Detection settings.

Every threshold and weight lives here so a reviewer can find and question it.
Values for the road-vehicle profile are carried over unchanged from TrustNav v1.
"""

from dataclasses import dataclass, field, asdict


@dataclass(frozen=True)
class Profile:
    """Physical limits of the platform being monitored."""

    name: str
    max_speed_mps: float
    max_acceleration_mps2: float
    max_heading_rate_dps: float
    max_position_jump_m: float


ROAD_VEHICLE = Profile("generic_road_vehicle", 60.0, 8.0, 90.0, 250.0)
SMALL_UAV = Profile("small_uav", 25.0, 6.0, 120.0, 250.0)
PROFILES = {p.name: p for p in (ROAD_VEHICLE, SMALL_UAV)}


@dataclass(frozen=True)
class RuleSettings:
    """Threshold and weight for each rule.

    A rule's contribution is weight x severity, where severity runs from 0.5
    at the threshold to 1.0 at three times the threshold.
    """

    position_jump_weight: float = 30.0
    impossible_speed_weight: float = 35.0
    acceleration_spike_weight: float = 18.0
    heading_discontinuity_weight: float = 12.0
    heading_min_speed_mps: float = 3.0
    route_deviation_m: float = 150.0
    route_deviation_weight: float = 45.0
    satellite_drop: float = 5.0
    satellite_shift_weight: float = 12.0
    cn0_shift_dbhz: float = 6.0
    cn0_shift_weight: float = 14.0
    pdop_threshold: float = 5.0
    dop_degradation_weight: float = 10.0
    pseudorange_residual_m: float = 12.0
    pseudorange_weight: float = 16.0
    clock_drift_delta_nsps: float = 60.0
    clock_anomaly_weight: float = 14.0
    sensor_speed_mismatch_mps: float = 8.0
    sensor_mismatch_weight: float = 18.0
    jamming_indicator: float = 80.0
    jamming_weight: float = 40.0
    osnma_failed_weight: float = 40.0
    osnma_lost_weight: float = 20.0
    osnma_lost_memory_s: float = 120.0
    fix_lost_after_s: float = 3.0
    fix_lost_weight: float = 25.0
    critical_jump_factor: float = 4.0
    critical_risk_floor: float = 70.0


@dataclass(frozen=True)
class FusionSettings:
    mode: str = "noisy_or"
    rule_weight: float = 1.0
    ml_weight: float = 1.0
    renormalise_when_ml_missing: bool = True


@dataclass(frozen=True)
class TrustBands:
    trusted_min: float = 75.0
    degraded_min: float = 50.0
    suspicious_min: float = 25.0


@dataclass(frozen=True)
class IncidentSettings:
    open_below_trust: float = 50.0
    consecutive_observations: int = 3
    close_after_clean_observations: int = 5
    high_severity_trust: float = 35.0
    critical_severity_trust: float = 20.0


@dataclass(frozen=True)
class Settings:
    version: str = "2.0.0"
    rules: RuleSettings = field(default_factory=RuleSettings)
    fusion: FusionSettings = field(default_factory=FusionSettings)
    trust: TrustBands = field(default_factory=TrustBands)
    incidents: IncidentSettings = field(default_factory=IncidentSettings)
    rolling_window: int = 5
    ml_persistence_window: int = 3
    alert_threshold_risk: float = 50.0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["profiles"] = {k: asdict(v) for k, v in PROFILES.items()}
        return d


DEFAULT_SETTINGS = Settings()
