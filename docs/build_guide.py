"""Build docs/TrustNav_Demo_Guide.pdf: the demonstration on two pages.

    cd docs && python3 build_guide.py

For a reader who cannot attend the live demonstration: the link, the four
screens worth opening, and what each one proves. The screens are in
docs/images/guide-*.png. Needs playwright (with Chromium) and pypdf.
"""

from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FONTS = ROOT / "dashboard" / "node_modules" / "@fontsource" / "barlow" / "files"
SITE = "https://trustnav.vercel.app"
REPO = "https://github.com/domail2karandeshmukh-cyber/trustnav"

STEPS = [
    ("Open the link and click “Watch an attack, 60 seconds”", "guide-1-opening.png",
     "A van drives through Angers. A spoofer throws its reported position 8 km away. The trust score falls from the nineties to under 20, "
     "the false position is refused, and the van is tracked by its odometer. The story then plays by itself, with captions.",
     "The opening screen during the attack: the reported position 8 km away is refused, the protected position follows the road."),
    ("Replay, Teleport spoof: what the operator reads", "guide-2-replay.png",
     "The score, the verdict in plain words, and the evidence: each unusual measure with its value against its normal range. "
     "On the map: the real path, the reported position 8 km away, and the dashed lie between them.",
     "The replay at the attack. On the live site the streets of Angers appear under the tracks."),
    ("Results, Real attacks: beyond the simulator", "guide-3-real-attacks.png",
     "The detector replayed on public recordings of real attacks (Jammertest 2024, Norway). Our first version missed a phone captured by a real spoofer "
     "for 21 min 49 s. With a sixteenth rule, receiver time checked against the phone's own clock, the alert comes in the same second "
     "and 909 of 909 captured positions are refused.",
     "What the phone reports ends 10.2 km off; what TrustNav hands on stays within 45 m."),
    ("Method, Try it: why two witnesses", "guide-4-fusion.png",
     "Two sliders: the risk seen by the rules and the risk seen by the model. An average lets one calm witness talk the other down; "
     "the fusion we use does not. This is the design choice behind the score.",
     "A model at 90 with silent rules: an average would let the attack pass, the noisy-OR refuses the fix."),
]


