"use client";

import { useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import { ChartKey, Evidence, OsnmaLine, Signals, TrustChart, TrustFigure, TrustTape, type Bracket } from "./Instruments";
import { DroneGlyph, IconBack, IconPause, IconPlay, VehicleGlyph } from "./Icons";
import type { Frame, ReplayData, Scenario } from "@/lib/types";
import { ATTACK_WORD, STATUS_COLOR, mmss, span } from "@/lib/format";
import { useWide } from "@/lib/useWide";

function splitName(n: string): [string, string] {
  const i = n.indexOf(":");
  return i < 0 ? [n, ""] : [n.slice(0, i), n.slice(i + 1).trim()];
}

function attackWindow(sc: Scenario): [number, number] | null {
  const hit = sc.frames.filter((f) => f.atk);
  return hit.length ? [hit[0].s, hit[hit.length - 1].s] : null;
}

function meters(a: [number, number], b: [number, number]) {
  const k = Math.PI / 180;
  const x = (b[1] - a[1]) * k * Math.cos(((a[0] + b[0]) / 2) * k);
  return Math.hypot(x, (b[0] - a[0]) * k) * 6371000;
}

export default function ReplayView({ data, initial }: { data: ReplayData; initial?: string }) {
  const wide = useWide();
  const [slug, setSlug] = useState<string | null>(initial ?? "teleport_spoof");
  const [listOpen, setListOpen] = useState(false);
  const sc = data.scenarios.find((s) => s.slug === slug) ?? data.scenarios[0];
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(4);
  const [showTruth, setShowTruth] = useState(true);
  const win = useMemo(() => attackWindow(sc), [sc]);
  const result = data.experiments.hybrid.per_scenario.find((p) => p.scenario === sc.slug);

  useEffect(() => {
    setI(sc.attack_start != null ? Math.max(0, sc.attack_start - 12) : 0);
    setPlaying(false);
  }, [sc]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setI((v) => {
      if (v >= sc.frames.length - 1) { setPlaying(false); return v; }
      return v + 1;
    }), 1000 / rate);
    return () => clearInterval(t);
  }, [playing, rate, sc.frames.length]);

  const frame = sc.frames[Math.min(i, sc.frames.length - 1)];
  const route = data.routes[sc.route];
  const shown = useMemo(() => sc.frames.slice(0, i + 1), [sc, i]);
  const truth = useMemo(() => (showTruth && win ? shown.filter((f) => f.s >= win[0] && f.tl).map((f) => f.tl as [number, number]) : undefined), [shown, showTruth, win]);
  const ghost = useMemo(() => {
    if (!showTruth || !frame?.tl || frame.lat == null || !frame.atk) return null;
    const rep: [number, number] = [frame.lat, frame.lon!];
    return meters(rep, frame.tl) > 25 ? { lat: frame.tl[0], lon: frame.tl[1], from: rep } : null;
  }, [frame, showTruth]);
  const offBy = frame?.tl && frame.lat != null ? meters([frame.lat, frame.lon!], frame.tl) : null;
  const incidents = data.incidents.filter((x) => x.scenario === sc.slug);
  // the honest part of the run: where the platform really went
  const extent = useMemo(() => sc.frames.filter((f) => f.tl).map((f) => f.tl as [number, number]), [sc]);
  const brackets: Bracket[] = [
    ...(win ? [{ start: win[0], end: win[1], tone: "attack" as const, label: "Attack" }] : []),
    ...incidents.map((x) => ({ start: x.start, end: x.end, tone: "incident" as const, label: "Incident" })),
  ];
  const seek = (s: number) => { setPlaying(false); setI(Math.max(0, Math.min(sc.frames.length - 1, s))); };
  const [title, sub] = splitName(sc.name);
  const glyph = sc.profile === "small_uav" ? <DroneGlyph size={20} /> : <VehicleGlyph size={20} />;

  return (
    <div className="workspace replay">
      <aside className="panel" aria-label="Recorded scenarios">
        {listOpen ? (
          <>
            <header className="panel-head"><h1>Recorded scenarios</h1></header>
            <ul className="rows">
              {data.scenarios.map((s) => <ScenarioRow key={s.slug} s={s} data={data} onPick={() => { setSlug(s.slug); setListOpen(false); }} />)}
            </ul>
            <p className="panel-foot">Held-out routes the model never trained on. Each strip is the whole run; the bracket marks when the simulated attack was active.</p>
          </>
        ) : (
          <div className="detail">
            <header className="detail-head">
              <button className="iconbtn" onClick={() => { setPlaying(false); setListOpen(true); }} aria-label="All scenarios"><IconBack /></button>
              <div>
                <h1>{title}</h1>
                <p>{sub || ATTACK_WORD[sc.attack]}</p>
              </div>
            </header>
            <p className="lede">{sc.description}</p>
            <p className="verdict">
              {win ? (result?.detection_latency_obs != null
                ? (result.detection_latency_obs === 0 ? <>Caught <b>in the same second</b> the attack began.</> : <>Caught <b>{span(result.detection_latency_obs)}</b> after the attack began.</>)
                : <>Not caught by the combined score.</>)
                : <>Normal run: <b>{result?.false_alerts ? `${result.false_alerts} false alerts` : "no false alerts"}</b>.</>}
            </p>
            <TrustFigure frame={frame} since={offBy != null && frame.atk ? `Reported position is ${offBy >= 1000 ? `${(offBy / 1000).toFixed(1)} km` : `${Math.round(offBy)} m`} from the real one` : `${mmss(frame.s)} into the run`} />
            <section className="panel-sec">
              <h2>Why</h2>
              <Evidence frame={frame} />
            </section>
            <section className="panel-sec"><OsnmaLine status={frame.osnma} /></section>
            <section className="panel-sec">
              <h2>Measurements</h2>
              <Signals frame={frame} extra={[["Simulator truth", frame.atk ? "Under attack" : "Clean"]]} />
            </section>
          </div>
        )}
      </aside>

      <section className="stage-map">
        <MapView fitKey={`${sc.slug}${offBy != null && offBy > 1500 ? ":far" : ""}`} routes={route ? [{ id: route.slug, points: route.points }] : []}
          tracks={[{ id: sc.slug, frames: shown }]} truth={truth} ghost={ghost} extent={extent}
          markers={frame?.lat != null ? [{ id: sc.device_id, label: sc.device_id, lat: frame.lat, lon: frame.lon!, status: frame.st, heading: frame.hdg, kind: sc.profile === "small_uav" ? "drone" : "vehicle", alarm: frame.trust < 50, selected: true }] : []}
          note={frame?.fix === false ? "No position fix" : undefined}
          padding={wide ? { top: 80, right: 60, bottom: 40, left: 40 } : { top: 76, right: 24, bottom: 24, left: 24 }} />
        <div className="float legend">
          <span className="legend-glyph" style={{ color: STATUS_COLOR[frame.st] }}>{glyph}</span>
          <span>Reported track, coloured by trust</span>
          <span><i className="dash route" />Planned route</span>
          {win && <label className="check"><input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} /><i className="dash truth" />Real path</label>}
        </div>
      </section>

      <section className="dock" aria-label="Replay controls">
        <div className="dock-bar">
          <button className="play" onClick={() => { if (i >= sc.frames.length - 1) setI(0); setPlaying((p) => !p); }} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
          </button>
          <span className="num dock-time">{mmss(frame.s)} <span>/ {mmss(sc.frames.length - 1)}</span></span>
          <div className="seg" role="group" aria-label="Playback speed">
            {[1, 4, 16].map((r) => <button key={r} aria-pressed={rate === r} onClick={() => setRate(r)}>{r}×</button>)}
          </div>
          <span className="dock-hint">Drag the strip to scrub. Arrow keys step one second.</span>
        </div>
        <TrustTape frames={sc.frames} slots={sc.frames.length} height={16} cursor={frame.s} brackets={brackets} onSeek={seek} label="Replay position" />
        <TrustChart frames={sc.frames} cursor={frame.s} attack={win} onSeek={seek} height={wide ? 74 : 60} />
        <ChartKey attack={!!win} />
      </section>
    </div>
  );
}

