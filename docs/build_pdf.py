"""Build docs/TrustNav_Technical_Documentation.pdf from the markdown docs.

    cd docs && python3 build_pdf.py

Needs: python-markdown, playwright (with Chromium). The PDF is also the
document attached to the tutor e-mails, so keep it readable by someone who
has never seen the project.
"""

import json
import re
from datetime import date
from pathlib import Path

import markdown

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FONTS = ROOT / "dashboard" / "node_modules" / "@fontsource" / "barlow" / "files"
META = json.loads((ROOT / "dashboard" / "public" / "data" / "meta.json").read_text())
REAL = json.loads((ROOT / "dashboard" / "public" / "data" / "realcheck.json").read_text())
ATTACK = json.loads((ROOT / "dashboard" / "public" / "data" / "attackcheck.json").read_text())

SECTIONS = [  # (number, title, source markdown, anchor)
    ("1", "Summary", "SUMMARY.md"),
    ("2", "Objectives: what TrustNav does in real life", "OBJECTIVES.md"),
    ("3", "How it works, step by step", "HOW_IT_WORKS.md"),
    ("4", "The console, in plain words", None),
    ("5", "Code guide: every file and what it does", "CODE_GUIDE.md"),
    ("6", "Results", None),
    ("7", "How TrustNav differs from what exists today", "COMPARISON.md"),
    ("8", "Roadmap: prevention and improvements", "ROADMAP.md"),
    ("9", "Safety, legal and ethics", "ETHICS.md"),
    ("10", "Team and contributions", "TEAM.md"),
    ("A", "Appendix: running the project", None),
]
BRIEF = [  # the four-page version for a reader in a hurry
    ("1", "Summary", "SUMMARY.md"),
    ("2", "The console, in plain words", None),
    ("3", "Results", None),
    ("4", "What comes next", None),
    ("5", "Team and contributions", "TEAM.md"),
]
LINK_NAMES = {"SUMMARY.md": "section 1", "OBJECTIVES.md": "section 2", "HOW_IT_WORKS.md": "section 3",
              "CODE_GUIDE.md": "section 5", "COMPARISON.md": "section 7", "ROADMAP.md": "section 8", "ETHICS.md": "section 9", "TEAM.md": "section 10"}


def md(text: str) -> str:
    # links to sibling docs become section references; the rest renders as usual
    text = re.sub(r"\[([^\]]+)\]\((?:docs/)?([A-Z_]+\.md)\)", lambda m: f"{m.group(1)} ({LINK_NAMES.get(m.group(2), m.group(2))})", text)
    text = re.sub(r"`([A-Z_]+\.md)`", lambda m: f"{m.group(1)} ({LINK_NAMES.get(m.group(1), '')})".replace(" ()", ""), text)
    return markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])


# Sections that the standalone markdown files need but the single document already has elsewhere.
TRIM = {
    "OBJECTIVES.md": [("## Measured results (held-out routes, synthetic data)", "## Measured results\n\nPrecision 99.3 %, recall 96.1 %, false alarm rate 0.44 %, 7 of 7 attack types caught; the response layer cuts the worst operator-visible error from 8.0 km to 29 m. The full tables, scenario by scenario, and the replays on real recordings are in section 6.\n"),
                      ("## Next steps (Phase 2)", "## Next steps\n\nA real receiver and antenna, calibration on real normal drives, raw radio recordings of attacks through a software receiver, a second antenna, real OSNMA: the plan with effort and priorities is in section 8.\n")],
    "HOW_IT_WORKS.md": [("## Run it yourself", "")],
}


def body_without_title(path: Path) -> str:
    lines = path.read_text().splitlines()
    if lines and lines[0].startswith("# "):
        lines = lines[1:]
    text = "\n".join(lines)
    for heading, replacement in TRIM.get(path.name, []):
        if heading not in text:
            continue
        head, rest = text.split(heading, 1)
        # cut to the next heading of the same level, or the end
        m = re.search(r"\n## ", rest)
        text = head + replacement + (rest[m.start():] if m else "")
    return text


