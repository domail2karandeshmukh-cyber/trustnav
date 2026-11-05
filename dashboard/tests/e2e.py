"""End-to-end checks for the TrustNav console.

Run:  python3 tests/e2e.py [base_url]
Needs the site running (default http://localhost:3100) and Playwright for Python.
Covers every view, the main interactions, keyboard shortcuts, dark mode,
phone layout, console errors and an axe-core accessibility scan.
"""
import asyncio, json, sys, time, pathlib
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
AXE = pathlib.Path(__file__).resolve().parents[1] / "node_modules/axe-core/axe.min.js"
IGNORE = ("TUNNEL", "WebSocket", "net::ERR", "Failed to load resource", "basemaps.cartocdn", "tile.openstreetmap", "supabase.co")

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail and not ok else ""))

async def page_for(b, w, h, dark=False, tour_done=True):
    ctx = await b.new_context(viewport={"width": w, "height": h})
    pg = await ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and not any(k in m.text for k in IGNORE) else None)
    await pg.goto(BASE + "/#live", wait_until="domcontentloaded")
    if tour_done: await pg.evaluate("localStorage.setItem('trustnav-tour-done','1'); sessionStorage.setItem('trustnav-intro-seen','1')")
    if dark: await pg.evaluate("localStorage.setItem('trustnav-theme','dark')")
    await pg.reload(wait_until="domcontentloaded")
    return ctx, pg, errs

