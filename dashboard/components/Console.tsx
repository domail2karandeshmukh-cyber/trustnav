"use client";

import { useEffect, useState } from "react";
import LiveView from "./LiveView";
import ReplayView from "./ReplayView";
import ResultsView from "./ResultsView";
import MethodView from "./MethodView";
import { IconLive, IconMethod, IconReplay, IconResults, Wordmark } from "./Icons";
import type { ReplayData, RouteGeom } from "@/lib/types";

type View = "live" | "replay" | "results" | "method";
type Meta = Omit<ReplayData, "scenarios" | "routes"> & { scenarios: Omit<ReplayData["scenarios"][number], "frames">[] };

const NAV: [View, string, typeof IconLive][] = [
  ["live", "Live", IconLive],
  ["replay", "Replay", IconReplay],
  ["results", "Results", IconResults],
  ["method", "Method", IconMethod],
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

  useEffect(() => {
    getJSON<Meta>("/data/meta.json").then(setMeta).catch(() => {});
    getJSON<Record<string, RouteGeom>>("/data/routes.json").then(setRoutes).catch(() => {});
    const h = window.location.hash.slice(1);
    const v = (ALIAS[h] ?? h) as View;
    if (NAV.some(([k]) => k === v)) setView(v);
  }, []);

  useEffect(() => {
    if ((view === "replay" || view === "results") && !replay && !replayErr) {
      getJSON<ReplayData>("/data/replay.json").then(setReplay).catch((e) => setReplayErr(String(e)));
    }
    history.replaceState(null, "", `#${view}`);
  }, [view, replay, replayErr]);

  const openScenario = (slug: string) => { setScenario(slug); setView("replay"); };

  return (
    <div className="app" data-view={view}>
      <nav className="rail" aria-label="Views">
        <a className="brand" href="#live" onClick={(e) => { e.preventDefault(); setView("live"); }} aria-label="TrustNav, live view">
          <Wordmark />
          <span>TrustNav</span>
        </a>
        {NAV.map(([k, label, Icon]) => (
          <button key={k} className="nav" aria-current={view === k ? "page" : undefined} onClick={() => setView(k)}>
            <Icon size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <main className="main">
        <div className="view-live" hidden={view !== "live"}><LiveView routes={routes} /></div>
        {view === "replay" && (replay ? <ReplayView key={scenario ?? "default"} data={replay} initial={scenario} />
          : <Loading err={replayErr} what="recorded scenarios" />)}
        {view === "results" && (meta ? <ResultsView meta={meta} replay={replay} onOpen={openScenario} /> : <Loading what="results" />)}
        {view === "method" && (meta ? <MethodView meta={meta} /> : <Loading what="method" />)}
      </main>
    </div>
  );
}

function Loading({ err, what }: { err?: string | null; what: string }) {
  return <div className="loading">{err ? `Could not load the ${what}. Reload the page to try again.` : `Loading ${what}…`}</div>;
}
