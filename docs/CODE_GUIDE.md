# Code guide: every file and what it does

## Folder map

```
trustnav/
├── README.md                      overview, results, how to run
├── docs/                          this documentation
├── engine/                        Python detection engine
│   ├── requirements.txt           numpy, scikit-learn, joblib, pytest
│   ├── models/current/            trained model (model.joblib, model.json) + chosen fusion weights (fusion.json)
│   ├── tests/                     23 automated tests (engine, response layer, receiver adapter)
│   └── trustnav_engine/
├── dashboard/                     Next.js web app
│   ├── app/                       page shell, global styles, icon
│   ├── components/                the screens and widgets
│   ├── lib/                       data hook, types, helpers
│   ├── public/data/               recorded data the page can play without a database
│   └── tests/e2e.py               98 end-to-end checks
└── supabase/
    ├── migrations/                database schema and functions, in order
    ├── functions/ingest/          the secure write endpoint
    └── load_demo_feed.sql         loads the demo data
```

## Engine (`engine/trustnav_engine/`)

| File | Lines | What it does |
|---|---|---|
| `config.py` | 105 | **All** thresholds and weights in one place so a reviewer can question each one. Platform profiles (`ROAD_VEHICLE`: 60 m/s, 8 m/s², 90 °/s, 250 m jump; `SMALL_UAV`), `RuleSettings`, `FusionSettings`, `TrustBands`, `IncidentSettings` |
| `geo.py` | 53 | Geodesy helpers: `haversine_m` (distance), `bearing_deg`, `offset`, `angle_diff_deg`, `LocalFrame` (lat/lon to metres) |
| `routes.py` | 200 | `Route` class: a polyline the vehicle should follow, with `distance_to()` and `project()` (arc-length position, direction- and continuity-aware where the road doubles back). Road routes were computed with OSRM on OpenStreetMap data and stored in `data/routes.json`. Each route has one **role**: train, validation or held-out |
| `simulator.py` | 269 | Deterministic synthetic observations (seeded). Normal driving with stops, corners and urban-canyon dips, plus attack overlays: `teleport`, `drift`, `signal`, `stealth_drift`, `osnma_forgery`, `jamming`, `drone_drift`. Every observation carries a ground-truth `attack` label. **Nothing is transmitted** |
| `scenarios.py` | 95 | Catalogue: `training_specs` (normal only), `validation_specs`, `heldout_specs` (the 10 demo scenarios), `FLEET_DEVICES` and `fleet_specs` (the 7-platform live demo) |
| `features.py` | 240 | `FeatureExtractor.update(obs)`: 36 features over a 5-observation rolling window, plus context. `MODEL_FEATURES` is the 19 used by the model |
| `rules.py` | 140 | `evaluate()`: the 15 rules. Returns reasons, rule risk, critical flag. `_severity()` scales 0.5 to 1.0 |
| `model.py` | 183 | `TailModel` and `AnomalyModel`: Isolation Forest plus tail detector, calibration, `risk_from_p`, `explain()`, `save`/`load` |
| `pipeline.py` | 270 | `trust_status`, `fuse()` (noisy-OR), `IncidentTracker`, and `Detector.process(obs)` which turns one observation into one scored frame, then asks the response layer what to hand on |
| `safeguard.py` | 160 | **Response layer.** `Safeguard.update(frame, obs)`: accept / hold / release logic, route-constrained dead reckoning from the odometer, rejoin tolerance, CONTINUE / VERIFY / ISOLATE actions |
| `receiver.py` | 330 | **Real receiver adapter.** NMEA (GGA, RMC, VTG, GSA, GSV) and UBX (NAV-PVT, NAV-CLOCK, NAV-STATUS, NAV-SAT, MON-HW) parsers, `EpochBuilder` folding one second into one observation, serial port or log file input, `--no-model`, `--jsonl` |
| `evaluate.py` | 250 | Train, pick fusion weights on validation routes, score held-out routes, compute precision, recall, F1, false-alarm rate, detection delay; `protection_report()` measures reported vs protected position error against ground truth |
| `export.py` | 95 | Writes everything the dashboard needs to JSON |
| `demo_feed.py` | 59 | Precomputes the 7-platform fleet with the real detector for the cloud demo |
| `stream.py` | 103 | Live runner: one observation per second per device, posts to the ingest endpoint. `--dry-run`, `--speed` |

