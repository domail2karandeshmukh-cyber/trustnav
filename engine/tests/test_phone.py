"""TrustNav Phone bridge: phone fixes become observations, overlays become attacks the detector catches."""

from datetime import datetime, timedelta, timezone

from trustnav_engine.demo_feed import chosen_settings
from trustnav_engine.geo import haversine_m, offset
from trustnav_engine.phone import DRIFT_MPS, TELEPORT_EAST_M, Overlay, to_observation
from trustnav_engine.pipeline import Detector

T0 = datetime(2026, 11, 7, 10, 0, 0, tzinfo=timezone.utc)
LAT0, LON0 = 47.4716, -0.5531  # Angers, place du Ralliement


def row(i, overlay="none", speed=1.4, lat=None, lon=None, fix=True):
    """A walking phone: 1.4 m/s eastwards, 5 m accuracy."""
    if lat is None:
        lat, lon = offset(LAT0, LON0, speed * i, 0.0)
    return {"id": i + 1, "t": (T0 + timedelta(seconds=i)).isoformat().replace("+00:00", "+00:00"),
            "lat": lat if fix else None, "lon": lon if fix else None, "alt_m": 45.0,
            "speed_mps": speed, "heading_deg": 90.0, "accuracy_m": 5.0, "overlay": overlay}


def test_row_becomes_observation_with_missing_signal_inputs():
    o = to_observation(row(3), seq=3)
    assert o["seq"] == 3 and o["t"] == "2026-11-07T10:00:03Z"
    assert o["lat"] is not None and o["speed_mps"] == 1.4 and o["heading_deg"] == 90.0
    assert o["sats"] is None and o["cn0_mean_dbhz"] is None and o["pdop"] is None and o["osnma"] == "unknown"
    assert o["imu_speed_mps"] == 1.4, "the phone's real speed stands in for the odometer"
    assert o["attack"] is None


def test_no_fix_row_has_no_position():
    o = to_observation(row(0, fix=False), seq=0)
    assert o["lat"] is None and o["lon"] is None and o["speed_mps"] is None and o["imu_speed_mps"] is None


def test_overlay_teleport_and_drift_and_jam():
    ov = Overlay()
    o = ov.apply(to_observation(row(0), 0), "none", 100.0)
    assert o["attack"] is False and o["attack_kind"] is None
    o = ov.apply(to_observation(row(1), 1), "teleport", 101.0)
    assert o["attack"] is True and o["attack_kind"] == "teleport"
    assert abs(haversine_m(*offset(LAT0, LON0, 1.4, 0.0), o["lat"], o["lon"]) - TELEPORT_EAST_M) < 5
    o = ov.apply(to_observation(row(2), 2), "drift", 102.0)   # drift starts now: no offset yet
    assert haversine_m(*offset(LAT0, LON0, 2.8, 0.0), o["lat"], o["lon"]) < 0.5
    o = ov.apply(to_observation(row(12), 12), "drift", 112.0)  # ten seconds later: 7 m away
    assert abs(haversine_m(*offset(LAT0, LON0, 16.8, 0.0), o["lat"], o["lon"]) - 10 * DRIFT_MPS) < 0.5
    o = ov.apply(to_observation(row(13), 13), "jam", 113.0)
    assert o["lat"] is None and o["attack_kind"] == "jamming" and o["sats"] == 0


def test_walk_is_trusted_then_teleport_is_caught_and_held():
    det = Detector(None, None, "generic_road_vehicle", chosen_settings(), "PHONE-01", "phone")
    ov = Overlay()
    trusts = []
    for i in range(40):
        kind = "teleport" if i >= 25 else "none"
        o = ov.apply(to_observation(row(i, kind), i), kind, 1000.0 + i)
        fr, _ = det.process(o)
        trusts.append(fr)
    assert all(f["trust"] >= 75 for f in trusts[5:25]), "a steady walk is trusted"
    assert all(f["resp"]["mode"] == "accept" for f in trusts[5:25])
    jump = trusts[25]
    assert jump["trust"] < 50 and any(r["code"] == "R_POSITION_JUMP" for r in jump["why"])
    assert jump["resp"]["mode"] == "hold" and jump["resp"]["action"] == "ISOLATE"
    # the protected estimate stays near the real walk, not 8 km away
    real = offset(LAT0, LON0, 1.4 * 30, 0.0)
    held = trusts[30]["resp"]
    assert held["mode"] == "hold" and haversine_m(real[0], real[1], held["lat"], held["lon"]) < 30
    assert haversine_m(real[0], real[1], trusts[30]["lat"], trusts[30]["lon"]) > 7000


def test_jam_overlay_keeps_an_estimate():
    det = Detector(None, None, "generic_road_vehicle", chosen_settings(), "PHONE-01", "phone")
    ov = Overlay()
    last = None
    for i in range(30):
        kind = "jam" if i >= 20 else "none"
        o = ov.apply(to_observation(row(i, kind), i), kind, 2000.0 + i)
        last, _ = det.process(o)
    assert last["fix"] is False and last["resp"]["mode"] == "hold" and last["resp"]["lat"] is not None
    real = offset(LAT0, LON0, 1.4 * 29, 0.0)
    assert haversine_m(real[0], real[1], last["resp"]["lat"], last["resp"]["lon"]) < 30
