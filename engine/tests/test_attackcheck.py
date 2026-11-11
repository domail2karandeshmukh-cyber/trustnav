"""Loaders of the real attack check. The recordings themselves are downloaded on demand and are not needed here.
Run with: python -m pytest -q"""

from trustnav_engine.attackcheck import load_tests, phone_observations, state, ublox_observations


def nmea(body):
    x = 0
    for ch in body:
        x ^= ord(ch)
    return f"${body}*{x:02X}"


def test_gnsslogger_lines_carry_the_phones_own_clock(tmp_path):
    # GnssLogger writes "NMEA,<sentence>,<system clock in ms>"; in the third second the satellite time is an hour early
    lines = []
    for k, gnss in enumerate(("085645.52", "085646.52", "075647.52")):
        ms = 1726045005560 + 1000 * k
        lines.append(f"NMEA,{nmea(f'GPRMC,{gnss},A,6912.726,N,01551.501,E,0.0,,110924,9.0,E,A,V')},{ms}")
        lines.append(f"NMEA,{nmea(f'GPGGA,{gnss},6912.726,N,01551.501,E,1,08,1.5,22.0,M,35.8,M,,')},{ms}")
    path = tmp_path / "gnss_log.nmea"
    path.write_text("\n".join(lines) + "\n")
    obs = phone_observations(path)
    assert [o["t"] for o in obs] == ["2024-09-11T08:56:45Z", "2024-09-11T08:56:46Z", "2024-09-11T07:56:47Z"]
    assert [round(o["host_t"] - obs[0]["host_t"]) for o in obs] == [0, 1, 2]        # the phone's clock ran on
    assert obs[0]["t_frac"] == 0.52 and obs[0]["sats"] == 8


def test_a_two_hertz_log_is_thinned_to_one_observation_a_second(tmp_path):
    lines = []
    for t in ("073207.00", "073207.50", "073208.00", "073208.50", "073209.00"):
        lines.append(nmea(f"GNRMC,{t},A,6915.93273,N,01557.44160,E,0.005,,100924,,,D,V"))
        lines.append(nmea(f"GNGGA,{t},6915.93273,N,01557.44160,E,2,12,0.48,7.4,M,34.4,M,,0136"))
    path = tmp_path / "log.ubx"
    path.write_text("\r\n".join(lines) + "\r\n")
    obs = ublox_observations(path)
    assert [o["t"][-9:] for o in obs] == ["07:32:07Z", "07:32:08Z", "07:32:09Z"] and [o["seq"] for o in obs] == [0, 1, 2]


def test_seconds_are_sorted_into_test_no_test_margin_and_clean(tmp_path):
    meta = tmp_path / "meta.json"
    meta.write_text('{"Tests": [{"test": "2.6.2", "name": "spoofer", "start_utc": "2024-09-11T085959", "end_utc": "2024-09-11T092217"},'
                    ' {"test": "0.0.1", "name": "No test", "start_utc": "2024-09-11T101110", "end_utc": "2024-09-11T102325"}]}')
    tests = load_tests(meta)
    t = lambda hms: tests[0]["start"] + (int(hms[:2]) * 3600 + int(hms[3:5]) * 60 + int(hms[6:])) - (8 * 3600 + 59 * 60 + 59)
    assert state(t("09:10:00"), tests) == "attack" and state(t("10:15:00"), tests) == "none"
    assert state(t("08:58:00"), tests) == "margin" and state(t("08:40:00"), tests) == "clean"
