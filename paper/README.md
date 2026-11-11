# TrustNav: IEEE conference paper

The project written up as a six-page IEEE conference paper (two-column
IEEEtran format), in two languages:

| File | Language | Compiled copy |
|---|---|---|
| `trustnav.tex` | English (the reference version) | `trustnav.pdf` |
| `trustnav_fr.tex` | French | `trustnav_fr.pdf` |

Both are exactly six pages and carry the same sections, tables and numbers.
The French version is more condensed, because French runs about 15% longer
than English for the same content: its Table III omits the four count rows,
and a few clauses of the English text are left out.

## Build

```bash
cd paper
pdflatex trustnav.tex && pdflatex trustnav.tex        # English
pdflatex trustnav_fr.tex && pdflatex trustnav_fr.tex  # French (needs babel-french, present on Overleaf)
```

`IEEEtran.cls` (the official IEEE class, version 1.8b) is shipped in this folder
so the paper builds on any TeX installation, including Overleaf: upload the whole
`paper/` folder as a project and compile with pdfLaTeX. Both builds are clean
(no overfull or underfull boxes).

## Figures and numbers

Every plot is a vector PDF drawn from the evaluation data the engine exports
(`dashboard/public/data/replay.json` and `meta.json`), so the figures agree
with the tables by construction. The same script also recomputes every
statistic the text quotes that is not in a table (event-level detection
delays, false-alarm episodes, the threshold sweep, the MOPS-style baseline,
scenario-level bootstrap intervals, calibration per risk band) and writes them
to `figures/analysis.json`:

```bash
python3 paper/figures/make_figures.py
```

| File | What it is |
|---|---|
| `figures/fig_timeline_{en,fr}.pdf` | trust and position error, second by second, for four held-out scenarios (Fig. 2) |
| `figures/fig_sens_{en,fr}.pdf` | alert-line sweep, calibration per risk band, fusion-weight grid (Fig. 3) |
| `figures/console-verdict-wide.png` | the console's verdict panel for the forged-Galileo-data scenario, captured at 2x from the deployed build; no longer placed in the paper (the English text quotes the verdict instead), to make room for the real-attack section; `console-verdict.png` and `console-replay.png` are the single-panel crop and the full screen it was cut from |
| `figures/fig_map_{en,fr}.pdf`, `figures/fig_roc_{en,fr}.pdf` | map view of the response layer, and ROC / precision–recall curves; drawn but not placed in the paper for space (the AUCs are in Table III) |
| `figures/analysis.json` | every quoted statistic, with the inputs it was computed from |
| `figures/attackcheck.json` | the real-attack replay of Section V-F (`python -m trustnav_engine.attackcheck`, run from `engine/`): the VAARA recordings of Jammertest 2024 (a phone captured by a spoofer, a u-blox receiver under real jamming) replayed through the detector with the rules as first published, with the time rule, and with the re-calibrated model; the recordings are downloaded on demand and are not in the repository (a copy of the results is in `dashboard/public/data/`) |
| `figures/realcheck.json` | the real-drive check of Section V-E (`python -m trustnav_engine.realcheck`, run from `engine/`): the public u-blox ZED-F9K drive recording replayed through the detector, the model re-calibrated on it, attacks overlaid; it also carries the drive as a polyline, which the site's Results page draws (a copy is in `dashboard/public/data/`) |
| `figures/make_figures.py` | the script that draws the plots and writes `analysis.json` |

Colours follow the Okabe–Ito palette, so every line stays distinguishable for
colour-blind readers and in greyscale; fonts are embedded (Liberation Serif).

## Checks before submitting

- Spelling: `detex` + a dictionary pass over both files (proper nouns and
  British spellings are expected).
- Numbers: every numeric token in the French file is compared with the English
  one (decimal commas converted), and the English numbers are compared with
  `figures/analysis.json`, `figures/realcheck.json`, `figures/attackcheck.json`
  and `dashboard/public/data/meta.json`.
- References: bibliography entries are in order of first citation (IEEE style)
  and every entry is cited; every URL was opened and the title, date and the
  facts attributed to it were checked against the page.
- Page count: `pdfinfo trustnav.pdf | grep Pages` must say 6, and the log must
  contain no `Overfull` or `Underfull` lines.