async def axe(pg, name):
    await pg.add_script_tag(path=str(AXE))
    r = await pg.evaluate("axe.run(document, {runOnly: ['wcag2a','wcag2aa'], rules: {'color-contrast': {enabled: true}}})")
    serious = [v for v in r["violations"] if v["impact"] in ("serious", "critical")]
    check(f"a11y {name}: no serious violations", not serious, "; ".join(f"{v['id']} ({len(v['nodes'])})" for v in serious))
    for v in serious:
        for n in v["nodes"][:3]:
            print(f"   {v['id']}: {n['target']} {n['html'][:140]}")
    for v in r["violations"]:
        if v["impact"] not in ("serious", "critical"):
            print(f"   note {name}: {v['id']} x{len(v['nodes'])} ({v['impact']})")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ---- desktop, light ----
        ctx, pg, errs = await page_for(b, 1440, 900)
        await pg.wait_for_selector(".row-name", timeout=25000)
        await pg.wait_for_selector(".mk", timeout=15000)
        rows = await pg.locator(".row").count()
        check("live: fleet rows appear", rows >= 5, f"{rows} rows")
        check("live: headline present", await pg.locator(".headline").count() == 1)
        check("live: map canvas rendered", await pg.locator(".map canvas").count() >= 1)
        markers = await pg.locator(".mk").count()
        check("live: markers on map", markers >= 5, f"{markers}")
        # smooth motion: marker position changes between two samples
        p1 = await pg.locator(".mk").first.evaluate("e => e.style.transform")
        await pg.wait_for_timeout(1500)
        p2 = await pg.locator(".mk").first.evaluate("e => e.style.transform")
        check("live: markers move", p1 != p2)
        # open a device
        await pg.locator(".row").first.click()
        await pg.wait_for_selector(".detail")
        check("live: detail opens", await pg.locator(".detail h1").count() == 1)
        check("v7: plain verdict in the detail panel", await pg.locator(".detail .plain b").count() == 1 and len(await pg.locator(".detail .plain p").inner_text()) > 30)
        check("live: trust figure", await pg.locator(".figure .num").count() >= 1)
        # keyboard: Esc back, J next
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
        check("keys: Esc returns to list", await pg.locator(".panel-head h1").inner_text() == "Fleet")
        await pg.keyboard.press("j"); await pg.wait_for_timeout(300)
        check("keys: J selects next platform", await pg.locator(".detail").count() == 1)
        # report
        await pg.locator('button[aria-label="Incident report"]').click()
        await pg.wait_for_selector(".report")
        check("report: opens with stats", await pg.locator(".report-stat").count() == 4)
        check("report: map snapshot", await pg.locator(".report-map").count() == 1)
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        check("report: Esc closes", await pg.locator(".report").count() == 0)
        # palette
        await pg.keyboard.press("Control+k")
        await pg.wait_for_selector(".pal-input")
        await pg.locator(".pal-input").fill("teleport")
        await pg.wait_for_timeout(200)
        first = await pg.locator(".pal-item").first.inner_text()
        check("palette: finds scenario", "Teleport" in first, first)
        await pg.keyboard.press("Enter")
        await pg.wait_for_selector(".dock", timeout=15000)
        check("palette: opens replay", await pg.locator(".dock").count() == 1)
        check("replay: deep link in URL", "scenario=teleport_spoof" in pg.url)
        # replay controls
        t0 = await pg.locator(".dock-time").inner_text()
        await pg.keyboard.press("Space"); await pg.wait_for_timeout(1500)
        t1 = await pg.locator(".dock-time").inner_text()
        check("replay: space plays", t0 != t1, f"{t0} -> {t1}")
        await pg.keyboard.press("Space"); await pg.wait_for_timeout(300)
        t2 = await pg.locator(".dock-time").inner_text()
        await pg.keyboard.press("ArrowRight"); await pg.wait_for_timeout(200)
        t3 = await pg.locator(".dock-time").inner_text()
        check("replay: arrow steps one second", t2 != t3)
        check("replay: real-position ghost or truth path", await pg.locator(".ghost, .legend .truth").count() >= 1)
        # response layer: jump into the attack and check the hold is shown
        for _ in range(14):
            await pg.keyboard.press("Shift+ArrowRight")
        await pg.wait_for_timeout(400)
        for _ in range(60):
            if await pg.locator(".resp[data-action='ISOLATE'], .resp[data-action='VERIFY']").count():
                break
            await pg.keyboard.press("ArrowRight"); await pg.wait_for_timeout(40)
        check("response: hold shown in the panel", await pg.locator(".resp[data-action='ISOLATE'], .resp[data-action='VERIFY']").count() == 1)
        verdict = await pg.locator(".workspace.replay .plain").inner_text()
        check("v7: replay verdict names the attack in plain words", "faked" in verdict.lower() or "forged" in verdict.lower() or "jammed" in verdict.lower() or "drifting" in verdict.lower(), verdict[:80])
        check("v7: evidence uses everyday wording", "signal strength" in (await pg.locator(".workspace.replay .reasons").inner_text()).lower() or "position moved" in (await pg.locator(".workspace.replay .reasons").inner_text()).lower())
        check("response: shield marker on the map", await pg.locator(".workspace.replay .shield").count() == 1)
        check("response: protected path in the legend", await pg.locator(".legend .protect").count() == 1)
        check("response: replay verdict quotes the protection", "response layer" in (await pg.locator(".verdict.protect").inner_text()).lower())
        await pg.locator(".workspace.replay .stage-toggle button").nth(1).click(); await pg.wait_for_timeout(800)
        check("space-time: renders in replay", await pg.locator(".workspace.replay .st canvas").count() == 1)
        await pg.locator(".workspace.replay .stage-toggle button").nth(0).click(); await pg.wait_for_timeout(300)
        await axe(pg, "replay")
        # results + method
        await pg.keyboard.press("3"); await pg.wait_for_selector(".compare", timeout=15000)
        check("results: comparison table", await pg.locator(".compare tbody tr").count() >= 6)
        check("results: scenario tapes", await pg.locator(".scen .tape").count() >= 10)
        prot = await pg.locator("h2:has-text('What the response layer prevents')").count()
        check("results: protection section", prot == 1)
        check("results: protection rows", await pg.locator(".scen").nth(1).locator("tbody tr").count() >= 10)
        await axe(pg, "results")
        await pg.keyboard.press("4"); await pg.wait_for_selector(".pipeline")
        check("method: pipeline figure", await pg.locator(".pipeline > div").count() >= 6)
        check("method: response section", await pg.locator("h2:has-text('From detection to response')").count() == 1)
        check("method: comparison table", await pg.locator(".compare.landscape tbody tr").count() == 8)
        await axe(pg, "method")
        await pg.keyboard.press("1"); await pg.wait_for_selector(".row-name")
        await axe(pg, "live")
        # space-time view
        await pg.locator(".view-live .stage-toggle button").nth(1).click(); await pg.wait_for_timeout(800)
        check("space-time: canvas renders in live", await pg.locator(".view-live .st canvas").count() == 1)
        painted = await pg.locator(".view-live .st canvas").evaluate("c => { const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3] > 0) n++; return n }")
        check("space-time: canvas has pixels", painted > 100, f"{painted}")
        await pg.locator(".view-live .stage-toggle button").nth(0).click(); await pg.wait_for_timeout(300)
        # fleet timeline + system health
        await pg.keyboard.press("t"); await pg.wait_for_timeout(400)
        check("live: fleet timeline dock", await pg.locator(".timeline .tl-row").count() >= 5)
        check("v6: no stray dialog before the live checks", await pg.locator(".report-back, .caption.present").count() == 0)
        check("v6: fleet KPI strip", await pg.locator(".kpis .kpi").count() == 4)
        check("v7: map legend", await pg.locator(".live-legend span").count() >= 5)
        check("v7: fleet headline in plain words", "believed" in (await pg.locator(".headline").inner_text()))
        await pg.keyboard.press("Shift+?"); await pg.wait_for_timeout(400)
        check("v7: guide opens with ?", await pg.locator(".guide h2").count() == 1)
        check("v7: guide explains the map and the attacks", await pg.locator(".guide-legend li").count() >= 8 and await pg.locator(".guide-attacks > div").count() == 3)
        await axe(pg, "guide")
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
        check("v7: guide closes with Esc", await pg.locator(".guide").count() == 0)
        # v8: narrated explainer, ten languages (headless Chromium has no voices, so captions are timed)
        await pg.keyboard.press("Shift+?"); await pg.wait_for_timeout(300)
        await pg.locator(".guide-actions button:has-text('Explain it to me')").click()
        await pg.wait_for_selector(".caption.explainer", timeout=15000); await pg.wait_for_timeout(900)
        check("v8: explainer opens from the guide", await pg.locator(".caption.explainer").count() == 1)
        first = await pg.locator(".explain-text").inner_text()
        check("v8: first scene is the welcome", "Welcome to TrustNav" in first, first[:60])
        check("v8: ten languages offered", await pg.locator(".lang-pick option").count() == 10)
        check("v8: no-voice note when the device has no voice", await pg.locator(".explain-note").count() == 1)
        await pg.locator(".lang-pick select").select_option("fr"); await pg.wait_for_timeout(900)
        fr = await pg.locator(".explain-text").inner_text()
        check("v8: switching language re-narrates the scene in French", "Bienvenue" in fr, fr[:60])
        await pg.locator(".lang-pick select").select_option("mr"); await pg.wait_for_timeout(900)
        mr = await pg.locator(".explain-text").inner_text()
        check("v8: Marathi caption", "TrustNav" in mr and "स्वागत" in mr, mr[:40])
        await pg.locator(".lang-pick select").select_option("en"); await pg.wait_for_timeout(600)
        await pg.locator(".explain-actions button:has-text('Next')").click(); await pg.wait_for_timeout(1300)
        second = await pg.locator(".explain-text").inner_text()
        check("v8: next scene selects a trusted platform and names it", "ring is green" in second and await pg.locator(".detail h1").count() == 1, second[:60])
        check("v8: spotlight on the panel", await pg.locator(".spot").count() == 1)
        for _ in range(2):
            await pg.locator(".explain-actions button:has-text('Next')").click(); await pg.wait_for_timeout(1300)
        fourth = await pg.locator(".explain-text").inner_text()
        check("v8: attack scene names the lie or says no attack yet", "refused" in (await pg.locator(".detail .mk-tag em, .detail .plain").count() and "") or "lie" in fourth or "No attack" in fourth, fourth[:80])
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(400)
        check("v8: Esc closes the explainer", await pg.locator(".caption.explainer").count() == 0 and await pg.locator(".spot").count() == 0)
        check("v6: markers carry a trust ring and score", await pg.locator(".view-live .mk-arc").count() >= 5 and await pg.locator(".view-live .mk-tag em").first.inner_text() != "")
        for _ in range(40):
            if await pg.locator(".view-live .shield").count(): break
            await pg.wait_for_timeout(500)
        check("v6: refused fix shows the protected position live", await pg.locator(".view-live .shield").count() >= 1)
        check("v6: shield carries the size of the refused lie", "refused" in (await pg.locator(".view-live .shield b").first.inner_text()))
        check("v6: alert cards have sparklines", await pg.locator(".alerts-float .spark").count() >= 1)
        check("v6: alert cards show the response action", await pg.locator(".alerts-float .act").count() >= 1)
        await pg.locator(".alerts-float .ack").first.click(); await pg.wait_for_timeout(200)
        check("v6: acknowledge marks the alert", await pg.locator(".alerts-float .acked").count() == 1)
        held_id = await pg.locator(".view-live .mk.held").first.get_attribute("aria-label")
        await pg.locator(".view-live .mk.held").first.dispatch_event("click"); await pg.wait_for_timeout(600)  # markers glide, so no stability wait
        check("v6: playbook for a refused platform", await pg.locator(".playbook .steps li").count() >= 3, held_id or "")
        check("v6: no report dialog reappears after a selection", await pg.locator(".report-back").count() == 0)
        await pg.locator(".playbook input").first.check(); await pg.wait_for_timeout(100)
        check("v6: playbook step can be ticked", await pg.locator(".playbook li.done").count() == 1)
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
        await pg.keyboard.press("p"); await pg.wait_for_timeout(900)
        check("v6: presentation mode shows a caption", await pg.locator(".caption.present").count() == 1)
        check("v9: presentation caption has a voice toggle", await pg.locator(".caption.present .voice-btn").count() == 1)
        first_name = await pg.locator(".caption.present h3").inner_text()
        await pg.wait_for_timeout(8500)
        second_name = await pg.locator(".caption.present h3").inner_text()
        check("v6: presentation moves to the next platform", first_name != second_name, f"{first_name} / {second_name}")
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
        check("v6: Esc ends the presentation", await pg.locator(".caption.present").count() == 0)
        await pg.keyboard.press("t"); await pg.wait_for_timeout(200)
        await pg.locator(".strip .src").click(); await pg.wait_for_timeout(200)
        check("live: system health panel", await pg.locator(".pop.health").count() == 1)
        await pg.locator('.pop.health button[aria-label="Close"]').click()
        # dark mode toggle
        await pg.keyboard.press("d"); await pg.wait_for_timeout(300)
        check("theme: D toggles dark", await pg.evaluate("document.documentElement.dataset.theme") == "dark")
        await pg.wait_for_timeout(1500)
        await axe(pg, "live dark")
        bg = await pg.evaluate("getComputedStyle(document.body).backgroundColor")
        check("theme: dark background applied", bg not in ("rgb(245, 246, 244)", "rgba(0, 0, 0, 0)"), bg)
        check("no console errors (desktop)", not errs, "; ".join(errs[:3]))
        await ctx.close()

        # ---- phone ----
        ctx, pg, errs = await page_for(b, 390, 844)
        await pg.wait_for_selector(".row-name", timeout=25000)
        sw = await pg.evaluate("document.documentElement.scrollWidth")
        check("phone: no horizontal overflow", sw <= 390, f"{sw}")
        check("phone: bottom nav", await pg.locator(".rail .nav").count() >= 4)
        await pg.locator(".row").first.click(); await pg.wait_for_selector(".detail")
        check("phone: detail opens", True)
        await pg.locator(".rail .nav").nth(1).click(); await pg.wait_for_selector(".dock", timeout=15000)
        mh = await pg.locator(".workspace.replay .stage-map").evaluate("e => e.getBoundingClientRect().height")
        check("phone: map has height", mh >= 280, f"{mh}")
        check("no console errors (phone)", not errs, "; ".join(errs[:3]))
        await ctx.close()

        # ---- opening screen + story ----
        ctx, pg, errs = await page_for(b, 1440, 900, tour_done=False)
        await pg.wait_for_selector(".hero", timeout=15000)
        check("hero: shows on first visit", await pg.locator(".hero h1").count() == 1)
        check("v8: hero offers the narrated explainer", await pg.locator(".hero .hero-btn:has-text('Explain it to me')").count() == 1)
        check("v9: hero language menu with ten languages", await pg.locator(".hero-lang option").count() == 10)
        await pg.locator(".hero-lang select").select_option("fr"); await pg.wait_for_timeout(300)
        check("v9: hero switches to French", "Peut-on croire" in (await pg.locator(".hero h1").inner_text()))
        await pg.locator(".hero-lang select").select_option("en"); await pg.wait_for_timeout(200)
        await pg.locator(".hero-btn.primary").click()
        await pg.wait_for_selector(".caption", timeout=20000)
        check("story: starts from the opening screen", True)
        first_title = await pg.locator(".caption h3").inner_text()
        await pg.wait_for_timeout(16000)
        later_title = await pg.locator(".caption h3").inner_text()
        check("story: beats advance on their own", first_title != later_title, f"{first_title} / {later_title}")
        dots = await pg.locator(".caption-dots i").count()
        check("story: has several beats", dots >= 4, f"{dots}")
        check("v9: story has a voice toggle", await pg.locator(".caption .voice-btn").count() == 1)
        await pg.locator(".caption .voice-btn").click(); await pg.wait_for_timeout(200)
        check("v9: voice toggle mutes", await pg.locator(".caption .voice-btn[aria-pressed='false']").count() == 1)
        await pg.locator(".caption .voice-btn").click(); await pg.wait_for_timeout(200)
        pitch = await pg.evaluate("(() => { const c = document.querySelector('.workspace.replay .map canvas'); return c ? 1 : 0 })()")
        check("story: map present in cinematic mode", pitch == 1)
        await pg.locator('.caption button[aria-label="Leave the story"]').click()
        check("story: can leave", await pg.locator(".caption").count() == 0)
        check("story: no live toast leaked into replay", await pg.locator(".toast").count() == 0)
        check("no console errors (story)", not errs, "; ".join(errs[:3]))
        await ctx.close()

        # ---- first visit tour ----
        ctx, pg, errs = await page_for(b, 1440, 900, tour_done=False)
        await pg.evaluate("sessionStorage.setItem('trustnav-intro-seen','1')"); await pg.reload(wait_until="domcontentloaded")
        await pg.wait_for_selector(".tour", timeout=15000)
        check("tour: shows on first visit", True)
        for _ in range(3): await pg.locator(".tour .primary").click(); await pg.wait_for_timeout(150)
        check("tour: finishes", await pg.locator(".tour").count() == 0)
        await pg.reload(wait_until="domcontentloaded"); await pg.wait_for_timeout(1500)
        check("tour: remembered", await pg.locator(".tour").count() == 0)
        await ctx.close()

        # ---- performance budget ----
        resp = await (await b.new_page()).goto(BASE + "/")
        html = await resp.text()
        import re
        js = re.findall(r'src="([^"]+\.js)"', html)
        import gzip
        total = 0
        for u in js:
            r = await (await b.new_page()).request.get(BASE + u if u.startswith("/") else u)
            total += len(gzip.compress(await r.body(), 6))
        check("perf: first-load JS under 260 kB gzipped (map loads lazily)", total < 260_000, f"{total/1000:.0f} kB")
        await b.close()

    fails = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
    sys.exit(1 if fails else 0)

asyncio.run(main())