### The core function: `Detector.process`

```python
f, ctx = self.fx.update(o)                              # 1. features
reasons, rule_risk, critical = evaluate(f, ctx, ...)    # 2. rules
ml = median(self.ml_hist)                               # 3. model risk (3 s trailing median)
hybrid = fuse(rule_risk, ml, st.fusion, critical, floor)  # 4. noisy-OR fusion
trust = 100.0 - hybrid                                  # 5. trust score
frame["resp"] = self.safeguard.update(frame, o)         # 6. response: accept or hold, protected position, action
events = self.incidents.update(frame)                   # 7. open / update / resolve incidents
return frame, events
```

The frame returned has: `trust`, status, rule risk (`rr`), model risk (`mr`), hybrid risk (`hr`), position, OSNMA state, the top 5 reasons (`why`), 16 display features, and `resp` = `{mode, lat, lon, held_s, action, gap_m, source}`.

### The response layer: `Safeguard.update`

```python
acceptable = has_fix and trust >= 50 and not critical
if holding:
    advance the estimate by odometer_speed × dt along the route (or heading)
    if acceptable and clean streak >= 5 and |fix − estimate| <= 60 m + 3 % of distance held:  release
elif acceptable:  accept (remember this fix and its arc-length position on the route)
else:             start a hold from the last accepted fix
action = CONTINUE if acceptable else ISOLATE if (critical or trust < 25) else VERIFY
```

### Tests (`engine/tests/`)

`test_engine.py` (9): simulation is deterministic; attack labels start on time; noisy-OR is stronger than either witness (40 and 40 give 64); missing ML falls back to rules; a critical rule pins the risk floor; a rule is silent just below its threshold; severity scales with the exceedance; OSNMA unknown is never a failure; trust bands map correctly.

`test_safeguard.py` (8): a trusted fix passes through; a spoofed fix is held and the estimate follows the odometer; a hold does not release while the fix is still far away (and does after a long clean streak, reporting the discrepancy); a clean fix that rejoins releases the hold; no fix still gives a position; action bands; route projection picks the right leg where the road doubles back; the route odometer tracks a jammed vehicle within 2 m over a minute.

`test_receiver.py` (6): NMEA sentences parse; two epochs become two observations; a no-fix epoch has no position; UBX frames and the five messages parse (jamming indicator, clock, satellites, PVT); the live detector scores receiver observations; rules-only mode has no model risk.

## Supabase (`supabase/`)

| File | What it does |
|---|---|
| `migrations/..._trustnav_core_schema.sql` | Tables `devices`, `runs`, `frames`, `incidents`, `ingest_tokens`, `presenter_passcodes`, `demo_frames`, `demo_incident_events`, indexes, row-level security (public read only) |
| `migrations/..._demo_feed_functions.sql` | `start_demo_feed`, `stop_demo_feed`, `check_presenter`, `demo_tick` (runs every second via `pg_cron`), `prune_old_frames` (daily) |
| `migrations/..._demo_feed_fetch.sql` | `request_demo_feed` using `pg_net` to fetch the demo data |
| `migrations/..._presenter_rate_limit.sql` | `presenter_failures` table and rate limit on the passcode |
| `migrations/..._cron_log_cleanup.sql` | `trim_cron_logs` every 10 minutes |
| `migrations/..._response_layer.sql` | Adds the `response` column to `frames` and copies it in `demo_tick` |
| `functions/ingest/index.ts` | The only write path: POST only, token check by SHA-256 hash, `start_run` / `frames` / `end_run`, size limits (100 frames per call), input sanitising, upserts that ignore duplicates, `resp` stored as `response` |
| `load_demo_feed.sql` | Loads the precomputed demo into `demo_frames` |

**Security model:** the browser can only read. All writes pass through the ingest function with a secret token that exists only in `engine/.env.local` (never committed; see `.gitignore`).

## Dashboard (`dashboard/`)

Stack: Next.js 15, React 19, TypeScript, MapLibre GL, supabase-js, self-hosted Barlow fonts. No UI framework, hand-written CSS.

### `lib/`

