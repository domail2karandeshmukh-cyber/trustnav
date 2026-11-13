# Requirements (cahier des charges)

The subject left the form of the solution open. The team wrote the requirements below at the start of the project, and the tutor completed them at the first review, in the last week of October. Each line says what was required, how the delivered system meets it, and where the proof is.

## What the system must do

| # | Requirement | How it is met | Proof |
|---|---|---|---|
| F1 | Give every reported position a trust score from 0 to 100, once per second, for each vehicle or drone | The engine turns each observation into 36 features, judges them with sixteen rules and an anomaly model, and fuses the two risks into one score | [[How it works]], steps 1 to 4 |
| F2 | Detect jamming, spoofing by jump, spoofing by slow drift, and forged Galileo data | Physical rules for the brutal attacks, a model of normal driving for the slow ones, Galileo OSNMA for forged data | [[Results]]: 7 of 7 attack types caught, recall 96.1 % |
| F3 | Say why, in words an operator can check | Every score carries its reasons, each with the measured value and the limit; the console rewrites them in everyday words | [[The console]], Figure 4 |
| F4 | Raise few false alarms | Thresholds sit where motion becomes physically impossible; an incident opens only after three seconds below 50 | [[Results]]: 0.44 % of clean seconds flagged; no false alarm from the rules on a real drive |
| F5 | Respond, not only report | Below 50 the fix is refused, the position handed on is dead-reckoned from the odometer along the route, and the operator gets an action: continue, verify or isolate | [[How it works]], step 5b; [[Results]]: the worst error handed on falls from 8.0 km to 29 m |
| F6 | Work on what a real receiver outputs, not only on the simulator | An adapter reads NMEA and u-blox UBX; a phone can act as the receiver; public recordings of a real drive and of real attacks go through the same detector | [[Results]], replays on real recordings |
| F7 | Be shown live | A web console with the live fleet, the replay of ten recorded runs, the results and the method | https://trustnav.vercel.app and [[The console]] |

## Constraints

| # | Constraint | How it is respected |
|---|---|---|
| C1 | Nothing is ever transmitted: jamming or spoofing a real signal is illegal | Our attacks exist only in software; the real ones are recordings made by others ([[Safety]]) |
| C2 | No extra hardware in the vehicle | TrustNav reads what the receiver already outputs and sits beside it |
| C3 | Numbers that anyone can reproduce | The split between training, validation and held-out routes is fixed; the tables and figures are regenerated from the repository by the commands of [[Appendix: running]] |
| C4 | A service that cannot be written to from outside | Writes need a token, the database enforces row-level security, public reads are synthetic, and no secret is stored in the repository ([[How it works]], step 7) |
| C5 | Tested | 42 automated tests on the engine and 109 end-to-end checks on the console, including an accessibility scan ([[Code guide]]) |
| C6 | Open and documented | A public repository, this report, and a six-page paper in English and in French |

## What the tutor asked at the first review

| Request | Where it is answered |
|---|---|
| All files on GitHub | https://github.com/domail2karandeshmukh-cyber/trustnav |
| Documentation that explains how it works, and the code, step by step | [[How it works]] and [[Code guide]] |
| The objective: what the tool does in real life | [[Objectives]] |
| How it differs from the solutions on the market | [[How TrustNav differs]] |
| Can it be improved further? | [[Critical review]] and [[Roadmap]] |
| Does it prevent attacks, or only detect them? | The response layer: [[How it works]], step 5b, and [[Roadmap]] |

## Out of scope

Transmitting any signal. Removing a jammer or a spoofer from the air: only antenna hardware does that. Safety-critical use such as aviation or maritime navigation, where a certified integrity figure is required.
