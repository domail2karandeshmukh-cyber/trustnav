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
    if tour_done: await pg.evaluate("localStorage.setItem('trustnav-tour-done','1')")
    if dark: await pg.evaluate("localStorage.setItem('trustnav-theme','dark')")
    await pg.reload(wait_until="domcontentloaded")
    return ctx, pg, errs

async def axe(pg, name):
    await pg.add_script_tag(path=str(AXE))
    r = await pg.evaluate("axe.run(document, {runOnly: ['wcag2a','wcag2aa'], rules: {'color-contrast': {enabled: true}}})")
    serious = [v for v in r["violations"] if v["impact"] in ("serious", "critical")]
    check(f"a11y {name}: no serious violations", not serious, "; ".join(f"{v['id']} ({len(v['nodes'])})" for v in serious))
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
        await axe(pg, "replay")
        # results + method
        await pg.keyboard.press("3"); await pg.wait_for_selector(".compare", timeout=15000)
        check("results: comparison table", await pg.locator(".compare tbody tr").count() >= 6)
        check("results: scenario tapes", await pg.locator(".scen .tape").count() >= 10)
        await axe(pg, "results")
        await pg.keyboard.press("4"); await pg.wait_for_selector(".pipeline")
        check("method: pipeline figure", await pg.locator(".pipeline > div").count() >= 5)
        await pg.keyboard.press("1"); await pg.wait_for_selector(".row-name")
        await axe(pg, "live")
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

        # ---- first visit tour ----
        ctx, pg, errs = await page_for(b, 1440, 900, tour_done=False)
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
