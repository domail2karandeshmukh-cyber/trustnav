# TrustNav

**Live trust monitoring for GNSS positions.** TrustNav tells a vehicle or drone fleet operator, once per second, whether each position can be trusted, and explains why when it cannot. It detects spoofing and jamming with three layers of evidence: physical rules, unsupervised anomaly models, and Galileo OSNMA authentication.

> Research prototype, MSc Cybersecurity & Data Science, ESAIP Angers.
> All attacks are simulated in software. No radio signal is transmitted, jammed or spoofed.

## What it does

```
Receiver observation (1 Hz)          position, speed, satellites, C/N0, PDOP, residuals,
        │                            clock, jamming indicator, Galileo OSNMA status, IMU speed
        ▼
Features (35)                        compared with the last 5 epochs and the assigned route
        │
   ┌────┴─────┐
   ▼          ▼
Rules (15)   Model                   Isolation Forest + per-feature tail detector,
   │          │                      trained on normal data only
   └────┬─────┘
        ▼
Noisy-OR fusion → trust 0–100 + evidence → incidents → live dashboard
```

## Results (held-out routes, synthetic data)

| | Rules only | Model only | **Hybrid** |
|---|---|---|---|
| Precision | 100% | 97.9% | **99.3%** |
| Recall | 27.9% | 90.1% | **96.1%** |
| F1 | 0.437 | 0.939 | **0.977** |
| False alarm rate | 0% | 1.33% | **0.44%** |

Ten held-out scenarios: two normal drives, teleport spoof, gradual drift, signal anomaly, stealth drift (OSNMA still verified), OSNMA forgery, jamming with recovery, and two drone survey missions. The stealth drift is caught about 40 s after it starts, at roughly 12 m off the road; the fixed 150 m rule alone would take about 3.5 minutes.

These numbers are an upper bound: one simulator produces every split. See *Limitations* in the dashboard's Method tab.

## Repository layout

| Path | What |
|---|---|
| `engine/` | Python detection engine: simulator, features, rules, model, fusion, incidents, evaluation, live streamer |
| `dashboard/` | Next.js control room: live fleet, replay, incidents, evaluation, method |
| `supabase/` | Database schema, row-level security, demo feed, ingest Edge Function |

## Run the engine

```bash
cd engine
python -m pip install -r requirements.txt
python -m pytest -q                      # 9 tests
python -m trustnav_engine.evaluate       # train, choose fusion weights, print held-out metrics
python -m trustnav_engine.export         # write out/*.json for the dashboard
python -m trustnav_engine.stream --dry-run --speed 10   # live engine without sending
```

To stream live to the dashboard, put the ingest URL and token in `engine/.env.local` (never committed) and run:

```bash
set -a; source .env.local; set +a
python -m trustnav_engine.stream
```

## Run the dashboard

```bash
cd dashboard
npm install
npm run dev
```

**Space-time view** (toggle at the top of the map, in Live and Replay): the ground is the map in metres and height is time, so each platform's track rises as a ribbon coloured by trust. A spoof tears the ribbon away from the real path; drift is a lean; jamming is a gap. Drag to rotate, wheel to zoom. Pure canvas, no tiles.

Opening screen offers a narrated 60-second story of an attack (also `#replay?scenario=teleport_spoof&story=1`, or "Watch the attack" in the search). The map is tilted with 3D buildings; `T` opens the fleet timeline dock.

Keyboard: `1`–`4` switch pages, `⌘K` / `Ctrl K` opens the search, `J`/`K` step through platforms, `Esc` goes back, `F` follows the selected platform, `R` opens its incident report, `D` toggles dark mode, `Space` and the arrow keys drive the replay.

End-to-end checks (every view, interactions, shortcuts, dark mode, phone layout, axe accessibility scan, JS budget):

```bash
npm run build && npx next start -p 3100 &
python3 tests/e2e.py http://localhost:3100
```

The dashboard reads public, synthetic data only. Writes go through the ingest function (token, stored as a SHA-256 hash) or the presenter controls (passcode, stored as a bcrypt hash, rate-limited).

## Data sources

- Road geometry: OpenStreetMap contributors, routed with OSRM.
- Basemap: CARTO Dark Matter (OpenStreetMap data).
- Galileo OSNMA operational since 24 July 2025 (EUSPA).

## Roadmap

1. Real receiver: u-blox ZED-F9P with OSNMA firmware, Raspberry Pi, walk and tram tests in Angers.
2. Drone: PX4 simulator, then a real airframe.
3. Real attack data: Jammertest (Andøya, Norway) recordings.
