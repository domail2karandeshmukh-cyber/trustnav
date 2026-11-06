# Roadmap: how TrustNav improves from here

The tutor's questions: *can it be improved more?* and *does it prevent attacks or only detect them?*

**Prevention, honestly.** No software can stop a jammer or a spoofer from transmitting; only antenna hardware mitigates at the radio level. What software *can* prevent is the damage: a fleet system acting on a false position. Since this version (engine 2.1) TrustNav does that with a **response layer** (`engine/trustnav_engine/safeguard.py`): a fix below the trust line is refused, the position handed downstream is estimated from the odometer along the planned route, and the operator receives an action (continue, verify, isolate). Measured on the held-out attacks, the worst position an ordinary screen would show was 8.0 km off; what the response layer passed on was never more than 29 m off, and during the 100 s jamming outage the screen never went blank. That is the prevention story today. Everything below makes it stronger.

## Phase 2: real receiver (next two weeks)

| # | Step | Why | Effort |
|---|---|---|---|
| 0 | **Use a phone as the receiver** (done, v10). The `/phone` page sends the phone's fixes; `python -m trustnav_engine.phone` scores them live; the page can overlay a teleport, a drift or jamming on the real stream. | Real GNSS data through the whole chain today, for free; the overlay shows detection and the response on real data without transmitting anything. The phone has no per-satellite C/N0, clock or OSNMA, so the physics and route rules carry the demo. | done |
| 0b | **Replay a public real-receiver recording** (`python -m trustnav_engine.realcheck`, done): a 27.6-minute u-blox ZED-F9K drive with a SPAN reference. Rules: no false alarm; simulator model: re-calibration needed and demonstrated; overlaid attacks caught in 0, 35 and 1 s. Found and fixed two engine weaknesses (tail-score saturation, unbounded long-clean release). | Real receiver noise and real normal driving without buying anything yet. | done |
| 1 | **Plug in a real receiver.** A u-blox USB receiver on the laptop, `python -m trustnav_engine.receiver --port ... --no-model`. The adapter already exists and is tested on synthetic NMEA/UBX. | First real data. Shows the whole chain live: antenna, engine, cloud, dashboard. | 1 hour once the device arrives |
| 2 | **Record normal drives** with `--jsonl` (walk, tram, car around Angers). | The model's idea of "normal" comes from the simulator. The Stanford study (Kriezis et al., 2025) found thresholds tuned on one receiver failed on another. Real normal data is the only cure. | 2 to 3 hours of recording |
| 3 | **Re-calibrate** the rules' thresholds and retrain the model on those recordings (`calibrate` script, to write). Report the before/after false alarm rate. | Turns the research prototype into something that is honest about a real device. | 1 day |
| 4 | **Replay recorded attacks** through the same pipeline: the FGI Jammertest 2023 recordings (CC BY 4.0) and TEXBAT (research use) are raw RF, so they need a software receiver (GNSS-SDR) or a receiver fed by an SDR replay to produce observables; the Mendeley receiver-observable dataset can be used directly. | Real attack detection numbers, without transmitting anything. | 2 to 4 days |

## Phase 3: stronger evidence

| # | Step | What it catches |
|---|---|---|
| 5 | **Vehicle odometer / OBD-II speed** as the inertial input (`--imu`). | Better dead reckoning during holds; a spoofed speed that disagrees with the wheels. |
| 6 | **Second antenna** on the same vehicle (two cheap receivers 1 to 2 m apart). Two real antennas see slightly different satellites and ranges; a single spoofer makes both report the same position. | Synchronous spoofing that fools every single-antenna check. This is how GPSPatron's probe works. |
| 7 | **Real OSNMA** from raw Galileo pages (UBX-RXM-SFRBX) with an open OSNMA library. | Forged Galileo data on a real receiver, instead of a simulated flag. |
| 8 | **Map matching** with OpenStreetMap roads for vehicles without an assigned route. | Drift onto places where no road exists, for any vehicle, not only fleets with planned routes. |
| 9 | **Supervised model** once labelled real attack data exists, kept beside the unsupervised one. | Known attack signatures with higher recall; the unsupervised model stays for the unknown ones. |

## Phase 4: operations

| # | Step |
|---|---|
| 10 | Alerts by e-mail / SMS / webhook when an incident opens or an action becomes ISOLATE. |
| 11 | Drone integration: feed PX4 / MAVLink telemetry in, and send a "hold / return home on inertial navigation" command out when the response layer says ISOLATE. |
| 12 | Fleet-level analytics: where and when holds happen on a map over weeks (a jammer parked near a depot shows up as a cluster). |
| 13 | Multi-tenant accounts and per-fleet keys, so several operators can share one deployment. |
| 14 | Edge deployment on a Raspberry Pi in the vehicle, sending only scored frames to the cloud. |

## Research questions worth a thesis chapter

- How much detection delay does route-constrained dead reckoning buy back against a slow drift spoofer, as a function of odometer accuracy?
- Can two cheap receivers on one vehicle match a single expensive multi-antenna probe for synchronous spoofing?
- How transferable are "normal" models between receivers of the same chip family (M9 to F9, F9 to X20)?

## Not planned

- Transmitting any jamming or spoofing signal, even in a lab, without a shielded chamber and a licence. All attack testing uses recordings and simulation.
- Safety-critical use (aviation, maritime). The trust score is a research indicator, not a certified integrity figure.
