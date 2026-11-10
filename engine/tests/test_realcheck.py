"""The public real-receiver recording replays through the adapter and the rules. Run with: python -m pytest -q"""

import itertools

from trustnav_engine.demo_feed import chosen_settings
from trustnav_engine.pipeline import Detector
from trustnav_engine.realcheck import DEFAULT_LOG, DEFAULT_REF, RealOverlay, load_reference, route_from_reference, track_summary
from trustnav_engine.receiver import iter_bytes_from_file, observations


def first_epochs(n):
    return list(itertools.islice(observations(iter_bytes_from_file(str(DEFAULT_LOG))), n))


def test_real_log_parses_into_one_observation_per_second_with_primary_band_cn0():
    obs = first_epochs(300)
    assert len(obs) == 300
    assert obs[0]["t"].startswith("2020-02-07T02:14:17") and obs[1]["t"].endswith("02:14:18Z")
    # the ZED-F9K is dual band: the L1/E1 C/N0 alone is used, so the mean stays where a receiver reports it
    assert all(35.0 <= o["cn0_mean_dbhz"] <= 50.0 for o in obs)
    assert all(o["lat"] is not None and o["sats"] == 12 for o in obs)


def test_rules_raise_nothing_on_the_real_drive_opening_and_its_track_can_be_drawn():
    obs = first_epochs(300)
    ref, _ = load_reference(str(DEFAULT_REF))
    det = Detector(None, route_from_reference(ref), "generic_road_vehicle", chosen_settings(), "RX-REAL", "receiver")
    frames = [det.process(o)[0] for o in obs]
    assert min(f["trust"] for f in frames) >= 90.0
    assert all(f["resp"]["mode"] == "accept" for f in frames)
    # the same drive as a polyline for the results page: fit, calibration and test segments in order
    track = track_summary(obs, ref, fit_s=100, cal_s=100, attack_at=30, step=5)
    labels = [p[2] for p in track["points"]]
    assert track["points"][0][:2] == [0, 0] and labels == sorted(labels) and set(labels) == {0, 1, 2}
    assert track["overlay_start"] is not None and len(track["points"]) == 60


def test_jam_overlay_degrades_then_removes_the_fix():
    obs = first_epochs(10)
    ov = RealOverlay()
    first = ov.apply(dict(obs[0]), "jam", 0)
    assert first["lat"] is not None and first["cn0_mean_dbhz"] < obs[0]["cn0_mean_dbhz"] - 10
    later = ov.apply(dict(obs[3]), "jam", 3)
    assert later["lat"] is None and later["sats"] == 0 and later["cn0_mean_dbhz"] is None
    assert later["attack"] and later["attack_kind"] == "jamming"
