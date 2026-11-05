# TrustNav: IEEE conference paper

The project report written as a six-page IEEE conference paper (two-column
IEEEtran format), in two languages:

| File | Language | Compiled copy |
|---|---|---|
| `trustnav.tex` | English (the reference version) | `trustnav.pdf` |
| `trustnav_fr.tex` | French | `trustnav_fr.pdf` |

Both are 6 pages. The French version carries the same text, tables and
numbers; it omits one figure (the map view) to stay within six pages.

## Build

```bash
cd paper
pdflatex trustnav.tex && pdflatex trustnav.tex        # English
pdflatex trustnav_fr.tex && pdflatex trustnav_fr.tex  # French (needs babel-french)
```

`IEEEtran.cls` (the official IEEE class, version 1.8b) is shipped in this folder
so the paper builds on any TeX installation, including Overleaf: upload the whole
`paper/` folder as a project and compile `trustnav.tex` with pdfLaTeX.

## Figures

Every plot is a vector PDF drawn from the evaluation data the engine exports
(`dashboard/public/data/replay.json`), so the figures agree with the tables by
construction. Regenerate them with:

```bash
python3 paper/figures/make_figures.py
```

| File | What it is |
|---|---|
| `figures/fig_timeline_{en,fr}.pdf` | trust and position error, second by second, for four held-out scenarios (Fig. 3) |
| `figures/fig_map_{en,fr}.pdf` | the response layer seen from above for the forgery and drone scenarios (Fig. 4, English version) |
| `figures/fig_roc_{en,fr}.pdf` | ROC and precision–recall curves of the three detectors (not placed in the paper for space; the AUCs are in Table II) |
| `figures/console-replay.png` | the console replaying the forgery scenario, captured at 2x from the deployed build (Fig. 2) |
| `figures/make_figures.py` | the script that draws the plots |

Every number in the paper comes from `dashboard/public/data/meta.json`; the
longer technical documentation is in `docs/`.
