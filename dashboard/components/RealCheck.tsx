"use client";

import { useEffect, useState } from "react";
import { dist, span } from "@/lib/format";

interface Stats { alert_seconds: number; min_trust?: number }
interface Side { first_alert_delay_s: number | null; raw_max_error_m: number; protected_max_error_m: number; raw_blank_s: number; protected_blank_s: number }
interface RealData {
  epochs: number; duration_min: number;
  whole_drive_rules_only: Stats; whole_drive_simulator_model: Stats; whole_drive_cn0_sats_baseline: Stats;
  recalibrated: { fit_seconds: number; calibration_seconds: number; test_seconds: number; test_no_attack: Stats };
  overlays: { runs: { kind: "teleport" | "drift" | "jam"; rules: Side; hybrid: Side }[] };
  track?: { points: [number, number, 0 | 1 | 2][]; overlay_start: [number, number] | null } | null;
}

const SEG = [["Fit", "var(--chart)"], ["Calibration", "var(--s-ml)"], ["Test, with attacks overlaid", "var(--trusted)"]] as const;
const ATTACK: Record<string, [string, string]> = {
  teleport: ["Teleport", "the fix jumps 8 km east"],
  drift: ["Slow drift", "0.7 m/s away from the road"],
  jam: ["Jamming", "signal drops, then no fix"],
};