def console_section(brief: bool = False) -> str:
    figures = """
<figure class="wide"><img src="images/console-photo.jpg" alt="The live console on the deployed site"><figcaption>Figure 1. The deployed console (trustnav.vercel.app) photographed on 29 October 2026: Delivery van 04 under a Galileo forgery attack, untrusted for 4 minutes, with the forged track in pink over the real streets of Angers.</figcaption></figure>
<div class="figgrid">
<figure><img src="images/panel-verdict.png" alt="Vehicle panel with the plain-words verdict"><figcaption>Figure 2. A vehicle's file: the score, the verdict in plain words, the last five minutes, and the evidence.</figcaption></figure>
<div class="figcol">
<figure><img src="images/map-protection.png" alt="Map with refused fixes and shields"><figcaption>Figure 3. The response layer on the map: hollow refused fixes, teal shields where the vehicles really are, and the dashed lies ("8.0 km refused"). The basemap is simplified in this test render.</figcaption></figure>
<figure><img src="images/kpi-strip.png" alt="Fleet KPI strip"><figcaption>Figure 4. Fleet at a glance.</figcaption></figure>
</div>
</div>
""" if brief else """
<figure class="wide"><img src="images/console-photo.jpg" alt="The live console on the deployed site"><figcaption>Figure 1. The deployed console (trustnav.vercel.app) photographed on 29 October 2026: Delivery van 04 under a Galileo forgery attack, untrusted for 4 minutes, with the forged track in pink over the real streets of Angers. Later versions add the trust rings, shields and plain-words verdicts shown below.</figcaption></figure>
<div class="figgrid">
<figure><img src="images/panel-verdict.png" alt="Vehicle panel with the plain-words verdict"><figcaption>Figure 2. A vehicle's file: the score, the verdict in plain words, the last five minutes, and the evidence.</figcaption></figure>
<div class="figcol">
<figure><img src="images/map-protection.png" alt="Map with refused fixes and shields"><figcaption>Figure 3. The response layer on the map: hollow refused fixes, teal shields where the vehicles really are, and the dashed lies ("8.0 km refused"). The basemap is simplified in this test render.</figcaption></figure>
<figure><img src="images/kpi-strip.png" alt="Fleet KPI strip"><figcaption>Figure 4. Fleet at a glance.</figcaption></figure>
<figure class="half"><img src="images/alerts.png" alt="Alert cards"><figcaption>Figure 5. Alert cards with sparklines, the action taken and acknowledgement.</figcaption></figure>
</div>
</div>
<figure class="wide"><img src="images/guide.png" alt="How to read this screen"><figcaption>Figure 6. "How to read this screen", one keypress away inside the console.</figcaption></figure>
"""
    return md("""
The live console is the part a jury member sees first, so this section says what each element means in everyday words. The same text is available inside the console by pressing `?`.

**What it shows.** Every second, for each van and drone, TrustNav checks whether its satellite position can be believed and gives it a score from 0 (certainly false) to 100 (certainly true). Below 50 it refuses the position and tracks the vehicle by its odometer instead, so nothing downstream acts on a lie.

**The map.** A ring around each vehicle is its trust score drawn as a gauge: green is trusted, amber has minor doubts, orange is suspicious, pink is untrusted. A hollow marker labelled "refused" is the position the receiver claims and TrustNav is not passing on. A teal shield is where TrustNav believes the vehicle really is, worked out from its odometer along its route. The dashed line between them is the lie, with its length; in the teleport attack it is 8 km. The coloured trail is the last 90 seconds of reported positions.

**The panels.** The strip at the top left shows the fleet's average trust, how many vehicles are in each band, the open incidents, and how many positions are being refused with the size of the worst lie. The alerts panel at the top right has one card per incident with the last minute of trust, the action taken (verify or isolate) and a tick to acknowledge it. Clicking any vehicle opens its file: first a verdict in plain words, then the evidence (each line names what was measured and the limit it crossed), then what to do.

**The three things that go wrong.** *Jamming*: a noise transmitter drowns the satellites and the receiver loses its position; TrustNav keeps an estimate from the odometer, so the screen never goes blank. *Spoofing*: a transmitter imitates the satellites and feeds a false position, either a jump or a slow drift; TrustNav notices the impossible motion, the too-perfect signal or the drift off the road, and refuses the position. *Forgery*: fake Galileo navigation data; Galileo signs its messages (OSNMA), so the signature fails and the forgery is caught within seconds.

**Presentation mode** (key `P`) makes the camera visit every platform, incidents first, with a caption, for a jury room or a wall screen. **Replay** plays ten recorded attacks with a narrated story. **Results** has the numbers. **Method** explains how it decides and how it differs from existing products.
""") + figures


