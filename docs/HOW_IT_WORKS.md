# How TrustNav works, step by step

## The big picture

```
 ┌────────────┐  1 Hz   ┌──────────────────────────────┐  HTTPS   ┌─────────────────────┐  realtime  ┌───────────┐
 │ Receiver / │ ──────▶ │ ENGINE (Python)              │ ───────▶ │ Supabase            │ ─────────▶ │ DASHBOARD │
 │ simulator  │         │ features → rules + model →   │  token   │ Edge Function →     │  websocket │ (Next.js, │
 └────────────┘         │ fusion → trust → incidents   │          │ Postgres tables     │            │  MapLibre)│
                        └──────────────────────────────┘          └─────────────────────┘            └───────────┘
```

Three parts, each in its own folder:

| Part | Folder | Job |
|---|---|---|
| Engine | `engine/` | Scores each observation and decides what to alert on |
| Database and API | `supabase/` | Stores results, secures the write path, serves them live |
| Dashboard | `dashboard/` | Shows the fleet, the map, the reasons and the history |

## Step 1: An observation arrives (once per second)

A GNSS receiver reports, every second:

- position (latitude, longitude), speed, heading
- number of satellites tracked
- **C/N0**: signal strength per satellite, in dB-Hz
- **PDOP**: how well the satellites are spread across the sky (geometry)
- pseudorange residuals: how well the measurements agree with the computed position
- receiver clock bias and drift
- a jamming indicator (0 to 255)
- **Galileo OSNMA status**: verified, failed or lost
- optional inertial speed (from an IMU)

These come from three sources, all producing the same observation dictionary:

- the **simulator** (`simulator.py`): repeatable synthetic observations with or without attacks; every number in the results comes from it;
- a **real receiver** on a serial port or a log (`receiver.py`): NMEA and u-blox UBX messages folded into one observation per second;
- a **phone** (`phone.py` with the `/phone` page of the console): the phone's own fixes, position, speed, heading and accuracy, sent to the cloud once a second and pulled by the engine on a laptop. A phone gives no per-satellite C/N0, clock or OSNMA, so those inputs stay missing and the physics and route rules carry the score; the phone's real speed stands in for the odometer. The phone page can overlay a teleport, a slow drift or jamming on the real stream, in software only, so detection and the response layer can be shown on real data.

## Step 2: Turn the observation into features (`features.py`)

One raw reading is hard to judge on its own. A position of 47.46, -0.55 says nothing. What matters is **how it compares with the last few seconds and with the expected route**.

`FeatureExtractor.update()` keeps a rolling window of the previous 5 observations and computes **36 features**, for example:

| Feature | Meaning | Why it matters |
|---|---|---|
| `distance_m` | How far the fix moved since last second | A spoofer can make this huge |
| `derived_speed_mps` vs `reported_speed_mps` | Speed worked out from positions vs speed the receiver claims | Spoofed positions break this relationship |
| `acceleration_mps2`, `heading_rate_dps` | How violently it speeds up or turns | Vehicles have physical limits |
| `route_deviation_m` | Distance from the assigned route | Catches slow drift |
| `cn0_mean_dbhz`, `cn0_std_dbhz` | Signal strength and how uniform it is | A spoofer's signals are too strong and too uniform; jamming makes them collapse |
| `satellite_count_delta` | Sudden change in satellites tracked | Jamming or spoofing onset |
| `pdop`, `pseudorange_residual_m` | Geometry and measurement consistency | Degrade under attack |
| `clock_bias_delta_ns`, `clock_drift_delta_nsps` | Receiver clock behaviour | A spoofer disturbs the clock |
| `sensor_speed_mismatch_mps` | GNSS speed vs inertial speed | Two independent sources disagreeing |
| `osnma_failed`, `osnma_lost` | Galileo signature status | Cryptographic evidence |
| `missing_*` flags | A value is absent | Lets the system tell "missing" from "zero" |

The extractor works one observation at a time, so it runs live exactly as it does on recorded data.

## Step 3a: Rules (`rules.py`, thresholds in `config.py`)

Fifteen deterministic checks. Each one compares a feature with a named threshold:

`R_POSITION_JUMP`, `R_IMPOSSIBLE_SPEED`, `R_ACCELERATION_SPIKE`, `R_HEADING_DISCONTINUITY`, `R_ROUTE_DEVIATION`, `R_SATELLITE_SHIFT`, `R_CN0_SHIFT`, `R_DOP_DEGRADATION`, `R_PSEUDORANGE_RESIDUAL`, `R_CLOCK_ANOMALY`, `R_SENSOR_GNSS_MISMATCH`, `R_JAMMING_INDICATOR`, `R_OSNMA_FAILED`, `R_OSNMA_LOST`, `R_FIX_LOST`.

