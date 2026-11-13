# Glossary

| Term | Meaning |
|---|---|
| GNSS | Global Navigation Satellite System: GPS, Galileo, GLONASS and BeiDou together |
| Receiver, fix | The device that computes a position from the satellite signals. A fix is one computed position |
| Jamming | Radio noise that drowns the satellite signals: the receiver loses its position |
| Spoofing | False signals that imitate the satellites: the receiver computes a wrong position and does not know it |
| Relay (meaconing) | Genuine signals recorded and sent again: the data stays authentic while the position is wrong |
| OSNMA | Open Service Navigation Message Authentication: the digital signature Galileo adds to its navigation data |
| C/N0 | Carrier-to-noise density, in dB-Hz: how strong each satellite's signal is at the receiver |
| PDOP | Position dilution of precision: how well the satellites are spread across the sky (lower is better) |
| Pseudorange residual | How far the measured distance to a satellite is from the distance the computed position implies |
| NMEA, UBX | The text format and the u-blox binary format in which receivers output their data |
| Odometer | Distance or speed measured by the vehicle itself, independent of the satellites |
| Dead reckoning | Estimating the position from the last trusted one, the speed and the direction |
| Feature | A number computed from the observations (speed, jump, distance from the route, and so on). The detector uses 36 |
| Rule | A check against a named physical limit. There are sixteen |
| Isolation Forest | An unsupervised model that scores how easily an observation is separated from normal ones |
| Noisy-OR | A way to combine independent evidence: risk = 1 − (1 − a)(1 − b). Either source can raise the alarm |
| Trust score | 100 minus the combined risk. Trusted from 75, degraded from 50, suspicious from 25, untrusted below |
| Incident | Opened when a platform stays below 50 for three seconds |
| Hold, release | The response layer refuses fixes (hold) and accepts them again (release) once a clean fix rejoins its estimate |
| Precision | The share of alerts that were real attacks |
| Recall | The share of attacked seconds that raised an alert |
| False alarm rate | The share of clean seconds wrongly flagged |
| F1 | The harmonic mean of precision and recall |
| Held-out | Data kept away from training and tuning, used only to report results |
| Row-level security | Database rules that decide, row by row, who may read or write |
