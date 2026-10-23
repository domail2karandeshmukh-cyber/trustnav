"use client";

import { useMemo, useRef, useState } from "react";
import type { Frame, Osnma, Reason, Status } from "@/lib/types";
import { FEATURE_LABEL, OSNMA_INFO, STATUS_COLOR, STATUS_WORD, fmt } from "@/lib/format";

export function StatusPill({ st }: { st: Status }) {
  const c = STATUS_COLOR[st];
  return (
    <span className="pill" style={{ color: c, borderColor: `color-mix(in srgb, ${c} 55%, transparent)` }}>
      {STATUS_WORD[st].toUpperCase()}
    </span>
  );
}

/** 240-degree arc gauge for the trust score. */
export function Gauge({ frame }: { frame: Frame | null }) {
  const v = frame?.trust ?? 0;
  const st = frame?.st ?? "TRUSTED";
  const c = STATUS_COLOR[st];
  const R = 80, cx = 100, cy = 100;
  const a0 = (210 * Math.PI) / 180, span = (240 * Math.PI) / 180;
  const pt = (a: number) => [cx + R * Math.cos(a), cy - R * Math.sin(a)];
  const arc = (from: number, to: number) => {
    const [x1, y1] = pt(from); const [x2, y2] = pt(to);
    return `M ${x1} ${y1} A ${R} ${R} 0 ${from - to > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const end = a0 - span * Math.max(0.001, Math.min(1, v / 100));
  return (
    <div className="gauge-wrap">
      <div className="gauge">
        <svg viewBox="0 0 200 170" aria-hidden="true">
          <path d={arc(a0, a0 - span)} stroke="var(--panel-3)" strokeWidth="14" fill="none" strokeLinecap="round" />
          {[25, 50, 75].map((t) => { const a = a0 - span * (t / 100); const [x1, y1] = pt(a); const [x2, y2] = [cx + (R - 12) * Math.cos(a), cy - (R - 12) * Math.sin(a)];
            return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ground)" strokeWidth="3" />; })}
          {frame && <path d={arc(a0, end)} stroke={c} strokeWidth="14" fill="none" strokeLinecap="round" style={{ transition: "d .2s" }} />}
        </svg>
        <div className="gauge-num">
          <strong className="num" style={{ color: frame ? c : "var(--ink-faint)" }}>{frame ? Math.round(v) : "–"}</strong>
          <em>TRUST / 100</em>
        </div>
      </div>
      {frame ? <StatusPill st={st} /> : <span className="pill" style={{ color: "var(--ink-faint)" }}>NO DATA</span>}
    </div>
  );
}

export function RiskBars({ frame }: { frame: Frame | null }) {
  const rows: [string, number | null, string][] = [
    ["Rule risk", frame?.rr ?? null, "var(--s-rule)"],
    ["Model risk", frame?.mr ?? null, "var(--s-ml)"],
    ["Fused risk", frame?.hr ?? null, frame ? STATUS_COLOR[frame.st] : "var(--ink-faint)"],
  ];
  return (
    <div className="bars">
      {rows.map(([k, v, c]) => (
        <div className="bar-row" key={k}>
          <div className="bar-head"><span>{k}</span><span>{v == null ? "–" : fmt(v)}<span style={{ color: "var(--ink-faint)" }}>/100</span></span></div>
          <div className="track"><div className="fill" style={{ width: `${v ?? 0}%`, background: c }} /></div>
        </div>
      ))}
    </div>
  );
}

const SEV_COLOR: Record<Reason["severity"], string> = { MEDIUM: "var(--degraded)", HIGH: "var(--suspicious)", CRITICAL: "var(--untrusted)" };

export function Evidence({ frame, limit = 4 }: { frame: Frame | null; limit?: number }) {
  if (!frame) return <div className="quiet">Waiting for data.</div>;
  if (!frame.why.length) return <div className="quiet">No rule fired and the model sees nothing unusual at this fix.</div>;
  return (
    <div className="reasons">
      {frame.why.slice(0, limit).map((r) => (
        <div className="reason" key={r.code} style={{ borderLeftColor: SEV_COLOR[r.severity] }}>
          <div className="reason-top">
            <h4>{r.title}</h4>
            <span className={`sev ${r.severity}`}>{r.severity}</span>
            <span className="contrib">+{Math.round(r.contribution)}</span>
          </div>
          <p>{r.detail}</p>
          <code>{r.code}</code>
        </div>
      ))}
    </div>
  );
}

export function OsnmaPanel({ status }: { status: Osnma | null }) {
  const s = status ?? "unknown";
  const info = OSNMA_INFO[s];
  return (
    <div className="osnma">
      <svg className="shield" viewBox="0 0 42 46" aria-hidden="true">
        <path d="M21 2 L39 9 V22 C39 33 31 41 21 44 C11 41 3 33 3 22 V9 Z" fill="none" stroke={info.tone} strokeWidth="2.5" />
        {s === "verified" && <path d="M13 23 L19 29 L30 17" fill="none" stroke={info.tone} strokeWidth="3" strokeLinecap="round" />}
        {s === "failed" && <path d="M14 16 L28 30 M28 16 L14 30" stroke={info.tone} strokeWidth="3" strokeLinecap="round" />}
        {(s === "unavailable" || s === "unknown") && <path d="M21 14 V25 M21 31 V32" stroke={info.tone} strokeWidth="3" strokeLinecap="round" />}
        {s === "pending" && <circle cx="21" cy="23" r="6" fill="none" stroke={info.tone} strokeWidth="2.5" strokeDasharray="4 3" />}
      </svg>
      <div>
        <strong style={{ color: info.tone }}>{info.word}</strong>
        <p>{info.help}</p>
      </div>
    </div>
  );
}

const TELE_KEYS = [
  "route_deviation_m", "derived_speed_mps", "speed_disagreement_mps", "acceleration_mps2", "heading_rate_dps",
  "sensor_speed_mismatch_mps", "satellite_count", "cn0_mean_dbhz", "cn0_std_dbhz", "cn0_delta_dbhz", "pdop",
  "pseudorange_residual_m", "clock_drift_delta_nsps", "clock_bias_delta_ns",
];

export function Telemetry({ frame, extra }: { frame: Frame | null; extra?: [string, string][] }) {
  return (
    <div className="tele">
      {frame && (
        <div className="wide" style={{ gridColumn: "1 / -1" }}>
          <span className="k">Position</span>
          <span className="v">{frame.lat == null ? "no fix" : `${frame.lat.toFixed(5)}, ${frame.lon!.toFixed(5)}`}</span>
        </div>
      )}
      {TELE_KEYS.map((k) => {
        const [label, unit] = FEATURE_LABEL[k];
        const v = frame?.f?.[k];
        return (
          <div key={k}>
            <span className="k">{label}</span>
            <span className="v">{fmt(v as number | null, k === "satellite_count" ? 0 : 2)}{v != null && unit ? ` ${unit}` : ""}</span>
          </div>
        );
      })}
      {extra?.map(([k, v]) => (<div key={k}><span className="k">{k}</span><span className="v">{v}</span></div>))}
    </div>
  );
}

/** Trust, rule risk and model risk over time, with the alert line and attack window. */
export function TrustChart({ frames, cursor, attackStart, onSeek, height = 230 }: {
  frames: Frame[]; cursor?: number; attackStart?: number | null; onSeek?: (i: number) => void; height?: number;
}) {
  const W = 880, H = height, L = 34, Rr = 46, T = 12, B = 24;
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = frames.length;
  const x = (i: number) => L + ((W - L - Rr) * i) / Math.max(1, n - 1);
  const y = (v: number) => T + ((H - T - B) * (100 - v)) / 100;
  const paths = useMemo(() => {
    const mk = (get: (f: Frame) => number | null) => {
      let d = ""; let pen = false;
      frames.forEach((f, i) => { const v = get(f); if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
      return d;
    };
    const area = frames.length ? `M${x(0)},${y(0)} ` + frames.map((f, i) => `L${x(i).toFixed(1)},${y(f.trust).toFixed(1)}`).join(" ") + ` L${x(n - 1)},${y(0)} Z` : "";
    return { trust: mk((f) => f.trust), rule: mk((f) => f.rr), ml: mk((f) => f.mr), area };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, H]);
  const atkIdx = attackStart != null ? frames.findIndex((f) => f.s >= attackStart) : -1;
  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect(); if (!r || !n) return null;
    const px = ((clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - Rr)) * (n - 1))));
  };
  const hf = hover != null ? frames[hover] : null;
  return (
    <div className="chartbox" ref={box}
      onMouseMove={(e) => setHover(pick(e.clientX))} onMouseLeave={() => setHover(null)}
      onClick={(e) => { const i = pick(e.clientX); if (i != null) onSeek?.(i); }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trust score timeline">
        <defs>
          <linearGradient id="tfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--s-trust)" stopOpacity=".28" /><stop offset="1" stopColor="var(--s-trust)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {atkIdx >= 0 && <rect x={x(atkIdx)} y={T} width={x(n - 1) - x(atkIdx)} height={H - T - B} fill="var(--untrusted)" opacity=".06" />}
        {atkIdx >= 0 && <text x={x(atkIdx) + 5} y={T + 11} fontSize="10" fill="var(--untrusted)">attack starts (ground truth)</text>}
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - Rr} y1={y(g)} y2={y(g)} stroke={g === 50 ? "var(--ink-faint)" : "var(--edge-soft)"} strokeDasharray={g === 50 ? "4 4" : undefined} />
            <text x={L - 6} y={y(g) + 3} fontSize="10" textAnchor="end" fill="var(--ink-faint)">{g}</text>
          </g>
        ))}
        <text x={L + 4} y={y(50) - 4} fontSize="10" fill="var(--ink-faint)">alert</text>
        <path d={paths.area} fill="url(#tfill)" />
        <path d={paths.ml} stroke="var(--s-ml)" strokeWidth="1.4" fill="none" strokeDasharray="3 2" />
        <path d={paths.rule} stroke="var(--s-rule)" strokeWidth="1.4" fill="none" />
        <path d={paths.trust} stroke="var(--s-trust)" strokeWidth="2.2" fill="none" />
        {n > 0 && <>
          <text x={W - Rr + 6} y={y(frames[n - 1].trust) + 3} fontSize="10.5" fill="var(--s-trust)">Trust</text>
        </>}
        {cursor != null && cursor < n && <line x1={x(cursor)} x2={x(cursor)} y1={T} y2={H - B} stroke="var(--signal)" strokeWidth="1.5" />}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--ink-faint)" />}
        {n > 0 && [0, Math.floor(n / 2), n - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} fontSize="10" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fill="var(--ink-faint)">{frames[i].s}s</text>
        ))}
      </svg>
      {hf && (
        <div className="tip" style={{ left: `min(calc(${(x(hover!) / W) * 100}% + 10px), calc(100% - 170px))`, top: 8 }}>
          <b>t = {hf.s}s{hf.atk ? " · attacked" : ""}</b>
          <div><i style={{ background: "var(--s-trust)" }} />Trust {fmt(hf.trust)}</div>
          <div><i style={{ background: "var(--s-rule)" }} />Rules {fmt(hf.rr)}</div>
          <div><i style={{ background: "var(--s-ml)" }} />Model {fmt(hf.mr)}</div>
        </div>
      )}
      <div className="legend-inline">
        <span><i className="swatch" style={{ background: "var(--s-trust)", height: 3 }} />Trust score</span>
        <span><i className="swatch" style={{ background: "var(--s-rule)" }} />Rule risk</span>
        <span><i className="swatch" style={{ background: "var(--s-ml)" }} />Model risk</span>
        {atkIdx >= 0 && <span><i className="swatch" style={{ background: "var(--untrusted)", opacity: .5 }} />Attack window</span>}
      </div>
    </div>
  );
}

export function Sparkline({ values }: { values: number[] }) {
  const W = 200, H = 22;
  if (values.length < 2) return <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" />;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((W * i) / (values.length - 1)).toFixed(1)},${(H - 2 - ((H - 4) * v) / 100).toFixed(1)}`).join("");
  const last = values[values.length - 1];
  const c = last >= 75 ? "var(--trusted)" : last >= 50 ? "var(--degraded)" : last >= 25 ? "var(--suspicious)" : "var(--untrusted)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2={W} y1={H - 2 - (H - 4) / 2} y2={H - 2 - (H - 4) / 2} stroke="var(--edge)" strokeDasharray="3 3" />
      <path d={d} stroke={c} strokeWidth="1.6" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
