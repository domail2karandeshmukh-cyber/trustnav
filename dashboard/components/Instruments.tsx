"use client";

import { useMemo, useRef, useState } from "react";
import type { Frame, Osnma, Reason, Status } from "@/lib/types";
import { FEATURE_LABEL, OSNMA_INFO, STATUS_COLOR, STATUS_HEX, STATUS_WORD, dist, fmt, span } from "@/lib/format";

export function StatusWord({ st, strong }: { st: Status; strong?: boolean }) {
  return <span className={`stword${strong ? " strong" : ""}`} style={{ color: STATUS_COLOR[st] }}><i style={{ background: STATUS_COLOR[st] }} />{STATUS_WORD[st]}</span>;
}

export interface Bracket { start: number; end: number; label?: string; tone: "attack" | "incident" }

/**
 * The trust tape: one cell per second, coloured by trust status.
 * `slots` fixes the time axis so a live tape fills from the right.
 */
export function TrustTape({ frames, slots, first = 0, height = 10, cursor, brackets, onSeek, label }: {
  frames: Frame[]; slots: number; first?: number; height?: number; cursor?: number;
  brackets?: Bracket[]; onSeek?: (s: number) => void; label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const runs = useMemo(() => {
    // merge consecutive seconds of the same status into one rect
    const out: { x: number; w: number; c: string }[] = [];
    for (const f of frames) {
      const x = f.s - first;
      if (x < 0 || x >= slots) continue;
      const c = f.fix === false || f.lat == null ? "#8e98a8" : STATUS_HEX[f.st];
      const last = out[out.length - 1];
      if (last && last.c === c && last.x + last.w === x) last.w += 1;
      else out.push({ x, w: 1, c });
    }
    return out;
  }, [frames, slots, first]);
  const seek = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !onSeek) return;
    onSeek(Math.round(first + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (slots - 1)));
  };
  const pct = (s: number) => `${((s - first) / slots) * 100}%`;
  return (
    <div className={`tape${onSeek ? " seekable" : ""}${brackets?.some((b) => b.label) ? " labelled" : brackets?.length ? " bracketed" : ""}`} ref={box}
      onPointerDown={(e) => { if (!onSeek) return; (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(true); seek(e.clientX); }}
      onPointerMove={(e) => { if (drag) seek(e.clientX); }}
      onPointerUp={() => setDrag(false)}
      role={onSeek ? "slider" : "img"}
      aria-label={label ?? "Trust over time"}
      aria-valuemin={onSeek ? first : undefined} aria-valuemax={onSeek ? first + slots - 1 : undefined} aria-valuenow={onSeek ? cursor : undefined}
      tabIndex={onSeek ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onSeek || cursor == null) return;
        if (e.key === "ArrowRight") onSeek(Math.min(first + slots - 1, cursor + (e.shiftKey ? 10 : 1)));
        if (e.key === "ArrowLeft") onSeek(Math.max(first, cursor - (e.shiftKey ? 10 : 1)));
      }}>
      <div className="tape-bar">
        {brackets?.map((b, i) => (
          <span key={i} className={`bracket ${b.tone}`} style={{ left: pct(b.start), width: `calc(${pct(Math.min(b.end, first + slots - 1) + 1)} - ${pct(b.start)})` }}>
            {b.label && <em>{b.label}</em>}
          </span>
        ))}
        <svg viewBox={`0 0 ${slots} 1`} preserveAspectRatio="none" style={{ height }} shapeRendering="crispEdges">
          <rect x="0" y="0" width={slots} height="1" style={{ fill: "var(--tape-empty)" }} />
          {runs.map((r) => <rect key={r.x} x={r.x} y="0" width={r.w + 0.02} height="1" fill={r.c} />)}
        </svg>
        {cursor != null && <span className="tape-cursor" style={{ left: `calc(${pct(cursor)} + ${50 / slots}%)` }} />}
      </div>
    </div>
  );
}

/** The big number: trust now, with the status in words. */
export function TrustFigure({ frame, since }: { frame: Frame | null; since?: string | null }) {
  if (!frame) return <div className="figure"><strong className="num" style={{ color: "var(--ink-3)" }}>–</strong><div className="figure-side"><span className="quiet">Waiting for the first fix</span></div></div>;
  return (
    <div className="figure">
      <strong className="num" style={{ color: STATUS_COLOR[frame.st] }}>{Math.round(frame.trust)}</strong>
      <div className="figure-side">
        <StatusWord st={frame.st} strong />
        <span className="figure-sub">{since ?? "Trust score out of 100"}</span>
      </div>
      <dl className="risks">
        <div><dt>Rules</dt><dd className="num">{fmt(frame.rr, 0)}</dd></div>
        <div><dt>Model</dt><dd className="num">{frame.mr == null ? "–" : fmt(frame.mr, 0)}</dd></div>
        <div><dt>Combined risk</dt><dd className="num">{fmt(frame.hr, 0)}</dd></div>
      </dl>
    </div>
  );
}

