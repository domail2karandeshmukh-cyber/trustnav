# Project management

## How the work was organised

Short cycles. Each one ends with a version that is deployed, tested and described, so that the tutor can open the link at any time and see the current state. One public repository holds the engine, the cloud side, the console, the paper and this report, and every change to it redeploys the live demo automatically.

## Timeline

| When | Milestone | What was delivered |
|---|---|---|
| 23 October | First deployed version | The engine (simulator, features, rules, model, fusion), the cloud database and its ingest function, a console built around the map |
| 28 to 30 October | Console and first documentation | Story mode, replay, space-time view, automated checks; the objectives, how it works, the code guide |
| Last week of October | First review with the tutor | Six requests ([[Requirements]]) |
| 3 November | Answer to the first review | The response layer, the real-receiver adapter, the comparison with existing solutions, the roadmap, the ethics notes, this report and a short brief |
| 5 and 6 November | Paper and first real data | A six-page paper in English and in French; the phone as a receiver; the replay of a real u-blox drive and the two weaknesses it exposed |
| 10 November | Material for the oral | Slides, speaker notes, version 11 of the console |
| 11 November | Real attacks | The replay of Jammertest 2024, the sixteenth rule, a console that reads at a glance |
| 13 November | Oral examination | |

## Who did what

The roles are in [[Team]]. In short: one lead for the design, the engine, the cloud side and the console; one member for the evaluation protocol and the testing; one for the study of existing solutions and the review of the documents; one for functional testing, the ethics notes and the material for the oral.

## Tools

| Need | Tool |
|---|---|
| Source, history, review | Git and GitHub, one repository |
| Detection engine | Python and scikit-learn; pytest for its 42 tests |
| Storage and security | Supabase: Postgres with row-level security, and an ingest function protected by a token |
| Console | Next.js and TypeScript, MapLibre for the map; Playwright and axe for its 109 end-to-end checks |
| Deployment | Vercel, automatic on every change |
| Paper | LaTeX, IEEE conference format, in English and in French |

## Quality

- The tables of results in this report and in the paper are generated from the result files that the engine writes.
- Before each release the engine tests and the end-to-end checks are run. A release goes out only when all of them pass.
- At each version the documents are checked against the code: counts, thresholds and references between sections.

## Risks, and what we did about them

| Risk | Answer |
|---|---|
| Testing an attack for real is illegal | Simulation, and recordings made by others |
| No receiver in time | A public recording of a real receiver, the phone as a receiver, an adapter tested on synthetic NMEA and UBX |
| A detector that only works on its own simulator | Held-out routes, replays on real recordings, and the limits stated next to the numbers |
| A live demo that fails in the room | The console falls back to a recorded run when the database cannot be reached, and the replay needs no live data |
| A secret leaking | The ingest token is never in the repository, and public reads are synthetic |