function Track({ track }: { track: NonNullable<RealData["track"]> }) {
  const W = 620, H = 380, pad = 26;
  const xs = track.points.map((p) => p[0]), ys = track.points.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0));
  const ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
  const P = (p: number[]) => [ox + (p[0] - x0) * k, H - oy - (p[1] - y0) * k];
  const paths = [0, 1, 2].map((s) => {
    let d = "", open = false;
    track.points.forEach((p, i) => {
      const prev = track.points[i - 1];
      const mine = p[2] === s, joins = prev && prev[2] === s && p[2] !== s;   // draw into the first point of the next segment
      if (mine || joins) { const [x, y] = P(p); d += `${open ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; open = mine; } else open = false;
    });
    return d;
  });
  const start = P(track.points[0]);
  const atk = track.overlay_start ? P(track.overlay_start) : null;
  const bar = 500 * k;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Track of the real drive: the first part fits the model, the second calibrates it, the last is the test where attacks are overlaid">
      {paths.map((d, s) => <path key={`g${s}`} d={d} fill="none" stroke={SEG[s][1]} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" opacity=".16" />)}
      {paths.map((d, s) => <path key={s} d={d} fill="none" stroke={SEG[s][1]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}
      <rect x={start[0] - 6} y={start[1] - 6} width="12" height="12" rx="2" fill="var(--ink)" />
      <text x={start[0] + 12} y={start[1] - 8} className="real-lab">start and end</text>
      {atk && <>
        <circle cx={atk[0]} cy={atk[1]} r="13" fill="var(--untrusted)" opacity=".2" />
        <circle cx={atk[0]} cy={atk[1]} r="6" fill="var(--untrusted)" />
        <text x={atk[0] - 14} y={atk[1] + 4} textAnchor="end" className="real-lab hot">attacks start here</text>
      </>}
      <line x1={W - pad - bar} x2={W - pad} y1={H - 12} y2={H - 12} stroke="var(--ink-3)" strokeWidth="2" />
      <text x={W - pad - bar / 2} y={H - 18} textAnchor="middle" className="real-lab">500 m</text>
    </svg>
  );
}

/** The detector replayed on a public recording of a real receiver: what transferred, what did not, and what it changed. */
export default function RealCheck() {
  const [d, setD] = useState<RealData | null>(null);
  useEffect(() => { fetch("/data/realcheck.json").then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null)); }, []);
  if (!d) return null;
  const r = d.recalibrated;
  const simShare = Math.round((100 * d.whole_drive_simulator_model.alert_seconds) / d.epochs);
  const mins = (s: number) => String(Math.floor(s / 6) / 10);          // 513 s reads "8.5", as in the paper
  const metres = (m: number) => (m < 10 ? `${m.toFixed(1)} m` : dist(m));
  return (
    <section className="real" aria-labelledby="real-h">
      <h2 id="real-h">On a real receiver</h2>
      <p>
        Every number above comes from one simulator. So the same adapter and detector were replayed on a public recording of a real drive: a u-blox ZED-F9K
        receiver on a {d.duration_min}-minute loop in Mountain View, with a survey-grade reference track of the same drive.
      </p>
      <div className="real-grid">
        <figure className="real-map">
          {d.track && <Track track={d.track} />}
          <figcaption>
            {SEG.map(([label, color], i) => (
              <span key={label}><i style={{ background: color }} />{label}: {i === 0 ? `the first ${mins(r.fit_seconds)} min` : i === 1 ? `the next ${mins(r.calibration_seconds)} min` : `the last ${mins(r.test_seconds)} min`}</span>
            ))}
          </figcaption>
        </figure>
        <div className="real-facts">
          <div className="real-fact">
            <b style={{ color: "var(--trusted)" }}>{d.whole_drive_rules_only.alert_seconds}</b>
            <div><strong>false alarms from the rules</strong><span>in the whole drive, lowest trust {d.whole_drive_rules_only.min_trust?.toFixed(0)}. The usual signal-strength check raised {d.whole_drive_cn0_sats_baseline.alert_seconds} s of false alarms on the same drive.</span></div>
          </div>
          <div className="real-fact">
            <b style={{ color: "var(--untrusted)" }}>{simShare}%</b>
            <div><strong>of seconds alerted by the simulator-trained model</strong><span>A real receiver is not as quiet as the simulator, so the model has to be re-calibrated on the receiver in use.</span></div>
          </div>
          <div className="real-fact">
            <b style={{ color: "var(--trusted)" }}>{r.test_no_attack.alert_seconds}</b>
            <div><strong>alerts after re-calibration</strong><span>Re-calibrated on the first {mins(r.fit_seconds + r.calibration_seconds)} minutes of the drive, the model raises no alert in the remaining {mins(r.test_seconds)} minutes.</span></div>
          </div>
        </div>
      </div>
      <div className="real-attacks">
        {d.overlays.runs.map((run) => {
          const h = run.hybrid, [name, what] = ATTACK[run.kind];
          const before = h.raw_blank_s > 0 ? `blank for ${span(h.raw_blank_s)}` : `${metres(h.raw_max_error_m)} off`;
          return (
            <div key={run.kind} className="real-attack">
              <h3>{name}<small>{what}</small></h3>
              <p className="real-delay"><b>{h.first_alert_delay_s === 0 ? "same second" : `${h.first_alert_delay_s} s`}</b> to the first alert</p>
              <dl>
                <div><dt>An ordinary screen</dt><dd>{before}</dd></div>
                <div><dt>TrustNav hands on</dt><dd className="ok">within {metres(h.protected_max_error_m)}</dd></div>
                <div><dt>Rules alone</dt><dd>{run.rules.first_alert_delay_s == null ? "never alert" : run.rules.first_alert_delay_s === 0 ? "same second" : `${run.rules.first_alert_delay_s} s`}</dd></div>
              </dl>
            </div>
          );
        })}
      </div>
      <p className="note">
        Recording: Google gps-measurement-tools (Apache-2.0), u-blox ZED-F9K with a NovAtel SPAN reference, February 2020. The attacks are overlaid in software on the last
        segment; nothing is transmitted. The reference track stands in for the assigned route and its speed for the odometer, so the protected errors are the best case.
        This recording has no pseudorange residuals, clock, jamming indicator or OSNMA. It also exposed two weaknesses that are now fixed: tail scores that saturated on extreme
        values, and a hold that released after sixty clean seconds while the fix was still kilometres away.
      </p>
    </section>
  );
}
