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
3. **Few false alarms.** An operator who is alerted constantly stops listening. Normal data in our tests produces a false alarm rate of 0.44%.
4. **Same code for demo and real life.** The demo runs through the exact detector a real receiver would use.
5. **Safe.** All attacks are simulated in software. No radio signal is ever transmitted.

## Measured results (held-out routes, synthetic data)

| | Rules only | Model only | **Hybrid (TrustNav)** |
|---|---|---|---|
| Precision | 100% | 97.9% | **99.3%** |
| Recall | 27.9% | 90.1% | **96.1%** |
| F1 | 0.437 | 0.939 | **0.977** |
| False alarm rate | 0% | 1.33% | **0.44%** |

7 of 7 attack types are caught. The numbers are an upper bound, because one simulator produces every data split. Real-world data is the next step.

## Limits (honest)

- Data is **simulated**, not yet from a real receiver.
- The detector learned from one simulator, so results on real receivers will differ.
- It detects and explains. It does not yet recover the true position or switch to a backup.

## Next steps (Phase 2)

1. Connect a **real GNSS receiver and antenna** (receive-only) through the existing ingest endpoint.
2. Replay **recorded attack data** (for example the Jammertest recordings) through the same pipeline.
3. Add a **second antenna** or an **inertial sensor** so two independent sources can be compared.
4. Add alerts by email or SMS, and a drone test with a PX4 flight controller.
5. Retrain and re-measure on real data, and report the difference honestly.
