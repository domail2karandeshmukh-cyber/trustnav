"""Receiver adapter checks: NMEA and UBX bytes become engine observations."""

import struct

from trustnav_engine.receiver import EpochBuilder, observations, parse_nmea, parse_ubx, ubx_frames


def nmea(body):
    x = 0
    for ch in body:
        x ^= ord(ch)
    return f"${body}*{x:02X}\r\n"


def ubx(cls, mid, payload):
    body = bytes([cls, mid]) + struct.pack("<H", len(payload)) + payload
    a = b = 0
    for x in body:
        a = (a + x) & 0xFF
        b = (b + a) & 0xFF
    return b"\xb5\x62" + body + bytes([a, b])


def epoch(t, lat_dm, lon_dm, sats, snrs, pdop, knots, course):
    lines = [
        nmea(f"GNRMC,{t},A,{lat_dm},N,{lon_dm},W,{knots},{course},031126,,,A"),
        nmea(f"GNGGA,{t},{lat_dm},N,{lon_dm},W,1,{sats:02d},0.9,48.0,M,47.0,M,,"),
        nmea(f"GNGSA,A,3,01,02,03,04,05,06,07,08,,,,,{pdop},0.9,1.2"),
    ]
    groups = [snrs[i:i + 4] for i in range(0, len(snrs), 4)]
    for n, g in enumerate(groups, 1):
        fields = ",".join(f"{10 + 4 * (n - 1) + k:02d},45,{90 * k},{s:02d}" for k, s in enumerate(g))
        lines.append(nmea(f"GPGSV,{len(groups)},{n},{len(snrs)},{fields}"))
    return "".join(lines).encode()


def test_nmea_sentences_parse():
    k, d = parse_nmea(nmea("GNGGA,101530.00,4728.2345,N,00033.1234,W,1,09,0.9,48.0,M,47.0,M,,"))
    assert k == "GGA" and abs(d["lat"] - 47.470575) < 1e-5 and abs(d["lon"] - -0.55206) < 1e-5 and d["sats"] == 9
    k, d = parse_nmea(nmea("GNRMC,101530.00,A,4728.2345,N,00033.1234,W,21.5,87.3,031126,,,A"))
    assert k == "RMC" and abs(d["speed_mps"] - 21.5 * 0.514444) < 1e-6 and d["heading_deg"] == 87.3
    assert parse_nmea("$GNGGA,bad*00") is None


def test_two_epochs_become_two_observations():
    data = epoch("101530.00", "4728.2345", "00033.1234", 9, [41, 44, 39, 42, 45, 40, 38, 43, 41], 1.8, "21.5", "87.3")
    data += epoch("101531.00", "4728.2400", "00033.1100", 9, [41, 44, 39, 42, 45, 40, 38, 43, 41], 1.8, "21.6", "87.0")
    obs = list(observations([data]))
    assert len(obs) == 2
    o = obs[0]
    assert o["t"] == "2026-11-03T10:15:30Z" and o["seq"] == 0
    assert o["sats"] == 9 and abs(o["cn0_mean_dbhz"] - 41.44) < 0.01 and o["cn0_std_dbhz"] > 2
    assert o["pdop"] == 1.8 and abs(o["speed_mps"] - 11.06) < 0.01 and o["heading_deg"] == 87.3
    assert o["osnma"] == "unknown" and o["jam_ind"] is None and o["imu_speed_mps"] is None
    assert obs[1]["seq"] == 1 and obs[1]["t"].endswith("10:15:31Z")


def test_no_fix_epoch_has_no_position():
    eb = EpochBuilder()
    eb.feed("GGA", {"time": "101530.00", "lat": None, "lon": None, "quality": 0, "sats": 2, "hdop": None})
    o = eb.finish()
    assert o["lat"] is None and o["sats"] == 2


