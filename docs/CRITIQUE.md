# Critical review and perspectives

## What holds

- On the held-out catalogue the design does what it set out to do: every type of attack is caught, six of seven within one second, with 0.44 % of clean seconds flagged.
- The response layer changes what an operator sees: the worst false position handed on falls from 8.0 km to 29 m, and a jammed vehicle keeps an estimated position where an ordinary screen goes blank.
- The same pipeline ran on a real receiver and on real attacks. What had to change for that is listed below.
- It can be checked: the code, the tests, the data splits and this report are public.

## What does not hold yet

- **The detection table is simulated.** One simulator produced the training, validation and test data, so those numbers are an upper bound.
- **The real evidence is small.** One clean drive and two days of one test campaign, on two devices. That is evidence, not a statistic.
- **The model does not transfer by itself.** Its idea of normal came from the simulator, and it had to be re-calibrated on each real device.
- **The time rule has a condition.** It needs a second clock (the phone's, a gateway's) or a spoofer that moves time backwards. A spoofer that keeps time right must be caught by the other witnesses.
- **The response layer needs an odometer and a route.** Its estimate drifts by about 3 % of the distance travelled, so a long hold has to be verified by other means.
- **Galileo authentication is simulated in our own scenarios.** Real OSNMA, read from raw Galileo pages, is not in the engine yet.
- **Software cannot clear the air.** TrustNav detects, explains and refuses. It does not remove a jammer.

## What we got wrong, and corrected

| What we had | What showed it | What we did |
|---|---|---|
| Fifteen rules, published as complete | A phone captured by a real spoofer went unnoticed for 21 min 49 s | Receiver time became a measurement, checked against the clock of the host: the sixteenth rule. The miss is reported in the paper and in this report |
| A model calibrated on the simulator | On a real drive it flagged normal driving | Calibration on the device, and the statement that it is required |
| Detection presented as protection | The tutor's question at the first review | The response layer |
| A console written like a report | A reader had to scroll through six screens of tables | One message per screen, explanations on demand |

## What we would do differently

- Bring in real recordings in the first week, not the last. The two replays changed the engine more than any simulated test did.
- Have a receiver on the table from the first week, so that normal drives around Angers are recorded early and the model is calibrated on them.
- Write the evaluation split and the claims before the code, so that no number can drift with the implementation.

## Perspectives

The plan, with effort and priorities, is in [[Roadmap]]. In short:

1. **Our own receiver.** Record normal drives, re-calibrate, and measure the false alarm rate again.
2. **More real attacks.** The raw radio recordings of Jammertest 2023 and TEXBAT, through a software receiver.
3. **Stronger evidence.** The vehicle's own odometer (OBD-II), a second antenna, real Galileo OSNMA, map matching for vehicles without a planned route.
4. **Operations.** Alerts by e-mail or SMS, a link to a drone autopilot (PX4), an edge box in the vehicle.
