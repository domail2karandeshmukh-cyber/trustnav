# TrustNav: IEEE conference paper

`trustnav.tex` is the project report written as an IEEE conference paper
(two-column IEEEtran format, six pages). `trustnav.pdf` is the compiled copy.

## Build

```bash
cd paper
pdflatex trustnav.tex
pdflatex trustnav.tex      # second pass resolves references and figure numbers
```

`IEEEtran.cls` (the official IEEE class, version 1.8b) is shipped in this folder
so the paper builds on any TeX installation, including Overleaf: upload the whole
`paper/` folder as a project and compile `trustnav.tex` with pdfLaTeX.

## Contents

| File | What it is |
|---|---|
| `trustnav.tex` | the paper (abstract, introduction, related work, system design, implementation, evaluation, discussion, ethics, conclusion, references) |
| `trustnav.pdf` | compiled paper |
| `IEEEtran.cls` | IEEE conference class file |
| `figures/console-photo.jpg` | the deployed console under a forgery attack (Fig. 2) |
| `figures/map-protection.png` | the response layer on the map (Fig. 3) |
| `figures/panel-verdict.png` | the plain-language verdict panel (spare figure) |

Every number in the paper comes from `dashboard/public/data/meta.json`, which the
engine writes when the held-out catalogue is evaluated; the longer technical
documentation is in `docs/`.