def _span(seconds: int) -> str:
    m, s_ = divmod(int(seconds), 60)
    return f"{m} min {s_} s" if m and s_ else f"{m} min" if m else f"{s_} s"


def real_section(brief: bool = False) -> str:
    """The two replays on real recordings, written from the result files the engine exports."""
    ph = ATTACK["phone"]; cap = ph["capture"]
    cfg = {c["key"]: c for c in ph["configurations"]}
    jam = ATTACK["ublox_jamming"]; spo = ATTACK["ublox_spoofing"]
    det = lambda u, k: next(d for d in u["detectors"] if d["key"] == k)
    jh, jr, sh = det(jam, "hybrid"), det(jam, "rules"), det(spo, "hybrid")
    first = lambda c: "same second" if c["first_alert_delay_s"] == 0 else "never" if c["first_alert_delay_s"] is None else f"after {_span(c['first_alert_delay_s'])}"
    labels = [("published", "The 15 rules as first published"), ("odometer", "The same, with the car's speed as odometer"),
              ("hybrid_v21", "The same, with the model re-calibrated on this phone"), ("time", "**16 rules: receiver time checked against the phone's own clock**")]
    rows = "\n".join(f"| {label} | {first(cfg[k])} | {cfg[k]['captured_refused']} of {cap['fixes']} |" for k, label in labels)
    minutes = lambda s_: round(s_ / 60)
    tenths = lambda s_: int(s_ / 6) / 10          # 1 593 s reads 26.5 min and 513 s reads 8.5, as in the paper
    rc = REAL["recalibrated"]
    sim_share = round(100 * REAL["whole_drive_simulator_model"]["alert_seconds"] / REAL["epochs"])
    false_share = 100 * jh["outside_normal_signal"]["alert_seconds"] / max(1, jh["outside_normal_signal"]["seconds"])
    capture = (f"A phone in a car was captured by a real spoofer for {tenths(cap['duration_s'])} minutes: its clock was set back "
               f"{minutes(abs(cap['time_offset_median_s']))} minutes and its position {cap['offset_while_parked_m']:.0f} m aside, and when the car drove off "
               f"the phone stayed where the spoofer had put it, ending {cap['reported_max_error_m'] / 1000:.1f} km from the truth.")
    if brief:
        return f"""
**On recordings of real attacks** (Jammertest 2024, Norway; VAARA dataset, University of Vaasa). {capture} The version first published alerted {first(cfg['published'])} and refused {cfg['published']['captured_refused']} of {cap['fixes']} captured fixes. With a sixteenth rule, receiver time checked against the phone's own clock, the alert comes in the {first(cfg['time'])} and **{cfg['time']['captured_refused']} of {cap['fixes']}** are refused, with no false alert in the clean periods. Real jamming of a u-blox receiver: **{jh['exposures_alerted']} of {jam['exposures']}** exposures alerted. On a clean real drive of {REAL['duration_min']} minutes the rules raise no false alarm.
"""
    return f"""
### On recordings of real attacks

The tables above come from a simulator. What follows does not. At Jammertest 2024 on Andøya, Norway, the authorities let jammers and spoofers transmit, and the University of Vaasa recorded a u-blox receiver and a phone in a car through it (the VAARA dataset). The recordings were replayed unchanged through the same adapter and detector (`python -m trustnav_engine.attackcheck`).

**Real spoofing.** {capture} The u-blox beside it was not captured and serves as the reference.

| Detector | First alert | Captured fixes refused |
|---|---|---|
{rows}

The first version missed this attack: nothing in the spoofed stream was physically impossible. What the spoofer could not hide was time. With the sixteenth rule there is no alert in the {minutes(ph['clean_seconds'])} clean minutes before the capture nor in the {minutes(ph['no_test_seconds'])} minutes declared free of tests, and with the car's speed as odometer and its track as route the position handed on stays within {cfg['full']['handed_on_max_error_m']:.0f} m (median {cfg['full']['handed_on_median_error_m']} m; a best case).

**Real jamming.** The u-blox drove past parked jammers and started inside a jammed area: {jam['exposures']} exposures. The rules alone alerted on {jr['exposures_alerted']}, because its NMEA stream carries no jamming indicator; the hybrid, its model re-calibrated on the {minutes(ATTACK['ublox_calibration']['seconds'])} minutes recorded before the first test, alerted on {jh['exposures_alerted']}, about {jh['alert_delay_median_s']} s in, and marked all {jh['exposures_below_trusted']} as degraded, with {false_share:.1f} % false alerts on clean-signal seconds. Beside the spoofer the same u-blox was not captured: it was shown as degraded for {100 * sh['tests_collapsed']['below_trusted_seconds'] // sh['tests_collapsed']['seconds']} % of {minutes(sh['tests_collapsed']['seconds'])} minutes, and its position was kept.

Limits: two days of one campaign on two devices; the time rule needs a host clock, or a spoofer that moves time backwards. The recordings also exposed four defects in the adapter and the response layer, all fixed and tested.

### On a real drive with no attack

A public {REAL['duration_min']}-minute recording of a u-blox ZED-F9K driving a loop in Mountain View, with a survey-grade reference track (`python -m trustnav_engine.realcheck`). The rules alone raised **{REAL['whole_drive_rules_only']['alert_seconds']}** false alarms in the whole drive (lowest trust {REAL['whole_drive_rules_only']['min_trust']:.0f}); the usual signal-strength check raised {REAL['whole_drive_cn0_sats_baseline']['alert_seconds']} s. The model trained on the simulator alerted on {sim_share} % of the seconds, so it must be re-calibrated on the receiver in use: re-calibrated on the first {(rc['fit_seconds'] + rc['calibration_seconds']) // 60} minutes it raised {rc['test_no_attack']['alert_seconds']} alerts in the remaining {tenths(rc['test_seconds'])} minutes, and software attacks overlaid on that segment were caught after {', '.join(str(r['hybrid']['first_alert_delay_s']) for r in REAL['overlays']['runs'][:-1])} and {REAL['overlays']['runs'][-1]['hybrid']['first_alert_delay_s']} s (teleport, drift, jamming).
"""