const SEV_COLOR: Record<Reason["severity"], string> = { MEDIUM: "var(--degraded)", HIGH: "var(--suspicious)", CRITICAL: "var(--untrusted)" };
const SEV_WORD: Record<Reason["severity"], string> = { MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

export function Evidence({ frame, limit = 4 }: { frame: Frame | null; limit?: number }) {
  if (!frame) return <p className="quiet">Waiting for data.</p>;
  if (!frame.why.length) return <p className="quiet">Nothing unusual. No rule has fired and the model sees normal behaviour.</p>;
  return (
    <ol className="reasons">
      {frame.why.slice(0, limit).map((r) => (
        <li key={r.code} style={{ borderColor: SEV_COLOR[r.severity] }}>
          <div className="reason-top">
            <h4>{r.title}</h4>
            <span className="sev" style={{ color: SEV_COLOR[r.severity] }}>{SEV_WORD[r.severity]}</span>
            <span className="contrib num" title="Risk added by this evidence">+{Math.round(r.contribution)}</span>
          </div>
          <p>{r.detail}</p>
        </li>
      ))}
    </ol>
  );
}

export function OsnmaLine({ status }: { status: Osnma | null }) {
  const s = status ?? "unknown";
  const info = OSNMA_INFO[s];
  return (
    <div className="osnma">
      <svg width="26" height="28" viewBox="0 0 42 46" aria-hidden="true">
        <path d="M21 2 L39 9 V22 C39 33 31 41 21 44 C11 41 3 33 3 22 V9 Z" fill="none" stroke={info.tone} strokeWidth="3" />
        {s === "verified" && <path d="M13 23 L19 29 L30 17" fill="none" stroke={info.tone} strokeWidth="3.4" strokeLinecap="round" />}
        {s === "failed" && <path d="M14 16 L28 30 M28 16 L14 30" stroke={info.tone} strokeWidth="3.4" strokeLinecap="round" />}
        {(s === "unavailable" || s === "unknown") && <path d="M21 14 V25 M21 31 V32" stroke={info.tone} strokeWidth="3.4" strokeLinecap="round" />}
        {s === "pending" && <circle cx="21" cy="23" r="6" fill="none" stroke={info.tone} strokeWidth="3" strokeDasharray="4 3" />}
      </svg>
      <div>
        <b>Galileo authentication <span style={{ color: info.tone }}>{info.word.toLowerCase()}</span></b>
        <p>{info.help}</p>
      </div>
    </div>
  );
}

const GROUPS: [string, string[]][] = [
  ["Motion", ["route_deviation_m", "derived_speed_mps", "speed_disagreement_mps", "acceleration_mps2", "heading_rate_dps", "sensor_speed_mismatch_mps"]],
  ["Signal", ["satellite_count", "cn0_mean_dbhz", "cn0_std_dbhz", "cn0_delta_dbhz", "pdop", "pseudorange_residual_m"]],
  ["Receiver clock", ["clock_drift_delta_nsps", "clock_bias_delta_ns"]],
];

export function Signals({ frame, extra }: { frame: Frame | null; extra?: [string, string][] }) {
  return (
    <div className="signals">
      {frame && (
        <dl>
          <div><dt>Position</dt><dd className="num">{frame.lat == null ? "No fix" : `${frame.lat.toFixed(5)}, ${frame.lon!.toFixed(5)}`}</dd></div>
          {extra?.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {GROUPS.map(([g, keys]) => (
        <section key={g}>
          <h5>{g}</h5>
          <dl>
            {keys.map((k) => {
              const [label, unit] = FEATURE_LABEL[k];
              const v = frame?.f?.[k];
              return <div key={k}><dt>{label}</dt><dd className="num">{fmt(v as number | null, k === "satellite_count" ? 0 : 1)}{v != null && unit ? <small> {unit}</small> : null}</dd></div>;
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** Trust, rule risk and model risk over time. */
export function TrustChart({ frames, slots, first = 0, cursor, attack, onSeek, height = 120 }: {
  frames: Frame[]; slots?: number; first?: number; cursor?: number; attack?: [number, number] | null; onSeek?: (s: number) => void; height?: number;
}) {
  const n = slots ?? Math.max(1, frames.length);
  const W = 1000, H = height, T = 6, B = 6;
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const x = (s: number) => ((s - first + 0.5) / n) * W;
  const y = (v: number) => T + ((H - T - B) * (100 - v)) / 100;
  const paths = useMemo(() => {
    const mk = (get: (f: Frame) => number | null) => {
      let d = ""; let pen = false; let prev = -2;
      for (const f of frames) {
        const v = get(f);
        if (v == null || f.s !== prev + 1) pen = false;
        prev = f.s;
        if (v == null) continue;
        d += `${pen ? "L" : "M"}${x(f.s).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
      }
      return d;
    };
    return { trust: mk((f) => f.trust), rule: mk((f) => f.rr), ml: mk((f) => f.mr) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, n, first, H]);
  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect(); if (!r) return null;
    return Math.round(first + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (n - 1));
  };
  const hf = hover != null ? frames.find((f) => f.s === hover) : null;
  return (
    <div className="chart" ref={box}
      onMouseMove={(e) => setHover(pick(e.clientX))} onMouseLeave={() => setHover(null)}
      onClick={(e) => { const s = pick(e.clientX); if (s != null) onSeek?.(s); }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }} role="img" aria-label="Trust score and risk over time">
        {attack && <rect x={x(attack[0]) - W / n / 2} y={0} width={Math.max(0, x(Math.min(attack[1], first + n - 1)) - x(attack[0]) + W / n)} height={H} fill="var(--untrusted)" opacity=".07" />}
        {[75, 50, 25].map((g) => <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke={g === 50 ? "var(--ink-3)" : "var(--line-soft)"} strokeDasharray={g === 50 ? "5 4" : undefined} vectorEffect="non-scaling-stroke" />)}
        <path d={paths.ml} stroke="var(--s-ml)" strokeWidth="1.3" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={paths.rule} stroke="var(--s-rule)" strokeWidth="1.3" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={paths.trust} stroke="var(--ink)" strokeWidth="2.2" fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {cursor != null && <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={H} stroke="var(--chart)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--ink-3)" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="chart-axis" style={{ top: `${(y(50) / H) * 100}%` }}>alert line</span>
      {hf && (
        <div className="tip" style={{ left: `min(calc(${(x(hf.s) / W) * 100}% + 12px), calc(100% - 150px))` }}>
          <b>{hf.s} s{hf.atk ? ", under attack" : ""}</b>
          <div><i style={{ background: "var(--ink)" }} />Trust <span className="num">{fmt(hf.trust, 0)}</span></div>
          <div><i style={{ background: "var(--s-rule)" }} />Rule risk <span className="num">{fmt(hf.rr, 0)}</span></div>
          <div><i style={{ background: "var(--s-ml)" }} />Model risk <span className="num">{fmt(hf.mr, 0)}</span></div>
        </div>
      )}
    </div>
  );
}

export function ChartKey({ attack }: { attack?: boolean }) {
  return (
    <div className="chart-key">
      <span><i style={{ background: "var(--ink)", height: 3 }} />Trust</span>
      <span><i style={{ background: "var(--s-rule)" }} />Rule risk</span>
      <span><i style={{ background: "var(--s-ml)" }} />Model risk</span>
      {attack && <span><i style={{ background: "var(--untrusted)", opacity: 0.25, height: 9 }} />Attack, ground truth</span>}
    </div>
  );
}

export const ACTION_INFO = {
  CONTINUE: { word: "position accepted", tone: "var(--trusted)" },
  VERIFY: { word: "position held", tone: "var(--suspicious)" },
  ISOLATE: { word: "isolated", tone: "var(--untrusted)" },
} as const;

/**
 * The response layer's verdict for this second: what the fleet software is
 * handed, and what the operator should do. Sits next to the OSNMA line.
 */
export function ResponseLine({ frame, kind = "vehicle" }: { frame: Frame | null; kind?: "vehicle" | "drone" }) {
  const r = frame?.resp;
  if (!r) return null;
  const info = ACTION_INFO[r.action];
  const src = r.source === "route_odometer" ? "along the planned route from the odometer" : r.source === "heading_odometer" ? "on the last trusted heading from the odometer" : "";
  let help: string;
  if (r.mode === "accept") {
    help = r.rejoined_after_s != null
      ? `Back on GNSS after ${span(r.rejoined_after_s)} on hold. The returning fix was ${dist(r.gap_m ?? 0)} from the estimate.`
      : "The fix passes to the fleet software unchanged.";
  } else if (r.mode === "none") {
    help = "No trusted fix yet to estimate from.";
  } else {
    const lie = r.gap_m != null ? ` The reported fix is ${dist(r.gap_m)} from the estimate and is not passed on.` : " The receiver has no fix; the estimate fills the gap.";
    const act = r.action === "ISOLATE"
      ? (kind === "drone" ? " Hold or return on inertial navigation; do not follow GNSS." : " Contact the driver. Dispatch, geofences and billing must not use this device's position.")
      : " Confirm by other means (driver, camera, odometer) before acting on it.";
    help = `Rejected for ${span(r.held_s)}. Position estimated ${src}.${lie}${act}`;
  }
  return (
    <div className="osnma resp" data-action={r.action}>
      <svg width="26" height="28" viewBox="0 0 42 46" aria-hidden="true">
        <path d="M21 2 L39 9 V22 C39 33 31 41 21 44 C11 41 3 33 3 22 V9 Z" fill={r.mode === "hold" ? info.tone : "none"} fillOpacity="0.18" stroke={info.tone} strokeWidth="3" />
        {r.action === "CONTINUE" && <path d="M13 23 L19 29 L30 17" fill="none" stroke={info.tone} strokeWidth="3.4" strokeLinecap="round" />}
        {r.action === "VERIFY" && <path d="M16 15 V31 M26 15 V31" stroke={info.tone} strokeWidth="3.6" strokeLinecap="round" />}
        {r.action === "ISOLATE" && <rect x="14" y="16" width="14" height="14" rx="2" fill={info.tone} />}
      </svg>
      <div>
        <b>Response: <span style={{ color: info.tone }}>{info.word}</span></b>
        <p>{help}</p>
      </div>
    </div>
  );
}
