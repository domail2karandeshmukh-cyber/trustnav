"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "./MapView";
import { Evidence, Gauge, OsnmaPanel, RiskBars, Telemetry, TrustChart } from "./Instruments";
import type { ReplayData } from "@/lib/types";
import { ATTACK_WORD, fmt } from "@/lib/format";

export default function ReplayTab({ data, initial }: { data: ReplayData; initial?: string }) {
  const [slug, setSlug] = useState(initial ?? data.scenarios[2]?.slug ?? data.scenarios[0].slug);
  const sc = data.scenarios.find((s) => s.slug === slug) ?? data.scenarios[0];
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(4);
  const [showTruth, setShowTruth] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // open each scenario just before the attack, where the story starts
    const start = sc.attack_start != null ? Math.max(0, sc.attack_start - 15) : 0;
    setI(start);
    setPlaying(false);
  }, [slug, sc.attack_start]);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setI((v) => {
        if (v >= sc.frames.length - 1) { setPlaying(false); return v; }
        return v + 1;
      });
    }, 1000 / rate);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, rate, sc.frames.length]);

  const frame = sc.frames[Math.min(i, sc.frames.length - 1)];
  const route = data.routes[sc.route];
  const shown = useMemo(() => sc.frames.slice(0, i + 1), [sc, i]);
  // where the device really was (simulator ground truth); a spoof pulls the reported track away from it
  const truth = useMemo(() => shown.filter((f) => f.tl).map((f) => f.tl as [number, number]), [shown]);
  const inc = data.incidents.filter((x) => x.scenario === sc.slug);

  return (
    <>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="pad" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label className="mono" style={{ fontSize: 10, letterSpacing: ".1em", color: "var(--ink-faint)" }} htmlFor="scen">SCENARIO</label>
          <select id="scen" className="select" value={slug} onChange={(e) => setSlug(e.target.value)} style={{ flex: "1 1 280px" }}>
            {data.scenarios.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
          </select>
          <span className="chip">{ATTACK_WORD[sc.attack] ?? sc.attack}</span>
          <span className="chip">{sc.profile === "small_uav" ? "Drone" : "Road vehicle"}</span>
          <span className="chip">min trust {fmt(sc.min_trust)}</span>
        </div>
        <p style={{ margin: 0, padding: "0 16px 14px", color: "var(--ink-dim)", fontSize: 13.5 }}>{sc.description}</p>
      </div>

      <div className="grid-main">
        <div className="col">
          <div className="panel">
            <MapView
              fitKey={sc.slug}
              routes={route ? [{ id: route.slug, points: route.points }] : []}
              tracks={[{ id: sc.slug, frames: shown }]}
              truth={showTruth ? truth : undefined}
              markers={frame?.lat != null ? [{ id: sc.device_id, label: sc.device_id, lat: frame.lat, lon: frame.lon!, status: frame.st, kind: sc.profile === "small_uav" ? "drone" : "vehicle", alarm: frame.trust < 50, selected: true }] : []}
              note={frame?.fix === false ? "No position fix" : undefined}
            />
            <div className="map-legend">
              <span><i className="swatch" style={{ background: "var(--trusted)" }} />Trusted</span>
              <span><i className="swatch" style={{ background: "var(--degraded)" }} />Degraded</span>
              <span><i className="swatch" style={{ background: "var(--suspicious)" }} />Suspicious</span>
              <span><i className="swatch" style={{ background: "var(--untrusted)" }} />Untrusted</span>
              <span><i className="swatch dash" />Expected route</span>
              <span><button className="btn sm" aria-pressed={showTruth} onClick={() => setShowTruth((v) => !v)} style={{ padding: "1px 7px" }}>
                <i className="swatch truth" style={{ display: "inline-block", marginRight: 6, verticalAlign: "middle" }} />True position</button></span>
            </div>
          </div>

          <div className="panel transport">
            <button className="btn primary" onClick={() => { if (i >= sc.frames.length - 1) setI(0); setPlaying((p) => !p); }} aria-pressed={playing}>
              {playing ? "Pause" : "Play"}
            </button>
            <button className="btn" onClick={() => { setPlaying(false); setI(0); }}>Reset</button>
            {[1, 4, 16].map((r) => <button key={r} className="btn sm" aria-pressed={rate === r} onClick={() => setRate(r)}>{r}×</button>)}
            <input type="range" min={0} max={sc.frames.length - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} aria-label="Replay position" />
            <span className="seq">{frame.s}s / {sc.frames.length - 1}s</span>
          </div>

          <div className="panel">
            <div className="ptitle">Trust score timeline <span>click to jump</span></div>
            <TrustChart frames={sc.frames} cursor={i} attackStart={sc.attack_start} onSeek={(v) => { setPlaying(false); setI(v); }} />
          </div>
        </div>

        <div className="col">
          <div className="panel">
            <div className="ptitle">Navigation trust</div>
            <Gauge frame={frame} />
            <RiskBars frame={frame} />
          </div>
          <div className="panel">
            <div className="ptitle">Evidence at this fix</div>
            <Evidence frame={frame} />
          </div>
          <div className="panel">
            <div className="ptitle">Galileo authentication (OSNMA)</div>
            <OsnmaPanel status={frame.osnma} />
          </div>
          <div className="panel tele-panel">
            <div className="ptitle">Current observation</div>
            <Telemetry frame={frame} extra={[["Ground truth", frame.atk ? "attacked" : "clean"], ["Incidents in run", String(inc.length)]]} />
          </div>
        </div>
      </div>
    </>
  );
}