def results_section() -> str:
    ex = META["experiments"]
    prot = META["protection"]
    names = {s["slug"]: s["name"] for s in META["scenarios"]}
    rows = []
    for p in ex["hybrid"]["per_scenario"]:
        r = next(x for x in ex["rules"]["per_scenario"] if x["scenario"] == p["scenario"])
        m = next(x for x in ex["ml"]["per_scenario"] if x["scenario"] == p["scenario"])
        lat = lambda v: ("normal run" if p["attack_observations"] == 0 else "missed" if v is None else f"{v} s")
        rows.append(f"| {names[p['scenario']]} | {lat(r['detection_latency_obs'])} | {lat(m['detection_latency_obs'])} | {lat(p['detection_latency_obs'])} | {p['false_alerts']} |")
    prow = []
    for p in prot["per_scenario"]:
        if p["attack_observations"] == 0:
            prow.append(f"| {names[p['scenario']]} | normal run | – | – | {p['held_s']} s | {p['false_hold_s']} s |")
            continue
        seen = f"blank {p['reported_blank_s']} s" if p["reported_blank_s"] else f"{p['reported_max_error_m']:,.0f} m"
        hold = "same second" if p["hold_after_s"] == 0 else f"{p['hold_after_s']} s"
        prow.append(f"| {names[p['scenario']]} | {seen} | {p['protected_max_error_m']:,.0f} m | {hold} | {p['held_s']} s | {p['false_hold_s']} s |")
    h = ex["hybrid"]
    text = f"""
All numbers come from the ten held-out scenarios ({h['support_positive'] + h['support_negative']:,} one-second observations) on routes the model never saw in training. The data is synthetic (one simulator produces every split), so these are an upper bound on real-world performance; the replays on real recordings are at the end of this section.

### Detection

| | Rules only | Model only | **Combined (TrustNav)** |
|---|---|---|---|
| Precision | {ex['rules']['precision']*100:.1f} % | {ex['ml']['precision']*100:.1f} % | **{h['precision']*100:.1f} %** |
| Recall | {ex['rules']['recall']*100:.1f} % | {ex['ml']['recall']*100:.1f} % | **{h['recall']*100:.1f} %** |
| F1 | {ex['rules']['f1']:.3f} | {ex['ml']['f1']:.3f} | **{h['f1']:.3f}** |
| False alarm rate | {ex['rules']['false_positive_rate']*100:.2f} % | {ex['ml']['false_positive_rate']*100:.2f} % | **{h['false_positive_rate']*100:.2f} %** |
| Mean time to detect | {ex['rules']['mean_detection_latency_obs']} s | {ex['ml']['mean_detection_latency_obs']} s | **{h['mean_detection_latency_obs']} s** |

Rules never cry wolf but miss slow attacks; the model catches subtle changes but is noisier; combined, each covers the other's blind spot. The fusion weights (rules {META['fusion_search']['chosen']['rule_weight']}, model {META['fusion_search']['chosen']['ml_weight']}) were chosen on separate validation routes, never on the results above.

### Scenario by scenario (time from attack start to the first alert)

| Scenario | Rules | Model | **Combined** | False alerts |
|---|---|---|---|---|
{chr(10).join(rows)}

### What the response layer prevents

Measured against simulator ground truth during each attack: the worst position an ordinary fleet screen would have shown, against the worst position the response layer handed downstream.

| Scenario | Ordinary screen, worst error | **With response layer, worst error** | Hold began after | Held | Holds outside the attack |
|---|---|---|---|---|---|
{chr(10).join(prow)}

Worst spoofing error on an ordinary screen: **{prot['spoofing_worst_reported_error_m']:,.0f} m**; worst error of what the response layer passed on: **{prot['spoofing_worst_protected_error_m']:,.0f} m**. Jamming blank screen: **{prot['jamming_blank_s_without']} s** without, **{prot['jamming_blank_s_with']} s** with. Holds outside attacks (a brief dip on a normal run, or the seconds after an attack ends before the fix rejoins the estimate): {prot['false_hold_s_total']} s in total, each at an error of a few metres. A hold costs a few metres of odometer error even when the attack did not move the position (signal anomaly).

{real_section()}
### Read these numbers with care

{chr(10).join('- ' + l for l in META['limitations'])}
"""
    return md(text)