| File | What it does |
|---|---|
| `useFleet.ts` | The data hook. Source is `connecting`, `live` (Supabase realtime) or `loop` (recorded demo). Returns devices, frames, incidents and the clock |
| `types.ts` | Shared types (`Frame`, `Incident`, `ReplayData`) |
| `supabase.ts` | Read-only client using the public key |
| `story.ts` | The narrated story beats and camera moves |
| `i18n-explainer.ts` | The narrated explainer's nine scenes in ten languages, with the UI strings and placeholders |
| `i18n-hero.ts` | The opening screen in ten languages (small, ships in the first load) |
| `useVoice.ts` | `useVoicePref` (voice on/off, remembered) and `useNarrate` (reads a caption aloud when it changes) for the story and presentation captions |
| `speech.ts` | Browser speech synthesis: voice choice per language (natural voices first, Hindi as the fallback for Marathi), speak with a watchdog, stop |
| `plain.ts` | The plain-language layer: `plainVerdict` (one or two sentences per platform from the evidence codes and the response), `plainFleet` (the fleet headline) and `gloss` (engineering terms to everyday wording) |
| `format.ts` | Number, time and status formatting |
| `useTheme.ts`, `useShortcuts.ts`, `useWide.ts` | Dark mode, keyboard shortcuts, responsive layout |

### `components/`

| File | What it does |
|---|---|
| `Console.tsx` | The shell: rail navigation, hash routing, command palette commands, shortcuts, hero and tour |
| `LiveView.tsx` | Live page: fleet list, device detail (with the response line and the operator playbook), fleet KPI strip, alert feed with sparklines, actions and acknowledgements, status strip, toasts, timeline dock, presentation mode |
| `MapView.tsx` | MapLibre map: light/dark styles, 3D buildings, markers with a trust ring and score (hollow when the fix is refused), smooth gliding, fading trails, follow camera, the protected path, shield markers with the size of the refused lie and the dashed link to the reported fix, framing of a whole lie on selection |
| `ReplayView.tsx` | Scenario replay with scrubber, ghost "real position", story mode |
| `SpaceTime.tsx` | Canvas 4D view: ground grid, time axis, trust-coloured ribbons |
| `ResultsView.tsx`, `MethodView.tsx` | Evaluation numbers and method/limitations |
| `Instruments.tsx` | Trust tape, trust chart, gauges, the OSNMA line and the response line (accepted / held / isolated, with what to do) |
| `Report.tsx` | Per-device incident report (print to PDF) |
| `Guide.tsx` | "How to read this screen": legend, panels and the three attacks in plain words (`?`) |
| `Explainer.tsx` | The narrated explainer: scene playback, spotlight on the target panel, caption, language menu, keyboard; drives the live view through `ExplainApi` (fit, select a trusted or a refused platform, open alerts) |
| `CommandPalette.tsx`, `Toasts.tsx`, `Hero.tsx`, `Tour.tsx`, `Icons.tsx` | Search, notifications, opening screen, guided tour, icons |

### Tests (`dashboard/tests/e2e.py`)

98 Playwright checks: every view, interactions, keyboard shortcuts, command palette, report, story mode, space-time, the response layer in the replay panel, map and results, the comparison table, the live KPI strip, trust-ring markers, live shields and lie labels, alert sparklines, actions and acknowledgements, the playbook, presentation mode, phone layout, accessibility (axe), and a JavaScript size budget.

## Deployment

- **GitHub**: this repository (`main`).
- **Vercel**: builds the `dashboard/` folder on every push to `main` and serves https://trustnav.vercel.app.
- **Supabase**: hosts the database, realtime and the ingest function.
- **Secrets**: the ingest token lives only in `engine/.env.local` and in the database as a hash.

## How to run a real receiver (Phase 2)

The adapter is written and tested; only the hardware is missing.

```bash
cd engine
python -m pip install pyserial
python -m trustnav_engine.receiver --port /dev/ttyACM0 --device VAN-REAL --name "Real van" --no-model --dry-run   # first look
set -a; source .env.local; set +a
python -m trustnav_engine.receiver --port /dev/ttyACM0 --device VAN-REAL --name "Real van" --no-model --jsonl drive1.jsonl
```

The dashboard shows it as a real device (run mode `receiver`) next to the simulated ones. `--no-model` is deliberate: the model's "normal" is the simulator's; after a few recorded drives the thresholds and the model are re-calibrated on the real receiver (see `ROADMAP.md`).
