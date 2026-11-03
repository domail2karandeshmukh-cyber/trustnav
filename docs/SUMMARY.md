# TrustNav in one page

**What.** TrustNav is live trust monitoring for satellite positions. For every vehicle and drone in a fleet, once per second, it answers *"can this position be believed?"* with a score from 0 to 100, says *why* in plain words, and, since version 2.1, *acts*: a position it does not believe is refused and replaced by an estimate from the odometer along the planned route, with a recommended action for the operator.

**Why.** Jamming (drowning the satellite signal) and spoofing (faking it) have become everyday events in Europe. The equipment costs 30 to 300 EUR. Ordinary fleet software shows whatever position the receiver reports and never asks whether it is true. Existing detection products either live inside one receiver and output a flag with no explanation, or are fixed monitoring stations for sites; none gives a fleet operator a per-vehicle, explained, actionable trust score (see `COMPARISON.md`).

**How.** Three kinds of evidence, fused:

1. **Rules.** Fifteen physical checks (a van cannot move 8 km in a second; a signal cannot be stronger and more uniform than real satellites) with named thresholds, so every alert can be verified by hand.
2. **Model.** An Isolation Forest and a per-feature tail detector trained on *normal* driving only, which notice the slow, careful attacks the rules miss (a van 12 m off its road).
3. **Galileo OSNMA.** The satellites' own digital signatures (operational since July 2025): a failed signature is strong evidence of forgery.

Rules and model are combined by noisy-OR (either witness can raise the alarm); trust = 100 minus the combined risk. An incident opens after three seconds below 50. The response layer refuses fixes below 50, dead-reckons along the route and releases only when a clean fix rejoins the estimate.

**Results** (held-out routes, synthetic data): precision 99.3 %, recall 96.1 %, F1 0.977, false alarm rate 0.44 %, 7 of 7 attack types caught; the stealth drift (OSNMA still valid) is caught after 42 s, where a fixed 150 m rule would need about 3.5 minutes. Response layer: worst position error seen by an ordinary screen 8.0 km, after the response layer 29 m; jamming blank screen 100 s without, 0 s with.

**Built.** Python engine (36 features, 15 rules, scikit-learn, 23 automated tests), Supabase cloud (Postgres, row-level security, realtime, token-authenticated ingest), Next.js console with a 3D street map of Angers, replay of ten recorded scenarios, a narrated attack story, a space-time view, and a live demo at https://trustnav.vercel.app. A receiver adapter for u-blox NMEA/UBX output is written and tested, ready for the first real antenna.

**Limits.** All data so far is simulated by one simulator, so the numbers are an upper bound. Nothing is transmitted; attacks exist only in software. It detects and responds; it cannot remove a jammer from the air.

**Next.** Plug in a real receiver (about 60 to 250 EUR), record normal drives around Angers, re-calibrate, then replay public attack recordings (Jammertest, TEXBAT) through the same pipeline. See `ROADMAP.md`.

**Team.** Group 2, MSc Cybersecurity & Data Science, ESAIP Angers: Karan Deshmukh, Sudheer Reddy Jogi, Niranjan Satheesh Thandassery, Venkata Pavan Kumar Sanam. Tutor: Sofiane Hamrioui.