def results_brief() -> str:
    ex = META["experiments"]
    h = ex["hybrid"]
    prot = META["protection"]
    text = f"""
Ten held-out scenarios, {h['support_positive'] + h['support_negative']:,} one-second observations, on routes the model never saw in training. Synthetic data, so an upper bound; replays on real recordings follow.

| | Rules only | Model only | **Combined (TrustNav)** |
|---|---|---|---|
| Precision | {ex['rules']['precision']*100:.1f} % | {ex['ml']['precision']*100:.1f} % | **{h['precision']*100:.1f} %** |
| Recall | {ex['rules']['recall']*100:.1f} % | {ex['ml']['recall']*100:.1f} % | **{h['recall']*100:.1f} %** |
| False alarm rate | {ex['rules']['false_positive_rate']*100:.2f} % | {ex['ml']['false_positive_rate']*100:.2f} % | **{h['false_positive_rate']*100:.2f} %** |
| Mean time to detect | {ex['rules']['mean_detection_latency_obs']} s | {ex['ml']['mean_detection_latency_obs']} s | **{h['mean_detection_latency_obs']} s** |

7 of 7 attack types are caught; the stealth drift (Galileo signatures still valid) is caught after 42 s, where a fixed 150 m rule would need about 3.5 minutes.

**What the response layer prevents.** Worst spoofing error an ordinary fleet screen would show: **{prot['spoofing_worst_reported_error_m']:,.0f} m**. Worst error of what TrustNav hands downstream: **{prot['spoofing_worst_protected_error_m']:,.0f} m**. Jamming blank screen: **{prot['jamming_blank_s_without']} s** without, **{prot['jamming_blank_s_with']} s** with.
{real_section(brief=True)}"""
    return md(text)