- Each rule has a **weight** and a **severity**. Severity is 0.5 at the threshold and rises to 1.0 at three times the threshold, so a small exceedance counts less than a huge one.
- The rules' contributions are combined with a **noisy-OR**: independent evidence reinforces itself (`risk = 1 − ∏(1 − contribution)`).
- A **critical** rule (a jump over 4× the limit, or an OSNMA failure) sets a **floor of 70** on the risk, so a clear forgery can never be averaged away.
- Thresholds sit where something becomes *physically impossible*, not where an attack becomes likely. That keeps false alarms low, at the cost of missing slow attacks. The model layer covers those.

Output: a list of reasons, each with the measured value and threshold, plus a rule risk from 0 to 100.

## Step 3b: The machine-learning model (`model.py`)

Two detectors, trained **only on normal driving** (it never sees an attack, so it cannot just memorise attack shapes):

1. **Isolation Forest** (scikit-learn, 300 trees). Finds unusual *combinations* of inputs.
2. **Tail detector**. Finds a *single* extreme input, such as a position 90 m off the road while all signals look clean. It can say exactly which input was improbable.

Both scores are turned into a probability on a separate calibration set of normal runs, then combined (`p = min(2·min(p_forest, p_tail), 1)`) and converted to a risk: `risk = 100 · min(1, −log10(p) / 4)`. So **risk 50 means "about a 1-in-100 event during normal driving"**, which keeps the alarm line meaningful.

The model uses 19 of the 36 features (one per independent physical quantity). A trailing **median over 3 seconds** suppresses isolated spikes but lets sustained anomalies through.

When risk is 25 or more, the model **explains itself**: "Most unusual: route deviation 47.24 (normal 0.02 to 4.3)". That is the line you see in the dashboard.

## Step 4: Fusion into a trust score (`pipeline.py → fuse`)

```
risk  = 1 − (1 − rule_weight·rule_risk) · (1 − ml_weight·ml_risk)       # noisy-OR
trust = 100 − risk
```

with `rule_weight = 0.6` and `ml_weight = 0.8`, chosen on **validation routes** (not the test routes).

Why not just average? Averaging a confident ML alarm (90) with a quiet rule score (20) gives 55, weaker than the ML evidence alone. Noisy-OR treats the two as independent witnesses: either can raise the alarm, and both together are stronger.

Worked example from the screenshot: rules 70, model 100 →
`1 − (1 − 0.6·0.70)(1 − 0.8·1.00) = 1 − 0.58·0.20 = 0.884` → risk **88** → trust **12**.

Trust bands:

| Trust | Status |
|---|---|
| 75 to 100 | Trusted |
| 50 to 74 | Degraded |
| 25 to 49 | Suspicious |
| 0 to 24 | Untrusted |

## Step 5: Incidents (`pipeline.py → IncidentTracker`)

An alert on a single second would flicker. So:

- An incident **opens** after trust stays below 50 for **3 consecutive seconds**.
- It **closes** after **5 clean seconds**.
- Severity comes from the lowest trust reached: below 35 is High, below 20 is Critical.
- The title leads with the strongest critical evidence, for example "Galileo authentication failed: 40 observations".

## Step 5b: The response layer (`safeguard.py`)

Detection alone leaves the operator looking at a lie, so the score drives a response, the way an intrusion *prevention* system acts on what an intrusion *detection* system finds:

| Trust | Mode | What downstream software receives | Action for the operator |
|---|---|---|---|
| 50 or more, no critical rule | **accept** | the GNSS fix, unchanged | CONTINUE |
| below 50, or no fix | **hold** | an estimate: the last trusted fix advanced by the **odometer speed along the planned route** (a spoofer cannot touch the odometer); without a route, along the last trusted heading | VERIFY (confirm by other means before acting) |
| below 25, or a critical rule (OSNMA failed, 4× jump) | **hold** | the same estimate | ISOLATE (do not act on this device; a drone holds or returns on inertial navigation, a driver is contacted) |

