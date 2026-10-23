"use client";

import { useCallback, useEffect, useState } from "react";
import FleetTab from "./FleetTab";
import ReplayTab from "./ReplayTab";
import EvalTab from "./EvalTab";
import MethodTab from "./MethodTab";
import type { Incident, ReplayData, RouteGeom } from "@/lib/types";
import { ATTACK_WORD, fmt } from "@/lib/format";

type Tab = "fleet" | "replay" | "incidents" | "eval" | "method";
type Meta = Omit<ReplayData, "scenarios" | "routes"> & { scenarios: Omit<ReplayData["scenarios"][number], "frames">[] };

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export default function Console() {
  const [tab, setTab] = useState<Tab>("fleet");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [routes, setRoutes] = useState<Record<string, RouteGeom> | null>(null);
  const [replay, setReplay] = useState<ReplayData | null>(null);
  const [replayErr, setReplayErr] = useState<string | null>(null);
  const [replayAt, setReplayAt] = useState<string | undefined>();
  const [liveOpen, setLiveOpen] = useState(0);

  useEffect(() => {
    getJSON<Meta>("/data/meta.json").then(setMeta).catch(() => {});
    getJSON<Record<string, RouteGeom>>("/data/routes.json").then(setRoutes).catch(() => {});
    const h = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (["fleet", "replay", "incidents", "eval", "method"].includes(h)) setTab(h as Tab);
  }, []);

  useEffect(() => {
    if ((tab === "replay" || tab === "incidents") && !replay && !replayErr) {
      getJSON<ReplayData>("/data/replay.json").then(setReplay).catch((e) => setReplayErr(String(e)));
    }
    if (typeof window !== "undefined") history.replaceState(null, "", `#${tab}`);
  }, [tab, replay, replayErr]);

  const onLiveIncidents = useCallback((list: Incident[]) => setLiveOpen(list.filter((x) => x.status === "OPEN").length), []);

  const tabs: [Tab, string][] = [["fleet", "Live fleet"], ["replay", "Replay"], ["incidents", "Recorded incidents"], ["eval", "Evaluation"], ["method", "Method"]];

  return (
    <>
      <header className="bar">
        <div className="bar-in">
          <div className="brand"><span className="dot" aria-hidden="true" /><span>TRUST<b>NAV</b></span><small>GNSS trust monitoring</small></div>
          <span className="chip hide-sm">engine v{meta?.engine_version ?? "2"}</span>
          {meta && <span className="chip hide-sm" title="Anomaly model version">{meta.model.model_version}</span>}
          <span className="chip warn" title="All attacks are simulated in software">synthetic data</span>
        </div>
      </header>
      <main className="wrap">
        <nav className="tabs" role="tablist" aria-label="Views">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}{k === "fleet" && liveOpen > 0 && <span className="count">{liveOpen}</span>}
            </button>
          ))}
        </nav>

        <div hidden={tab !== "fleet"}><FleetTab routes={routes} onIncidents={onLiveIncidents} /></div>

        {tab === "replay" && (replay ? <ReplayTab key={replayAt ?? "default"} data={replay} initial={replayAt} />
          : replayErr ? <div className="panel err">Could not load recorded scenarios: {replayErr}</div>
          : <div className="skeleton" style={{ height: 520 }} aria-label="Loading scenarios" />)}

        {tab === "incidents" && (
          <div className="panel">
            <div className="ptitle">Incidents from the held-out scenarios <span>{meta?.incidents.length ?? ""}</span></div>
            {!meta ? <div className="quiet">Loading…</div> : (
              <div className="inc-list">
                {meta.incidents.map((x) => {
                  const sc = meta.scenarios.find((s) => s.slug === x.scenario);
                  return (
                    <button className="inc" key={`${x.scenario}-${x.start}`} onClick={() => { setReplayAt(x.scenario ?? undefined); setTab("replay"); }}>
                      <div className="inc-tags">
                        <span className={`sev ${x.severity}`}>{x.severity}</span>
                        <span className="chip">{x.device_id}</span>
                        <span className="chip">{ATTACK_WORD[sc?.attack ?? "none"]}</span>
                        <span className="chip" style={{ color: x.status === "OPEN" ? "var(--untrusted)" : "var(--trusted)" }}>{x.status === "OPEN" ? "OPEN AT END" : "RESOLVED"}</span>
                      </div>
                      <h4>{x.title}</h4>
                      <div className="inc-meta">
                        <span>scenario <b>{sc?.name ?? x.scenario}</b></span>
                        <span>t = <b>{x.start}–{x.end} s</b></span>
                        <span>min trust <b>{fmt(x.min_trust)}</b></span>
                        <span>evidence <b>{x.evidence.slice(0, 3).map((e) => e.title).join(", ")}</b></span>
                      </div>
                    </button>
                  );
                })}
                {meta.incidents.length === 0 && <div className="quiet">No incidents.</div>}
                <p style={{ margin: 0, color: "var(--ink-faint)", fontSize: 12 }}>Normal drives and the normal drone survey produced no incident. Click an incident to replay it.</p>
              </div>
            )}
          </div>
        )}

        {tab === "eval" && (meta ? <EvalTab meta={meta} /> : <div className="skeleton" style={{ height: 420 }} />)}
        {tab === "method" && (meta ? <MethodTab meta={meta} /> : <div className="skeleton" style={{ height: 420 }} />)}

        <footer className="foot">
          <p>Research prototype by Karan Deshmukh, MSc Cybersecurity &amp; Data Science, ESAIP Angers. All hostile scenarios are simulated in software: no radio signal is transmitted, jammed or spoofed. The trust score is a research indicator, not a certified integrity figure, and is not for safety-critical use.</p>
          <p>Map data © OpenStreetMap contributors, basemap © CARTO. Routes computed with OSRM.</p>
        </footer>
      </main>
    </>
  );
}
