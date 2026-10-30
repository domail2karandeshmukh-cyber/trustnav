# Code guide: every file and what it does

## Folder map

```
trustnav/
├── README.md                      overview, results, how to run
├── docs/                          this documentation
├── engine/                        Python detection engine
│   ├── requirements.txt           numpy, scikit-learn, joblib, pytest
│   ├── models/current/            trained model (model.joblib, model.json) + chosen fusion weights (fusion.json)
│   ├── tests/test_engine.py       9 automated tests
│   └── trustnav_engine/
├── dashboard/                     Next.js web app
│   ├── app/                       page shell, global styles, icon
│   ├── components/                the screens and widgets
│   ├── lib/                       data hook, types, helpers
│   ├── public/data/               recorded data the page can play without a database
│   └── tests/e2e.py               50 end-to-end checks
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
| `routes.py` | 163 | `Route` class: a polyline the vehicle should follow, with distance-to-route. Road routes were computed with OSRM on OpenStreetMap data and stored in `data/routes.json`. Each route has one **role**: train, validation or held-out |
| `simulator.py` | 269 | Deterministic synthetic observations (seeded). Normal driving with stops, corners and urban-canyon dips, plus attack overlays: `teleport`, `drift`, `signal`, `stealth_drift`, `osnma_forgery`, `jamming`, `drone_drift`. Every observation carries a ground-truth `attack` label. **Nothing is transmitted** |
| `scenarios.py` | 95 | Catalogue: `training_specs` (normal only), `validation_specs`, `heldout_specs` (the 10 demo scenarios), `FLEET_DEVICES` and `fleet_specs` (the 7-platform live demo) |
| `features.py` | 240 | `FeatureExtractor.update(obs)`: 36 features over a 5-observation rolling window, plus context. `MODEL_FEATURES` is the 19 used by the model |
| `rules.py` | 140 | `evaluate()`: the 15 rules. Returns reasons, rule risk, critical flag. `_severity()` scales 0.5 to 1.0 |
| `model.py` | 183 | `TailModel` and `AnomalyModel`: Isolation Forest plus tail detector, calibration, `risk_from_p`, `explain()`, `save`/`load` |
| `pipeline.py` | 264 | `trust_status`, `fuse()` (noisy-OR), `IncidentTracker`, and `Detector.process(obs)` which turns one observation into one scored frame |
| `evaluate.py` | 203 | Train, pick fusion weights on validation routes, score held-out routes, compute precision, recall, F1, false-alarm rate, detection delay |
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
events = self.incidents.update(frame)                   # 6. open / update / resolve incidents
return frame, events
```

The frame returned has: `trust`, status, rule risk (`rr`), model risk (`mr`), hybrid risk (`hr`), position, OSNMA state, the top 5 reasons (`why`), and 16 display features.

### Tests (`engine/tests/test_engine.py`)

1. Simulation is deterministic (same seed, same output)
2. Attack labels start on time
3. Noisy-OR is stronger than either witness (40 and 40 give 64)
4. Missing ML falls back to rules
5. A critical rule pins the risk floor
6. A rule is silent just below its threshold
7. Rule severity scales with the exceedance
8. OSNMA unknown is never treated as a failure
9. Trust bands map correctly

## Supabase (`supabase/`)

| File | What it does |
|---|---|
| `migrations/..._trustnav_core_schema.sql` | Tables `devices`, `runs`, `frames`, `incidents`, `ingest_tokens`, `presenter_passcodes`, `demo_frames`, `demo_incident_events`, indexes, row-level security (public read only) |
| `migrations/..._demo_feed_functions.sql` | `start_demo_feed`, `stop_demo_feed`, `check_presenter`, `demo_tick` (runs every second via `pg_cron`), `prune_old_frames` (daily) |
| `migrations/..._demo_feed_fetch.sql` | `request_demo_feed` using `pg_net` to fetch the demo data |
| `migrations/..._presenter_rate_limit.sql` | `presenter_failures` table and rate limit on the passcode |
| `migrations/..._cron_log_cleanup.sql` | `trim_cron_logs` every 10 minutes |
| `functions/ingest/index.ts` | The only write path: POST only, token check by SHA-256 hash, `start_run` / `frames` / `end_run`, size limits (100 frames per call), input sanitising, upserts that ignore duplicates |
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
| `format.ts` | Number, time and status formatting |
| `useTheme.ts`, `useShortcuts.ts`, `useWide.ts` | Dark mode, keyboard shortcuts, responsive layout |

### `components/`

| File | What it does |
|---|---|
| `Console.tsx` | The shell: rail navigation, hash routing, command palette commands, shortcuts, hero and tour |
| `LiveView.tsx` | Live page: fleet list, device detail, alert feed, status strip, toasts, timeline dock |
| `MapView.tsx` | MapLibre map: light/dark styles, 3D buildings, smooth marker gliding, fading trails, follow camera |
| `ReplayView.tsx` | Scenario replay with scrubber, ghost "real position", story mode |
| `SpaceTime.tsx` | Canvas 4D view: ground grid, time axis, trust-coloured ribbons |
| `ResultsView.tsx`, `MethodView.tsx` | Evaluation numbers and method/limitations |
| `Instruments.tsx` | Trust tape, trust chart and gauges |
| `Report.tsx` | Per-device incident report (print to PDF) |
| `CommandPalette.tsx`, `Toasts.tsx`, `Hero.tsx`, `Tour.tsx`, `Icons.tsx` | Search, notifications, opening screen, guided tour, icons |

### Tests (`dashboard/tests/e2e.py`)

50 Playwright checks: every view, interactions, keyboard shortcuts, command palette, report, story mode, space-time, phone layout, accessibility (axe), and a JavaScript size budget.

## Deployment

- **GitHub**: this repository (`main`).
- **Vercel**: builds the `dashboard/` folder on every push to `main` and serves https://trustnav.vercel.app.
- **Supabase**: hosts the database, realtime and the ingest function.
- **Secrets**: the ingest token lives only in `engine/.env.local` and in the database as a hash.

## How to add a real receiver (Phase 2)

1. Read the receiver's output (UBX or NMEA over USB) in a small adapter script.
2. Convert each epoch into the observation dictionary the simulator produces (same keys).
3. Call `Detector.process(obs)` and post the result with `stream.post(...)` using `type: "frames"`.
4. The dashboard shows it as a real device next to the simulated ones. No dashboard change is needed.