def next_brief() -> str:
    road = (HERE / "ROADMAP.md").read_text()
    phase2 = road.split("## Phase 2: real receiver (next two weeks)", 1)[1].split("## Phase 3", 1)[0]
    # the brief lists what is still to do; what is done is in its results section
    phase2 = "\n".join(line for line in phase2.split("\n") if not line.rstrip().endswith("| done |"))
    phase2 = "\nAlready done: a phone as the receiver, a clean real drive replayed, and recordings of real attacks replayed (section 3).\n" + phase2
    text = "**Prevention, honestly.** No software can stop a jammer or a spoofer from transmitting; only antenna hardware mitigates at the radio level. What software can prevent is the damage: a fleet system acting on a false position. That is what the response layer does today.\n\n### Phase 2: real receiver (next two weeks)" + phase2 + """
### Later
A vehicle's own odometer as the inertial input; a second antenna on the same vehicle to catch synchronous spoofing; real Galileo OSNMA from raw pages; map matching for vehicles without an assigned route; alerts by e-mail or SMS; drone integration (PX4); a Raspberry Pi edge box.

### Links
Live demo: https://trustnav.vercel.app · Source and full documentation: https://github.com/domail2karandeshmukh-cyber/trustnav
"""
    return md(text)


def appendix() -> str:
    readme = (ROOT / "README.md").read_text()
    run = readme.split("## Run the engine", 1)[1]
    run = "## Run the engine" + run.split("## Repository layout", 1)[0] if "## Repository layout" in run else "## Run the engine" + run
    text = run.replace("## Run the engine", "### Run the engine").replace("## Run the dashboard", "### Run the dashboard")
    text += """

### Links

- Live demo: https://trustnav.vercel.app
- Source code and documentation: https://github.com/domail2karandeshmukh-cyber/trustnav
- This document is built from the `docs/` folder of the repository with `python3 docs/build_pdf.py`.

### Schedule

Three tutor meetings; oral examination on 13 November 2026, 09:35, room C201. Team and contributions are in section 10.
"""
    return md(text)


