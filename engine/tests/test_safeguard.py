"""Response layer checks. Run with:  python -m pytest -q"""

import math

from trustnav_engine.config import SafeguardSettings
from trustnav_engine.geo import haversine_m, offset
from trustnav_engine.routes import load_routes
from trustnav_engine.safeguard import Safeguard

LAT, LON = 47.4700, -0.5500


def frame(seq, lat, lon, trust, critical=False, fix=True, hdg=90.0, spd=10.0):
    why = [{"code": "R_OSNMA_FAILED", "severity": "CRITICAL"}] if critical else []
    return {"s": seq, "lat": lat if fix else None, "lon": lon if fix else None, "trust": trust,
            "fix": fix, "hdg": hdg, "spd": spd, "why": why}


def drive(sg, seqs, make):
    out = []
    for i in seqs:
        f, o = make(i)
        out.append(sg.update(f, o))
    return out


def test_trusted_fix_passes_through():
    sg = Safeguard()
    r = sg.update(frame(0, LAT, LON, 95), {"imu_speed_mps": 10.0})
    assert r["mode"] == "accept" and r["action"] == "CONTINUE"
    assert (r["lat"], r["lon"]) == (LAT, LON)


def test_spoofed_fix_is_held_and_estimate_follows_the_odometer():
    sg = Safeguard()
    sg.update(frame(0, LAT, LON, 95, hdg=90.0), {"imu_speed_mps": 10.0})
    far_lat, far_lon = offset(LAT, LON, 8000.0, 0.0)        # teleported 8 km east
    r = sg.update(frame(1, far_lat, far_lon, 12, critical=True), {"imu_speed_mps": 10.0})
    assert r["mode"] == "hold" and r["action"] == "ISOLATE" and r["source"] == "heading_odometer"
    expect = offset(LAT, LON, 10.0, 0.0)                     # 10 m east of the last trusted fix
    assert haversine_m(r["lat"], r["lon"], *expect) < 0.5
    assert abs(r["gap_m"] - 7990.0) < 5                      # the size of the lie being refused
    assert r["held_s"] == 1.0


def test_hold_does_not_release_while_the_fix_is_still_far_away():
    sg = Safeguard(settings=SafeguardSettings(release_after_clean=3, release_after_long_clean=10))
    sg.update(frame(0, LAT, LON, 95), {"imu_speed_mps": 0.0})
    far = offset(LAT, LON, 3000.0, 0.0)
    sg.update(frame(1, *far, 10, critical=True), {"imu_speed_mps": 0.0})
    # the spoofer now looks clean (trust 90) but keeps the vehicle 3 km away
    modes = [sg.update(frame(i, *far, 90), {"imu_speed_mps": 0.0})["mode"] for i in range(2, 8)]
    assert all(m == "hold" for m in modes)
    # ... and a long clean streak does not release it either: 3 km is not odometer drift
    rs = [sg.update(frame(i, *far, 90), {"imu_speed_mps": 0.0}) for i in range(8, 30)]
    assert all(r["mode"] == "hold" and r["action"] == "CONTINUE" for r in rs) and rs[-1]["gap_m"] > 2900


def test_long_clean_streak_releases_a_fix_that_is_merely_drifted():
    sg = Safeguard(settings=SafeguardSettings(release_after_clean=3, release_after_long_clean=10))
    sg.update(frame(0, LAT, LON, 95), {"imu_speed_mps": 0.0})
    sg.update(frame(1, *offset(LAT, LON, 500.0, 0.0), 20), {"imu_speed_mps": 0.0})
    # the returning fix is 300 m from the estimate: outside the normal tolerance (60 m), inside the long one (600 m)
    near = offset(LAT, LON, 300.0, 0.0)
    rs = [sg.update(frame(i, *near, 90), {"imu_speed_mps": 0.0}) for i in range(2, 14)]
    assert [r["mode"] for r in rs[:9]] == ["hold"] * 9
    rel = next(r for r in rs if r["mode"] == "accept")
    assert 290 < rel["gap_m"] < 310 and rel["rejoined_after_s"] == 11.0


def test_hold_releases_when_a_clean_fix_rejoins_the_estimate():
    sg = Safeguard(settings=SafeguardSettings(release_after_clean=3))
    sg.update(frame(0, LAT, LON, 95), {"imu_speed_mps": 0.0})
    sg.update(frame(1, *offset(LAT, LON, 500.0, 0.0), 20), {"imu_speed_mps": 0.0})
    rs = [sg.update(frame(i, *offset(LAT, LON, 2.0, 1.0), 85), {"imu_speed_mps": 0.0}) for i in range(2, 5)]
    assert [r["mode"] for r in rs] == ["hold", "hold", "accept"]
    assert rs[-1]["rejoined_after_s"] == 4.0


def test_no_fix_still_gives_a_position():
    sg = Safeguard()
    sg.update(frame(0, LAT, LON, 95, hdg=0.0), {"imu_speed_mps": 12.0})
    r = sg.update(frame(1, None, None, 60, fix=False), {"imu_speed_mps": 12.0})
    assert r["mode"] == "hold" and r["action"] == "VERIFY" and r["lat"] is not None and r["gap_m"] is None
    assert haversine_m(r["lat"], r["lon"], *offset(LAT, LON, 0.0, 12.0)) < 0.5


def test_action_bands():
    sg = Safeguard()
    sg.update(frame(0, LAT, LON, 95), {})
    assert sg.update(frame(1, LAT, LON, 40), {})["action"] == "VERIFY"
    assert sg.update(frame(2, LAT, LON, 20), {})["action"] == "ISOLATE"
    assert sg.update(frame(3, LAT, LON, 60, critical=True), {})["action"] == "ISOLATE"


def test_route_projection_picks_the_right_way_where_the_road_doubles_back():
    r = load_routes()["angers_monplaisir_loop"]
    s0 = 2922.0                                               # on the out-and-back section
    lat, lon, brg = r.position_at(s0)
    naive_other = r.project(lat, lon)[0]
    s_dir = r.project(lat, lon, heading=brg, near_s=s0 - 12)[0]
    assert abs(s_dir - s0) < 5.0
    assert abs(naive_other - s0) < 5.0 or abs(naive_other - s0) > 200.0   # the naive answer may land on the other leg


def test_route_odometer_tracks_a_jammed_vehicle():
    r = load_routes()["angers_monplaisir_loop"]
    sg = Safeguard(r)
    s = 2900.0
    lat, lon, brg = r.position_at(s)
    sg.update(frame(0, lat, lon, 95, hdg=brg), {"imu_speed_mps": 11.0})
    errs = []
    for i in range(1, 60):
        s += 11.0
        tlat, tlon, _ = r.position_at(s)
        res = sg.update(frame(i, None, None, 55, fix=False), {"imu_speed_mps": 11.0})
        assert res["mode"] == "hold" and res["source"] == "route_odometer"
        errs.append(haversine_m(res["lat"], res["lon"], tlat, tlon))
    assert max(errs) < 2.0
