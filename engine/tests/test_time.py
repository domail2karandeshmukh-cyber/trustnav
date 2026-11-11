"""Time as a measurement: the receiver's clock is checked, and nothing is stepped on it. Run with: python -m pytest -q

These checks came out of replaying real attack recordings (trustnav_engine.attackcheck): a spoofer that captured a
phone set its satellite time back by an hour, and the published rules, which trusted that time, saw nothing."""

from trustnav_engine.demo_feed import chosen_settings
from trustnav_engine.geo import haversine_m, offset
from trustnav_engine.pipeline import Detector
from trustnav_engine.safeguard import Safeguard

LAT, LON = 47.4700, -0.5500
T0 = 1_726_045_000          # 11 September 2024, 08:56:40 UTC


def iso(ts):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def obs(seq, rx_time, host=None, east=0.0, speed=0.0):
    lat, lon = offset(LAT, LON, east, 0.0)
    o = {"seq": seq, "t": iso(rx_time), "lat": lat, "lon": lon, "speed_mps": speed, "heading_deg": 90.0, "sats": 10,
         "cn0_mean_dbhz": 40.0, "cn0_std_dbhz": 4.0, "pdop": 1.2, "osnma": "unknown"}
    if host is not None:
        o["host_t"] = float(host)
    return o


def run(stream):
    det = Detector(None, None, "generic_road_vehicle", chosen_settings(), "RX", "test")
    return [det.process(o)[0] for o in stream]


def codes(frame):
    return {w["code"] for w in frame["why"]}


def test_receiver_time_set_back_is_critical_for_as_long_as_it_lasts_against_the_host_clock():
    # a parked receiver; from second 20 to 49 its time reads an hour early, the host clock runs on
    stream = [obs(i, T0 + i - (3600 if 20 <= i < 50 else 0), host=T0 + i + 1) for i in range(70)]
    frames = run(stream)
    assert all("R_TIME_JUMP" not in codes(f) and f["trust"] >= 90 for f in frames[:20])
    assert all("R_TIME_JUMP" in codes(f) and f["trust"] <= 30 and f["resp"]["mode"] == "hold" for f in frames[20:50])
    assert "3,600 s back against the host clock" in next(w["detail"] for w in frames[20]["why"] if w["code"] == "R_TIME_JUMP")
    assert all("R_TIME_JUMP" not in codes(f) for f in frames[50:])
    assert frames[-1]["resp"]["mode"] == "accept"          # five clean seconds and a fix where the estimate is: released


def test_time_running_backwards_is_caught_without_a_host_clock_and_a_gap_is_not():
    times = [T0 + i for i in range(20)]                    # one second at a time
    times += [T0 + 20 + 300 + i for i in range(10)]        # a five-minute hole in the log: time moves forward, no proof
    times += [times[-1], times[-1] + 2]                    # the same second twice, then on: a rounding artefact
    back = times[-1] - 3358
    times += [back + i for i in range(30)]                 # 56 minutes back, then ticking as if nothing happened
    times += [times[31] + 34 + i for i in range(10)]       # true time again
    frames = run([obs(i, t) for i, t in enumerate(times)])
    assert all("R_TIME_JUMP" not in codes(f) for f in frames[:32])
    assert all("R_TIME_JUMP" in codes(f) for f in frames[32:62])
    assert "against its own one-per-second count" in next(w["detail"] for w in frames[32]["why"] if w["code"] == "R_TIME_JUMP")
    assert all("R_TIME_JUMP" not in codes(f) for f in frames[62:])
    assert frames[32]["f"]["derived_speed_mps"] < 1.0       # the jump back does not turn a parked car into a rocket


def test_a_step_of_the_host_clock_is_not_blamed_on_the_receiver():
    # the gateway boots with a wrong clock and the network sets it a day later: the receiver ticked on normally
    stream = [obs(i, T0 + i, host=T0 + i - (86400 if i < 30 else 0)) for i in range(60)]
    assert all("R_TIME_JUMP" not in codes(f) for f in run(stream))


def test_position_jump_limit_scales_with_the_time_since_the_last_fix():
    # 800 m further after forty seconds without a fix is a car at 20 m/s leaving a tunnel, not a jump
    tunnel = [obs(i, T0 + i, east=20.0 * i, speed=20.0) for i in range(10)] + [obs(10, T0 + 49, east=20.0 * 49, speed=20.0)]
    assert "R_POSITION_JUMP" not in codes(run(tunnel)[-1])
    # the same 800 m in one second is
    jump = [obs(i, T0 + i, east=20.0 * i, speed=20.0) for i in range(10)] + [obs(10, T0 + 10, east=1000.0, speed=20.0)]
    assert "R_POSITION_JUMP" in codes(run(jump)[-1])


def test_a_hold_is_stepped_on_the_clock_so_skipped_seconds_do_not_shorten_the_distance():
    sg = Safeguard()
    f = lambda seq, trust, fix=True: {"s": seq, "lat": LAT if fix else None, "lon": LON if fix else None, "trust": trust,
                                      "fix": fix, "hdg": 90.0, "spd": 10.0, "why": []}
    sg.update(f(0, 95), {"imu_speed_mps": 10.0}, clock=100.0)
    sg.update(f(1, 20), {"imu_speed_mps": 10.0}, clock=101.0)                 # refused: the hold begins, one second on
    r = sg.update(f(2, 20), {"imu_speed_mps": 10.0}, clock=131.0)             # the next observation comes 30 s later
    assert abs(haversine_m(LAT, LON, r["lat"], r["lon"]) - 310.0) < 1.0