def test_ubx_frames_and_messages():
    mon = bytearray(60)
    mon[45] = 173                   # jamInd
    mon[22] = 0b00001000            # jammingState = 2 (warning)
    nav_clock = struct.pack("<Iii", 123000, -4521, 37) + bytes(8)
    status = bytes(16)
    pvt = bytearray(92)
    struct.pack_into("<HBBBBB", pvt, 4, 2026, 11, 3, 10, 15, 30)
    struct.pack_into("<BBBB", pvt, 20, 3, 1, 0, 11)            # 3D fix, gnssFixOK, 11 sats
    struct.pack_into("<ii", pvt, 24, int(-0.5520 * 1e7), int(47.4706 * 1e7))
    struct.pack_into("<ii", pvt, 60, 11060, int(87.3 * 1e5))
    struct.pack_into("<H", pvt, 76, 180)
    sat = bytearray(8 + 12 * 2)
    sat[5] = 2
    struct.pack_into("<BBBbhhI", sat, 8, 0, 1, 42, 45, 90, 18, 0b1000)     # used, cno 42, prRes 1.8 m
    struct.pack_into("<BBBbhhI", sat, 20, 2, 3, 38, 30, 180, -25, 0b1000)  # used, cno 38, prRes 2.5 m
    stream = ubx(0x01, 0x07, bytes(pvt)) + b"noise" + ubx(0x01, 0x22, nav_clock) + ubx(0x01, 0x03, status) \
        + ubx(0x01, 0x35, bytes(sat)) + ubx(0x0A, 0x09, bytes(mon))
    frames, rest = ubx_frames(stream)
    assert len(frames) == 5 and rest == b""
    k, d = parse_ubx(*frames[4])
    assert k == "MONHW" and d["jam_ind"] == 173 and d["jamming_state"] == 2
    obs = list(observations([stream, ubx(0x01, 0x07, bytes(pvt))]))   # second PVT closes the first epoch
    assert len(obs) == 2
    o = obs[0]
    assert o["t"] == "2026-11-03T10:15:30Z" and abs(o["lat"] - 47.4706) < 1e-6 and o["sats"] == 11
    assert o["pdop"] == 1.8 and abs(o["speed_mps"] - 11.06) < 1e-6
    assert o["clock_bias_ns"] == -4521 and o["clock_drift_nsps"] == 37 and o["jam_ind"] == 173
    assert o["cn0_mean_dbhz"] == 40.0 and abs(o["pr_residual_m"] - 2.15) < 1e-6


def test_live_detector_scores_receiver_observations():
    from trustnav_engine.evaluate import MODEL_DIR
    from trustnav_engine.model import AnomalyModel
    from trustnav_engine.pipeline import Detector

    det = Detector(AnomalyModel.load(MODEL_DIR), None, "generic_road_vehicle", device_id="RX-01", scenario="receiver")
    data = b""
    lat, lon = 4728.2345, 33.1234
    for i in range(12):
        # C/N0 spread like the simulator's normal driving (about 4 to 5 dB-Hz); a flatter spread reads as spoofer-like
        data += epoch(f"1015{30 + i:02d}.00", f"{lat + 0.006 * i:.4f}", f"{lon - 0.004 * i:08.4f}", 9,
                      [36, 44, 39, 47, 45, 35, 38, 43, 49], 1.8, "21.5", "87.3")
    trusts = [det.process(o)[0]["trust"] for o in observations([data])]
    assert len(trusts) == 12 and all(t >= 50 for t in trusts)


def test_rules_only_mode_has_no_model_risk():
    from trustnav_engine.pipeline import Detector

    det = Detector(None, None, "generic_road_vehicle", device_id="RX-01", scenario="receiver")
    data = epoch("101530.00", "4728.2345", "00033.1234", 9, [41, 44, 39, 42, 45, 40, 38, 43, 41], 1.8, "21.5", "87.3")
    data += epoch("101531.00", "4728.2400", "00033.1100", 9, [41, 44, 39, 42, 45, 40, 38, 43, 41], 1.8, "21.6", "87.0")
    frames = [det.process(o)[0] for o in observations([data])]
    assert all(f["mr"] is None and f["trust"] == 100.0 for f in frames)


def test_sentence_glued_to_a_binary_frame_is_still_read():
    # a u-blox sends binary and text on one port: the first sentence of a second follows a binary frame with no
    # line break between them (found on a real log: every RMC was lost, and with it the date)
    raw = ubx(0x02, 0x15, b"\x00" * 16) + nmea("GNRMC,075705.00,A,6912.74122,N,01551.51408,E,0.010,,110924,,,D,V").encode()
    raw += nmea("GNGGA,075705.00,6912.74122,N,01551.51408,E,2,12,0.53,8.1,M,34.4,M,,0123").encode()
    raw += ubx(0x02, 0x15, b"\x24" * 16) + nmea("GNRMC,075706.50,A,6912.74122,N,01551.51408,E,0.010,,110924,,,D,V").encode()
    out = list(observations([raw]))
    assert [o["t"] for o in out] == ["2024-09-11T07:57:05Z", "2024-09-11T07:57:06Z"]
    assert out[0]["sats"] == 12 and out[1]["t_frac"] == 0.5 and not out[0]["time_unknown"]


def test_satellite_count_is_unknown_when_the_sentence_that_carries_it_is_dropped():
    # an overloaded receiver drops GGA now and then; the count must not fall back to the number of signals seen
    lines = nmea("GNRMC,101400.00,A,6916.20329,N,01557.54658,E,0.005,,100924,,,D,V")
    lines += nmea("GPGSV,2,1,08,03,56,130,46,04,55,185,42,06,49,282,48,09,27,216,44,1")
    lines += nmea("GPGSV,2,2,08,11,15,315,35,12,12,327,34,17,13,236,41,19,25,254,41,1")
    o = list(observations([lines.encode()]))[0]
    assert o["sats"] is None and o["cn0_mean_dbhz"] is not None