def build() -> Path:
    fonts = "".join(
        f"@font-face{{font-family:Barlow;font-weight:{w};src:url('file://{FONTS}/barlow-latin-{w}-normal.woff2') format('woff2');}}"
        for w in (400, 500, 600, 700))
    steps = "".join(
        f'<section class="step{" brk" if i == 3 else ""}"><h2><span>{i}</span>{title}</h2><p>{text}</p>'
        f'<figure><img src="images/{img}" alt=""><figcaption>{cap}</figcaption></figure></section>'
        for i, (title, img, text, cap) in enumerate(STEPS, 1))
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TrustNav: the demonstration in two minutes</title>
<style>
{fonts}
@page {{ size: A4; margin: 14mm 16mm 16mm 16mm; }}
* {{ box-sizing: border-box; }}
body {{ font: 10.4pt/1.45 Barlow, "Helvetica Neue", Arial, sans-serif; color: #14233b; margin: 0; }}
.kicker {{ font-size: 9.5pt; letter-spacing: .12em; text-transform: uppercase; color: #1f5fbf; font-weight: 600; }}
h1 {{ font-size: 23pt; line-height: 1.1; margin: 4px 0 5px; font-weight: 600; }}
.sub {{ font-size: 11.5pt; color: #4a5a72; margin: 0 0 10px; }}
.link {{ display: flex; align-items: baseline; gap: 14px; padding: 9px 14px; border: 1px solid #c9d1dc; border-left: 4px solid #1f5fbf; border-radius: 8px; margin: 0 0 12px; }}
.link a {{ font-size: 15pt; font-weight: 600; color: #1f5fbf; text-decoration: none; white-space: nowrap; }}
.link span {{ color: #4a5a72; font-size: 10pt; }}
.step {{ margin: 0 0 7px; page-break-inside: avoid; }}
.step.brk {{ page-break-before: always; }}
h2 {{ font-size: 13pt; font-weight: 600; margin: 0 0 3px; display: flex; align-items: center; gap: 9px; }}
h2 span {{ display: inline-grid; place-items: center; flex: none; width: 21px; height: 21px; border-radius: 50%; background: #14233b; color: #fff; font-size: 10pt; }}
.step p {{ margin: 0 0 6px; }}
figure {{ margin: 0 auto; width: 81%; }}
figure img {{ display: block; width: 100%; border: 1px solid #c9d1dc; border-radius: 6px; }}
figcaption {{ font-size: 8.8pt; color: #4a5a72; margin-top: 3px; }}
.more {{ margin-top: 9px; padding-top: 8px; border-top: 2px solid #14233b; page-break-inside: avoid; }}
.more h3 {{ font-size: 11.5pt; margin: 0 0 5px; font-weight: 600; }}
.more table {{ width: 100%; border-collapse: collapse; font-size: 9.6pt; margin: 0 0 9px; }}
.more td {{ padding: 4px 6px 4px 0; border-bottom: 1px solid #dde2e8; vertical-align: top; }}
.more td:first-child {{ font-weight: 600; white-space: nowrap; width: 11.5em; }}
.more a {{ color: #1f5fbf; text-decoration: none; }}
.note {{ font-size: 9pt; color: #4a5a72; margin: 0; }}
</style></head><body>
<div class="kicker">Technical project · Group 2 · MSc Cybersecurity and Data Science, ESAIP Angers</div>
<h1>TrustNav: the demonstration in two minutes</h1>
<p class="sub">The demonstration is online. This guide shows the four screens worth opening, and what each one proves.</p>
<div class="link"><a href="{SITE}">trustnav.vercel.app</a><span>Nothing to install, no account. It works on a laptop and on a phone.</span></div>
{steps}
<div class="more">
<h3>Also worth a look</h3>
<table>
<tr><td>Results, Overview</td><td>99.3 % precision, 96.1 % recall and 0.44 % false alarms, on routes the model never saw in training</td></tr>
<tr><td>Results, Each attack</td><td>Ten recorded runs: when the alert came, what an ordinary screen would have shown, what TrustNav hands on</td></tr>
<tr><td>Method, The 16 rules</td><td>Every rule with its threshold and its weight</td></tr>
<tr><td>Source code</td><td><a href="{REPO}">github.com/domail2karandeshmukh-cyber/trustnav</a>: engine, cloud side, console, tests, paper and report</td></tr>
</table>
<p class="note">The paper (six pages, in English and in French), the report (44 pages), a six-page summary and the slides are sent with this guide. Our own attacks are simulated in software and the real ones are recordings made by others: nothing is ever transmitted.</p>
</div>
</body></html>"""
    out_html = HERE / "_guide.html"
    out_pdf = HERE / "TrustNav_Demo_Guide.pdf"
    out_html.write_text(page)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto(out_html.as_uri(), wait_until="load")
        pg.wait_for_timeout(400)
        pg.pdf(path=str(out_pdf), format="A4", print_background=True, prefer_css_page_size=True, display_header_footer=True,
               header_template="<div></div>",
               footer_template='<div style="width:100%;font:8pt Barlow,Arial,sans-serif;color:#5f6c84;padding:0 16mm;display:flex;justify-content:space-between;">'
                               '<span>TrustNav demo guide · Group 2, ESAIP Angers</span><span class="pageNumber"></span></div>')
        b.close()
    out_html.unlink()
    from pypdf import PdfReader, PdfWriter
    r, w = PdfReader(str(out_pdf)), PdfWriter()
    for page_ in r.pages:
        w.add_page(page_)
    w.add_metadata({"/Title": "TrustNav: the demonstration in two minutes", "/Author": "Group 2, MSc Cybersecurity and Data Science, ESAIP Angers",
                    "/Subject": "Technical project, demonstration guide", "/Creator": "TrustNav project", "/Producer": "TrustNav project"})
    w.write(str(out_pdf))
    return out_pdf


if __name__ == "__main__":
    path = build()
    from pypdf import PdfReader
    print(f"wrote {path} ({len(PdfReader(str(path)).pages)} pages, {path.stat().st_size / 1e6:.1f} MB)")
