# Real receiver recording

`MTV.Local1.ublox-F9K.20200206-181434.nmea` is a 27.6-minute NMEA log from a
u-blox ZED-F9K receiver driving a loop in Mountain View, California, on
7 February 2020 (UTC), and `MTV.Local1.SPAN.20200206-181434.gga` is the
reference trajectory of the same drive from a NovAtel SPAN GNSS/INS system.
Both come from Google's `gps-measurement-tools` repository
(`NmeaUtils/example/`, https://github.com/google/gps-measurement-tools),
licensed under the Apache License 2.0, and are redistributed here unchanged.

`python -m trustnav_engine.realcheck` replays the drive through the TrustNav
adapter and detector, re-calibrates the anomaly model on the first part of it
and overlays software attacks on the rest; the results are written to
`paper/figures/realcheck.json`. Nothing is transmitted: the attacks are
arithmetic on the recording.