def build(brief: bool = False) -> Path:
    today = date.today().strftime("%-d %B %Y")
    sections = BRIEF if brief else SECTIONS
    toc = "".join(f'<li><a href="#s{n}"><span>{n}</span>{t}</a></li>' for n, t, _ in sections)
    parts = []
    for n, t, src in sections:
        if src:
            html = md(body_without_title(HERE / src))
        elif t.startswith("The console"):
            html = console_section(brief)
        elif t == "Results":
            html = results_brief() if brief else results_section()
        elif t == "What comes next":
            html = next_brief()
        else:
            html = appendix()
        parts.append(f'<section id="s{n}" class="sec"><h1><span class="n">{n}</span>{t}</h1>{html}</section>')
    fonts = "".join(
        f"@font-face{{font-family:Barlow;font-weight:{w};src:url('file://{FONTS}/barlow-latin-{w}-normal.woff2') format('woff2');}}"
        for w in (400, 500, 600, 700))
    engine = META["engine_version"]
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TrustNav technical documentation</title>
<style>
{fonts}
@page {{ size: A4; margin: 18mm 16mm 20mm 16mm; }}
* {{ box-sizing: border-box; }}
body {{ font: 10.6pt/1.5 Barlow, "Helvetica Neue", Arial, sans-serif; color: #14233b; margin: 0; }}
h1, h2, h3, h4 {{ font-weight: 600; line-height: 1.2; margin: 1.6em 0 .5em; page-break-after: avoid; }}
h1 {{ font-size: 22pt; margin-top: 0; padding-bottom: 8px; border-bottom: 2px solid #14233b; }}
h1 .n {{ display: inline-block; min-width: 1.6em; color: #1f5fbf; }}
h2 {{ font-size: 15pt; color: #1f5fbf; }}
h3 {{ font-size: 12pt; }}
p {{ margin: .45em 0 .75em; }}
a {{ color: #1f5fbf; text-decoration: none; }}
code {{ font: 9.2pt/1.4 "SFMono-Regular", Menlo, Consolas, monospace; background: #f2f4f7; padding: 1px 4px; border-radius: 3px; }}
pre {{ font: 8.6pt/1.4 Menlo, Consolas, monospace; background: #f2f4f7; padding: 10px 12px; border-radius: 6px; overflow: hidden; white-space: pre-wrap; page-break-inside: avoid; }}
pre code {{ background: none; padding: 0; font-size: inherit; }}
table {{ width: 100%; border-collapse: collapse; font-size: 9.4pt; margin: .5em 0 1em; page-break-inside: auto; }}
th, td {{ padding: 5px 7px; border-bottom: 1px solid #dde2e8; text-align: left; vertical-align: top; }}
th {{ font-weight: 600; background: #f2f4f7; border-bottom: 2px solid #14233b; }}
tr {{ page-break-inside: avoid; }}
ul, ol {{ padding-left: 1.3em; }}
li {{ margin: .18em 0; }}
blockquote {{ margin: .6em 0; padding: .4em 1em; border-left: 3px solid #1f5fbf; background: #f7f9fc; color: #4a5a72; }}
.sec {{ page-break-before: always; }}
.cover {{ height: 257mm; display: flex; flex-direction: column; justify-content: space-between; }}
.cover .kicker {{ font-size: 11pt; letter-spacing: .14em; text-transform: uppercase; color: #1f5fbf; font-weight: 600; }}
.cover h1 {{ font-size: 40pt; border: 0; margin: 10px 0 6px; line-height: 1.05; }}
.cover .sub {{ font-size: 16pt; color: #4a5a72; max-width: 34em; }}
.cover .meta {{ font-size: 11pt; color: #4a5a72; line-height: 1.7; }}
.cover .meta b {{ color: #14233b; }}
.cover .box {{ margin-top: 26px; padding: 16px 20px; border: 1px solid #dde2e8; border-radius: 10px; font-size: 10.5pt; max-width: 40em; }}
.cover .facts {{ display: flex; gap: 28px; margin-top: 22px; }}
.cover .facts div {{ font-size: 10pt; color: #4a5a72; }}
.cover .facts b {{ display: block; font-size: 20pt; color: #14233b; font-weight: 600; }}
.toc ol {{ list-style: none; padding: 0; column-count: 1; }}
.toc li a {{ display: flex; gap: 14px; padding: 7px 0; border-bottom: 1px solid #ebeef2; color: #14233b; font-size: 12pt; }}
.toc li a span {{ min-width: 1.6em; color: #1f5fbf; font-weight: 600; }}
figure {{ margin: 1em 0; page-break-inside: avoid; }}
figure img {{ width: 100%; border: 1px solid #dde2e8; border-radius: 6px; }}
figcaption {{ font-size: 9pt; color: #4a5a72; margin-top: 5px; }}
.figgrid {{ display: grid; grid-template-columns: 38% 1fr; gap: 14px; align-items: start; page-break-inside: avoid; page-break-before: always; }}
.figgrid figure {{ margin: 0; }}
.figcol {{ display: flex; flex-direction: column; gap: 12px; }}
.half img {{ width: 62%; }}
.footer {{ font-size: 8pt; color: #5f6c84; }}
.cover.compact {{ height: auto; display: block; padding-bottom: 18px; border-bottom: 2px solid #14233b; margin-bottom: 8px; }}
.cover.compact h1 {{ font-size: 30pt; }}
.cover.compact .sub {{ font-size: 12.5pt; }}
.cover.compact .box {{ margin-top: 14px; padding: 12px 16px; max-width: none; }}
.cover.compact .facts {{ margin-top: 14px; }}
.cover.compact .meta {{ margin-top: 14px; font-size: 10pt; line-height: 1.5; }}
body.brief .sec {{ page-break-before: auto; }}
body.brief .sec h1 {{ font-size: 17pt; margin-top: 1.2em; }}
body.brief .figgrid {{ page-break-before: auto; }}
</style></head><body>
<div class="cover">
  <div>
    <div class="kicker">Technical documentation</div>
    <h1>TrustNav</h1>
    <div class="sub">Live trust monitoring for satellite positions: detection, explanation and response to GNSS jamming, spoofing and forgery, for vehicle and drone fleets.</div>
    <div class="facts">
      <div><b>{META['experiments']['hybrid']['precision']*100:.1f} %</b>precision</div>
      <div><b>{META['experiments']['hybrid']['recall']*100:.1f} %</b>recall</div>
      <div><b>{META['experiments']['hybrid']['false_positive_rate']*100:.2f} %</b>false alarms</div>
      <div><b>{META['protection']['spoofing_worst_reported_error_m']/1000:.0f} km → {META['protection']['spoofing_worst_protected_error_m']:.0f} m</b>worst lie, before and after the response layer</div>
    </div>
    <div class="box">
      <b>What it is.</b> Every second, for each vehicle, TrustNav scores whether its satellite position can be believed (0 to 100), explains why in plain words, and refuses positions it does not believe, tracking the vehicle by its odometer instead. Three kinds of evidence are fused: physical rules, an anomaly model trained on normal driving only, and Galileo's own digital signatures (OSNMA).<br><br>
      <b>Where it is.</b> Live demo at <a href="https://trustnav.vercel.app">trustnav.vercel.app</a>. Source, tests and this document at <a href="https://github.com/domail2karandeshmukh-cyber/trustnav">github.com/domail2karandeshmukh-cyber/trustnav</a>. Our attacks are simulated in software and the real ones are recordings made by others; nothing is transmitted.<br><br>
      <b>On real attacks.</b> Replayed on public recordings from Jammertest 2024: the first version missed a phone captured by a real spoofer for 21 min 49 s; a sixteenth rule on receiver time now refuses every captured fix from the first second.
    </div>
  </div>
  <div class="meta">
    <b>Group 2</b>, MSc Cybersecurity and Data Science, ESAIP Angers<br>
    Karan Deshmukh, Sudheer Reddy Jogi, Niranjan Satheesh Thandassery, Venkata Pavan Kumar Sanam<br>
    Tutor: Sofiane Hamrioui &nbsp;·&nbsp; Engine {engine} &nbsp;·&nbsp; {today}
  </div>
</div>
<section class="sec toc"><h1>Contents</h1><ol>{toc}</ol>
<p>Sections 1 and 4 are written for a reader who has never seen the project. Sections 3, 5 and 6 are the technical detail. Section 7 answers "why is this different from what exists?" and section 8 "does it prevent attacks, and how does it improve?".</p></section>
{''.join(parts)}
</body></html>"""
    if brief:
        page = page.replace('<div class="kicker">Technical documentation</div>', '<div class="kicker">Project brief</div>')
        # no contents page, sections flow, compact cover
        page = re.sub(r'<section class="sec toc">.*?</section>', "", page, flags=re.S)
        page = page.replace('<div class="cover">', '<div class="cover compact">').replace("<body>", '<body class="brief">')
        page = page.replace("TrustNav technical documentation · Group 2", "TrustNav project brief · Group 2")
    out_html = HERE / "_build.html"
    out_html.write_text(page)

    from playwright.sync_api import sync_playwright
    out_pdf = HERE / ("TrustNav_Project_Brief.pdf" if brief else "TrustNav_Technical_Documentation.pdf")
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto(out_html.as_uri(), wait_until="load")
        pg.wait_for_timeout(500)
        pg.pdf(path=str(out_pdf), format="A4", print_background=True, prefer_css_page_size=True, display_header_footer=True,
               header_template="<div></div>",
               footer_template='<div style="width:100%;font:8pt Barlow,Arial,sans-serif;color:#5f6c84;padding:0 16mm;display:flex;justify-content:space-between;">'
                               f'<span>TrustNav {"project brief" if brief else "technical documentation"} · Group 2, ESAIP Angers</span><span class="pageNumber"></span></div>')
        b.close()
    out_html.unlink()
    return out_pdf


if __name__ == "__main__":
    import sys
    for brief in ([True] if "--brief" in sys.argv else [False] if "--full" in sys.argv else [False, True]):
        path = build(brief)
        print(f"wrote {path} ({path.stat().st_size/1e6:.1f} MB)")
