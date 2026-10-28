"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LiveView, { type LiveHandle } from "./LiveView";
import ReplayView, { type ReplayHandle } from "./ReplayView";
import ResultsView from "./ResultsView";
import MethodView from "./MethodView";
import CommandPalette, { type Command } from "./CommandPalette";
import Tour, { resetTour } from "./Tour";
import { ToastProvider } from "./Toasts";
import { IconLive, IconMethod, IconMoon, IconReplay, IconResults, IconSearch, IconSun, Wordmark } from "./Icons";
import type { ReplayData, RouteGeom } from "@/lib/types";
import { useTheme } from "@/lib/useTheme";
import { isMac, useShortcuts } from "@/lib/useShortcuts";

type View = "live" | "replay" | "results" | "method";
type Meta = Omit<ReplayData, "scenarios" | "routes"> & { scenarios: Omit<ReplayData["scenarios"][number], "frames">[] };

const NAV: [View, string, typeof IconLive, string][] = [
  ["live", "Live", IconLive, "1"],
  ["replay", "Replay", IconReplay, "2"],
  ["results", "Results", IconResults, "3"],
  ["method", "Method", IconMethod, "4"],
];
const ALIAS: Record<string, View> = { fleet: "live", eval: "results", incidents: "replay" };

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export default function Console() {
  const [view, setView] = useState<View>("live");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [routes, setRoutes] = useState<Record<string, RouteGeom> | null>(null);
  const [replay, setReplay] = useState<ReplayData | null>(null);
  const [replayErr, setReplayErr] = useState<string | null>(null);
  const [scenario, setScenario] = useState<string | undefined>();
  const [palette, setPalette] = useState(false);
  const { theme, toggle } = useTheme();
  const live = useRef<LiveHandle | null>(null);
  const replayH = useRef<ReplayHandle | null>(null);
  const [devices, setDevices] = useState<LiveHandle["devices"]>([]);

  useEffect(() => {
    getJSON<Meta>("/data/meta.json").then(setMeta).catch(() => {});
    getJSON<Record<string, RouteGeom>>("/data/routes.json").then(setRoutes).catch(() => {});
    const apply = () => {
      const [h, q] = window.location.hash.slice(1).split("?");
      const v = (ALIAS[h] ?? h) as View;
      if (NAV.some(([k]) => k === v)) setView(v);
      const sc = new URLSearchParams(q ?? "").get("scenario");
      if (sc) setScenario(sc);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  useEffect(() => {
    if ((view === "replay" || view === "results") && !replay && !replayErr) {
      getJSON<ReplayData>("/data/replay.json").then(setReplay).catch((e) => setReplayErr(String(e)));
    }
    const h = view === "replay" && scenario ? `#replay?scenario=${scenario}` : `#${view}`;
    if (window.location.hash !== h) history.replaceState(null, "", h);
  }, [view, replay, replayErr, scenario]);

  const openScenario = useCallback((slug: string) => { setScenario(slug); setView("replay"); }, []);
  const onLive = useCallback((h: LiveHandle) => {
    live.current = h;
    setDevices((d) => (d.length === h.devices.length && d.every((x, i) => x.id === h.devices[i].id) ? d : h.devices));
  }, []);
  const onReplay = useCallback((h: ReplayHandle) => { replayH.current = h; }, []);

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];
    NAV.forEach(([k, label, , key]) => out.push({ id: `view-${k}`, group: "Pages", title: label, hint: key, run: () => setView(k) }));
    devices.forEach((d) => out.push({
      id: `dev-${d.id}`, group: "Fleet", title: d.name, hint: d.id, keywords: d.kind,
      run: () => { setView("live"); live.current?.select(d.id); },
    }));
    (replay?.scenarios ?? meta?.scenarios ?? []).forEach((s) => out.push({
      id: `sc-${s.slug}`, group: "Recorded scenarios", title: s.name.split(":")[0], hint: s.name.split(":")[1]?.trim(), keywords: s.attack,
      run: () => openScenario(s.slug),
    }));
    out.push({ id: "theme", group: "Settings", title: theme === "dark" ? "Switch to light mode" : "Switch to dark mode", hint: "D", run: toggle });
    out.push({ id: "tour", group: "Settings", title: "Show the welcome tour again", run: () => { resetTour(); setView("live"); location.reload(); } });
    return out;
  }, [meta, replay, theme, toggle, openScenario, devices]);

  useShortcuts(useMemo(() => [
    { keys: "mod+k", run: () => setPalette((v) => !v), global: true },
    { keys: "/", run: () => setPalette(true) },
    { keys: "1", run: () => setView("live") },
    { keys: "2", run: () => setView("replay") },
    { keys: "3", run: () => setView("results") },
    { keys: "4", run: () => setView("method") },
    { keys: "d", run: toggle },
    { keys: "escape", run: () => { if (palette) setPalette(false); else if (view === "live") live.current?.select(null); } },
    { keys: "space", run: () => { if (view === "replay") replayH.current?.toggle(); } },
    { keys: "arrowleft", run: () => { if (view === "replay") replayH.current?.step(-1); } },
    { keys: "arrowright", run: () => { if (view === "replay") replayH.current?.step(1); } },
    { keys: "shift+arrowleft", run: () => { if (view === "replay") replayH.current?.step(-10); } },
    { keys: "shift+arrowright", run: () => { if (view === "replay") replayH.current?.step(10); } },
    { keys: "j", run: () => { if (view === "live") live.current?.select((cur) => stepDevice(live.current, cur, 1)); } },
    { keys: "k", run: () => { if (view === "live") live.current?.select((cur) => stepDevice(live.current, cur, -1)); } },
  ], [palette, view, toggle]), !palette);

  const modKey = isMac() ? "⌘" : "Ctrl";

  return (
    <ToastProvider>
      <div className="app" data-view={view}>
        <nav className="rail" aria-label="Views">
          <a className="brand" href="#live" onClick={(e) => { e.preventDefault(); setView("live"); }} aria-label="TrustNav, live view">
            <Wordmark />
            <span>TrustNav</span>
          </a>
          {NAV.map(([k, label, Icon, key]) => (
            <button key={k} className="nav" aria-current={view === k ? "page" : undefined} onClick={() => setView(k)} title={`${label} (${key})`}>
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
          <div className="rail-spacer" />
          <button className="nav util" onClick={() => setPalette(true)} title={`Search (${modKey} K)`} aria-label="Search">
            <IconSearch size={20} /><span>Search</span>
          </button>
          <button className="nav util" onClick={toggle} title="Toggle dark mode (D)" aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={theme === "dark"}>
            {theme === "dark" ? <IconSun size={20} /> : <IconMoon size={20} />}<span>{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
        </nav>

        <main className="main">
          <div className="view-live" hidden={view !== "live"}><LiveView routes={routes} theme={theme} onHandle={onLive} visible={view === "live"} /></div>
          {view === "replay" && (replay ? <ReplayView key={scenario ?? "default"} data={replay} initial={scenario} theme={theme} onHandle={onReplay} onScenario={setScenario} />
            : <Loading err={replayErr} what="recorded scenarios" />)}
          {view === "results" && (meta ? <ResultsView meta={meta} replay={replay} onOpen={openScenario} /> : <Loading what="results" />)}
          {view === "method" && (meta ? <MethodView meta={meta} /> : <Loading what="method" />)}
        </main>

        <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />
        {view === "live" && <Tour />}
      </div>
    </ToastProvider>
  );
}

function stepDevice(h: LiveHandle | null, cur: string | null, dir: 1 | -1) {
  if (!h || !h.devices.length) return cur;
  const ids = h.devices.map((d) => d.id);
  const i = cur ? ids.indexOf(cur) : -1;
  return ids[(i + dir + ids.length) % ids.length];
}

function Loading({ err, what }: { err?: string | null; what: string }) {
  return (
    <div className="loading">
      {err ? <>Could not load the {what}. <button className="link" onClick={() => location.reload()}>Reload the page</button> to try again.</> : <><span className="spinner" aria-hidden="true" />Loading {what}…</>}
    </div>
  );
}