function ScenarioRow({ s, data, onPick }: { s: Scenario; data: ReplayData; onPick: () => void }) {
  const p = data.experiments.hybrid.per_scenario.find((x) => x.scenario === s.slug);
  const win = attackWindow(s);
  const [title, sub] = splitName(s.name);
  const verdict = win ? (p?.detection_latency_obs != null ? (p.detection_latency_obs === 0 ? "Caught at once" : `Caught in ${span(p.detection_latency_obs)}`) : "Missed") : p?.false_alerts ? `${p.false_alerts} false alerts` : "No false alerts";
  const worst = s.frames.reduce((m: Frame, f) => (f.trust < m.trust ? f : m), s.frames[0]);
  return (
    <li>
      <button className="row" onClick={onPick}>
        <span className="row-glyph" style={{ color: STATUS_COLOR[worst.st] }}>{s.profile === "small_uav" ? <DroneGlyph size={20} /> : <VehicleGlyph size={20} />}</span>
        <span className="row-main">
          <span className="row-name">{title}</span>
          <span className="row-sub">{sub || ATTACK_WORD[s.attack]}</span>
        </span>
        <span className="row-right"><span className={`verdict-tag${!win && !p?.false_alerts ? " clean" : ""}`}>{verdict}</span></span>
        <span className="row-tape">
          <TrustTape frames={s.frames} slots={s.frames.length} height={8} brackets={win ? [{ start: win[0], end: win[1], tone: "attack" }] : undefined} />
        </span>
      </button>
    </li>
  );
}
