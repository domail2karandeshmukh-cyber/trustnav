"""Core behaviour checks. Run with:  python -m pytest -q"""

from trustnav_engine.config import DEFAULT_SETTINGS, PROFILES, FusionSettings
from trustnav_engine.pipeline import fuse, trust_status
from trustnav_engine.rules import evaluate
from trustnav_engine.scenarios import heldout_specs
from trustnav_engine.simulator import simulate

RS = DEFAULT_SETTINGS.rules
ROAD = PROFILES["generic_road_vehicle"]
CTX = {"has_fix": True, "seconds_without_fix": 0.0, "seconds_since_verified": 1.0}


def test_simulation_is_deterministic():
    spec = heldout_specs()[2]
    assert simulate(spec) == simulate(spec)


def test_attack_labels_start_on_time():
    spec = next(s for s in heldout_specs() if s.attack == "teleport")
    obs = simulate(spec)
    assert not obs[spec.attack_start_s - 1]["attack"]
    assert obs[spec.attack_start_s]["attack"]


def test_noisy_or_is_stronger_than_either_witness():
    fs = FusionSettings()
    both = fuse(40, 40, fs, False, 70)
    assert both > 40
    assert abs(both - 64.0) < 1e-9  # 1 - 0.6 * 0.6


def test_ml_missing_falls_back_to_rules():
    assert fuse(30, None, FusionSettings(), False, 70) == 30


def test_critical_rule_pins_risk_floor():
    reasons, risk, critical = evaluate({"osnma_failed": 1.0}, CTX, ROAD, RS)
    assert critical and risk >= RS.critical_risk_floor
    assert reasons[0].code == "R_OSNMA_FAILED"


def test_rule_is_silent_just_below_threshold():
    _, risk, _ = evaluate({"route_deviation_m": RS.route_deviation_m - 1}, CTX, ROAD, RS)
    assert risk == 0


def test_rule_severity_scales_with_exceedance():
    r1, _, _ = evaluate({"route_deviation_m": RS.route_deviation_m * 1.01}, CTX, ROAD, RS)
    r3, _, _ = evaluate({"route_deviation_m": RS.route_deviation_m * 3}, CTX, ROAD, RS)
    assert r1[0].contribution < r3[0].contribution == RS.route_deviation_weight


def test_osnma_unknown_is_never_a_failure():
    _, risk, critical = evaluate({"osnma_failed": 0.0, "osnma_lost": 0.0}, CTX, ROAD, RS)
    assert risk == 0 and not critical


def test_trust_bands():
    b = DEFAULT_SETTINGS.trust
    assert trust_status(80, b) == "TRUSTED"
    assert trust_status(60, b) == "DEGRADED"
    assert trust_status(30, b) == "SUSPICIOUS"
    assert trust_status(10, b) == "UNTRUSTED"
