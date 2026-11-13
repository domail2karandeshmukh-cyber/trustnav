# Objectives: what TrustNav does in real life

## The problem

Almost everything that moves today trusts its satellite position (GPS, Galileo, GLONASS, BeiDou, together called GNSS) without question: delivery vans, trucks, taxis, ambulances, trams, ships, agricultural machines and drones.

That trust is easy to break:

- **Jamming**: a small radio transmitter drowns the weak satellite signal. The receiver loses its position. Cheap jammers (about €30) are sold illegally online and are used by drivers who want to hide from fleet trackers, and by thieves.
- **Spoofing**: a transmitter imitates the satellites and feeds the receiver a false position. The receiver does not know it is being lied to, and reports a wrong but believable position.

Satellite signals are extremely weak (the satellites are about 20,000 km away), so a small nearby transmitter overpowers them. Since 2022 jamming and spoofing have become a daily event in parts of Europe, near conflict zones, ports and airports.

Most fleet software only displays the position it receives. It does not ask whether the position is true.

## The objective

> Tell the operator, once per second, for every vehicle and drone, **how much its reported position can be believed**, and **why**, in plain words.

TrustNav does not replace the receiver. It sits next to it and acts as a second opinion.

## What the tool does, in real life

| Real situation | What happens without TrustNav | What TrustNav does |
|---|---|---|
| A van's tracker is spoofed so it appears 8 km away | The dispatcher sees a normal dot on the wrong street | Raises a **Position jump** alert within seconds: the vehicle cannot move 8 km in one second |
| A driver uses a €30 jammer to hide | The dot freezes or vanishes with no explanation | Flags **RF interference detected** from the receiver's jamming indicator and signal strength collapse, then tracks the **recovery** |
| A slow, careful spoofer pulls a vehicle 1 m/s off the road | Nothing looks wrong for minutes | The machine-learning layer notices the position and signal no longer match normal driving, in about 42 s in our tests (a fixed 150 m rule alone needs about 3.5 minutes) |
| A forged Galileo message | The receiver accepts it | **Galileo OSNMA** (the digital signature on Galileo data) fails verification, which is strong evidence of forgery |
| A drone on a survey mission is pushed off its plan | The pilot sees the drone "on course" | Compares the position with the mission route and the drone's physical limits |

## Who would use it

- **Fleet operators** (delivery, logistics, taxis, public transport) who need to know whether a vehicle is really where it says.
- **Insurers and cargo security**, where jamming is used in thefts.
- **Drone operators** (inspection, mapping, agriculture, medical delivery).
- **Critical services**: emergency vehicles, ports, rail, energy sites.

## Design goals

1. **Explainable.** Every score comes with named reasons and the exact value and threshold that triggered it, so an analyst can check an alert by hand.
2. **Hybrid.** Three kinds of evidence work together, because each misses something the others catch:
    - *Rules*: physical limits that are impossible to break (speed, jump distance, acceleration).
    - *Machine learning*: spots strange combinations that no single rule was written for.
    - *Galileo OSNMA*: cryptographic authentication supplied by the satellites.
3. **Few false alarms.** An operator who is alerted constantly stops listening. Normal data in our tests produces a false alarm rate of 0.44 %.
4. **Responds, not only reports.** A fix the engine does not believe is refused; the position handed to dispatch, geofencing or flight control is estimated from the odometer along the route, and the operator gets an action: continue, verify or isolate.
5. **Same code for demo and real life.** The demo runs through the exact detector a real receiver would use, and the receiver adapter already speaks NMEA and u-blox UBX.
6. **Safe.** Our own attacks are simulated in software; the real ones are recordings made by others. No radio signal is ever transmitted.

## Measured results (held-out routes, synthetic data)

| | Rules only | Model only | **Hybrid (TrustNav)** |
|---|---|---|---|
| Precision | 100% | 97.9% | **99.3%** |
| Recall | 27.9% | 90.1% | **96.1%** |
| F1 | 0.437 | 0.939 | **0.977** |
| False alarm rate | 0% | 1.33% | **0.44%** |

7 of 7 attack types are caught. The numbers are an upper bound, because one simulator produces every data split.

**On real recordings.** A clean 27.6-minute drive of a real u-blox receiver: no false alarm from the rules; the model has to be re-calibrated on the receiver. Recordings of **real attacks** (Jammertest 2024, Norway): a phone captured by a spoofer for 26.5 minutes ended 10.2 km from the truth. The version first published alerted after 21 min 49 s and refused 5 of 909 captured fixes; with a sixteenth rule that checks the receiver's time against the clock of the device it is plugged into, the alert comes in the same second and all 909 are refused, with no false alert in the clean periods. Real jamming of a u-blox receiver is alerted in 15 of 20 exposures.

**What the response layer prevents** (same held-out attacks, error against ground truth): the worst position an ordinary fleet screen would show is **8.0 km** off (teleport spoof); what TrustNav hands on is never more than **29 m** off. During the jamming outage an ordinary screen is blank for **100 s**; TrustNav keeps an estimated position the whole time, within 2 m.

## Limits (honest)

- The detection table is **simulated**. The real recordings replayed so far (one clean drive, two days of real jamming and spoofing) are evidence, not yet a statistic.
- The model learned from one simulator, so it must be re-calibrated on each real receiver; this was needed, and done, on both real recordings.
- The time rule needs a second clock (the phone's or the gateway's), or a spoofer that moves time backwards.
- It detects, explains and refuses bad fixes. It cannot remove a jammer or a spoofer from the air; only antenna hardware does that.
- Its estimate during a hold drifts with the odometer (about 3 % of the distance), so long holds need the operator to verify by other means.

## Next steps (Phase 2)

1. Connect a **real GNSS receiver and antenna** (receive-only) through the existing ingest endpoint.
2. Run the **raw radio recordings** of attacks (Jammertest 2023, TEXBAT) through a software receiver; the receiver-level recordings of Jammertest 2024 are already replayed.
3. Add a **second antenna** or an **inertial sensor** so two independent sources can be compared.
4. Add alerts by email or SMS, and a drone test with a PX4 flight controller.
5. Retrain and re-measure on real data, and report the difference honestly.
