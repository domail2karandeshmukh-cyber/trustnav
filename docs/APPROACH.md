# Approach and design choices

## How we went from the problem to the solution

1. **Understand the threat and what exists.** We read how jamming and spoofing are carried out, what receivers, fixed probes, anti-jamming antennas, fleet software and Galileo OSNMA each do about them, and what recent papers propose ([[How TrustNav differs]]). The gap we kept: nobody gives a fleet operator a score per vehicle and per second that is explained and acted on.
2. **Start from the operator.** Three questions fix the outputs. Can I believe this position? A score. Why? Reasons in words. What do I do now? An action.
3. **Build the detector where attacks are legal: in software.** A simulator drives vehicles over real streets of Angers and overlays seven types of attack. The routes are split into training, validation and held-out sets, and no route is shared between them.
4. **Measure each part alone, then together.** The rules alone, the model alone and the two fused are scored on the same held-out routes. That comparison is what justified the hybrid design ([[Results]]).
5. **Leave the simulator.** A public recording of a real receiver on a clean drive, then public recordings of real jamming and spoofing, go through the same detector. Each replay exposed weaknesses; each weakness was fixed and is reported ([[Critical review]]).
6. **Make the result readable.** The console gives the verdict in plain words first and keeps the numbers one click behind it.

## Options considered, and why we chose as we did

| Decision | Options considered | Choice | Why |
|---|---|---|---|
| Where to detect | Inside the receiver, on the radio signal. Beside it, on what the receiver outputs | Beside the receiver | It works with any receiver, needs no hardware, and one service can watch a whole fleet. The price: it cannot see the raw radio signal |
| How to detect | Rules only. A supervised classifier. An unsupervised model of normal behaviour. Rules and model together | Rules and an unsupervised model together | Rules alone reach 27.9 % recall, because a slow attack stays under every threshold. A supervised classifier needs labelled real attacks, which we do not have, and learns only the attacks it has seen. The model alone reaches 90.1 % recall with more false alarms (1.33 %). Together: 96.1 % recall at 99.3 % precision |
| Which model | A deep network (autoencoder, recurrent network). An Isolation Forest with a tail detector per feature | Isolation Forest with a tail detector | It trains on about three hours of normal driving, runs once per second on a laptop, and can name the measures that look unusual. A deep network would need more normal data and explains less; we did not try one |
| Where to put the rule thresholds | Where an attack becomes likely. Where the motion becomes physically impossible | Physically impossible | An operator who is alerted all the time stops listening. Set there, the rules raise no false alarm, and the model covers the slow attacks |
| How to fuse two risks | Average. Maximum. Noisy-OR | Noisy-OR, with weights chosen on the validation routes | An average lets a quiet witness dilute a confident one: 90 and 20 average to 55, where the noisy-OR keeps 75. A maximum ignores agreement. With a noisy-OR either witness can raise the alarm, and two together are stronger |
| What to do with a bad fix | Alert only. Freeze the last good position. Dead reckoning | Dead reckoning from the odometer along the planned route, with a rule for rejoining | An alert leaves the false position in the fleet system. A frozen position is wrong for a vehicle that moves. The odometer and the route are two things a spoofer cannot touch |
| How to use Galileo's signatures | As the answer. As one witness among others | One witness | A relayed signal keeps valid signatures while the position is wrong. Only the motion evidence catches it: the stealth drift, after 42 s |
| How to evaluate | Split the seconds at random. Split by route | By route | Seconds of one drive resemble each other, so a random split would let the model see the test. Every reported number comes from routes it never saw |
| Where the data comes from | Our own radio tests. A simulator. Public recordings | A simulator, then public recordings | Transmitting is illegal. The simulator gives the true position for every second; the recordings give real receivers and real attacks |
| How to show it | A desktop program. A web console with a cloud database | Web console | Nothing to install for an operator or a jury, one link, live updates. The engine stays in Python, where the model lives |

## What the analysis changed

| What we looked at | What it showed | What we changed |
|---|---|---|
| Rules, model and fusion measured separately | Rules: no false alarm, but 27.9 % recall. Model: 90.1 % recall, but 1.33 % false alarms | The two are fused by a noisy-OR whose weights are chosen on the validation routes |
| The tutor's question: prevention, or only detection? | An alert does not stop a fleet system from acting on a false position | The response layer (engine 2.1) |
| A clean drive of a real u-blox receiver | The rules stayed silent. The model, trained on the simulator, found real driving unusual | Re-calibration on the receiver, and two engine weaknesses fixed (tail-score saturation, unbounded long-clean release) |
| Recordings of real jamming and spoofing | The fifteen rules missed a captured phone for 21 min 49 s: nothing in the stream was physically impossible, but the spoofer had set the clock back an hour | A sixteenth rule on receiver time, and four more weaknesses fixed (engine 2.2) |
| The console in front of a reader | Results and Method were long documents, and on a 1280-wide screen the panels over the map overlapped | Five one-screen tabs per page, and a layout that is measured at 1280 and 1366 wide |