A hold ends only after **five clean seconds and a fix that rejoins the estimate** (within 60 m plus 3 % of the distance travelled while held), so a spoofer cannot end the hold by looking clean while still far away. After 60 clean seconds it releases with a tolerance ten times looser and reports the discrepancy, because an odometer estimate drifts too; a fix that is still kilometres away stays refused (found on a real recording: without this bound, a teleported fix that kept moving consistently was taken back after a minute).

Where the route doubles back on itself (the same street in both directions), `Route.project()` uses the direction of travel and continuity to pick the right leg, otherwise the estimate would advance the wrong way.

Measured on the held-out attacks (`protection` in `meta.json`): worst error on an ordinary screen 8,003 m, worst error of what the response layer handed on 29 m; jamming blank screen 100 s without, 0 s with; holds outside attacks 26 s in total over the whole catalogue.

## Step 6: Send to the cloud (`stream.py` → `supabase/functions/ingest`)

`stream.py` runs the detector in real time (or faster with `--speed`) and posts the results every second to the **ingest Edge Function**:

1. `start_run` registers the devices and opens a run.
2. `frames` sends the scored frames and incident events (up to 100 per call).
3. `end_run` closes the run.

The function is the only write path. It checks an `x-trustnav-token` header against a **SHA-256 hash** stored in the database, so the real token is never stored, and it limits sizes and sanitises every field.

### A real receiver instead of the simulator (`receiver.py`)

`python -m trustnav_engine.receiver --port /dev/ttyACM0` reads a GNSS receiver over USB (NMEA sentences GGA, RMC, VTG, GSA, GSV, and u-blox UBX messages NAV-PVT, NAV-CLOCK, NAV-STATUS, NAV-SAT, MON-HW), folds each second into the same observation dictionary the simulator produces, runs the same `Detector`, and posts to the same ingest endpoint. Inputs the receiver does not provide (OSNMA, inertial speed) stay `None` and the engine's `missing_*` flags take over. `--file` replays a saved log, `--jsonl` records everything for later calibration, and `--no-model` runs rules only until the model has been re-calibrated on that receiver's own normal drives. The receiver only listens; nothing is transmitted.

## Step 7: Storage and security (`supabase/migrations`)

Tables: `devices`, `runs`, `frames` (one row per scored second, including the `response` JSON), `incidents`, `ingest_tokens`, `presenter_passcodes`, plus `demo_frames` and `demo_incident_events` for the built-in demo.

- **Row-level security**: everyone can *read* devices, runs, frames and incidents. Nobody can write except through the ingest function (service role).
- **Demo feed**: a `pg_cron` job (`demo_tick`) replays a precomputed fleet once per second, so the live demo works with no laptop attached. Starting and stopping it needs a **presenter passcode** (bcrypt-hashed, rate-limited after failed attempts).
- Old frames are pruned daily, and cron logs are trimmed every 10 minutes.

## Step 8: The dashboard (`dashboard/`)

`useFleet.ts` is the data hook. If a run is `running` it subscribes to **Supabase realtime**; otherwise it loops a **recorded demo** (`public/data/demo_fleet.json`) so the page is never empty.

| View | What it shows |
|---|---|
| **Live** | 3D map of the fleet, trust per vehicle, alert feed, device detail with reasons and the response (accepted / held / isolated), timeline dock, report export |
| **Replay** | Ten recorded scenarios with a scrubber, the real path, the protected path the response layer handed on, and a narrated story mode |
| **Results** | The evaluation numbers, per-scenario outcomes, and what the response layer prevented |
| **Method** | How it works and its limitations |
| **Space-time** | A 4D view: ground is the map, height is time, each track is a ribbon coloured by trust |

The map is **MapLibre GL** with **OpenStreetMap** data (CARTO styles) and 3D buildings. Nothing about a position is hidden from the user: the *Why* panel lists every reason the engine produced.

## Step 9: Evaluation (`evaluate.py`)

To avoid fooling ourselves, routes are split by role and never reused:

| Split | Used for |
|---|---|
| **train** | Fit the Isolation Forest (normal driving only) |
| **validation** | Choose fusion weights |
| **held-out** | Every reported number |

The simulator is deterministic (seeded), so every result can be reproduced exactly.

## Run it yourself

```bash
cd engine && python -m pip install -r requirements.txt
python -m pytest -q                       # 32 tests
python -m trustnav_engine.evaluate        # train + held-out metrics
python -m trustnav_engine.stream --dry-run --speed 10
python -m trustnav_engine.receiver --file drive.nmea --speed 0 --dry-run   # a saved receiver log

cd ../dashboard && npm install && npm run dev
```
