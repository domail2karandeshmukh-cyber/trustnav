"use client";

import { useState } from "react";

const band = (t: number) => (t >= 75 ? ["Trusted", "trusted"] : t >= 50 ? ["Degraded", "degraded"] : t >= 25 ? ["Suspicious", "suspicious"] : ["Untrusted", "untrusted"]) as [string, string];

function Dial({ value, label, note, tone }: { value: number; label: string; note: string; tone: string }) {
  const R = 46, C = 2 * Math.PI * R * 0.75, on = C * Math.max(0.02, value / 100);
  return (
    <div className="lab-dial">
      <svg viewBox="0 0 120 120" width="132" height="132" role="img" aria-label={`${label}: ${Math.round(value)}`}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--line)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${C} 999`} transform="rotate(135 60 60)" />
        <circle cx="60" cy="60" r={R} fill="none" stroke={`var(--${tone})`} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${on} 999`} transform="rotate(135 60 60)" style={{ transition: "stroke-dasharray .25s ease, stroke .25s ease" }} />
        <text x="60" y="68" textAnchor="middle" className="lab-num" fill={`var(--${tone})`}>{Math.round(value)}</text>
      </svg>
      <b>{label}</b>
      <span>{note}</span>
    </div>
  );
}

/** Try the fusion yourself: two witnesses, two sliders, and what averaging would have hidden. */
export default function FusionLab({ ruleWeight, mlWeight }: { ruleWeight: number; mlWeight: number }) {
  const [rules, setRules] = useState(0);
  const [model, setModel] = useState(90);
  const risk = 100 * (1 - (1 - ruleWeight * rules / 100) * (1 - mlWeight * model / 100));
  const avg = (rules + model) / 2;
  const trust = 100 - risk, [name, tone] = band(trust);
  const [, avgTone] = band(100 - avg);
  const held = trust < 50;
  const presets: [string, number, number][] = [["Normal driving", 4, 8], ["Stealth drift", 0, 100], ["Teleport", 56, 100], ["Jamming", 78, 40]];
  return (
    <section className="lab" aria-label="Fusion lab">
      <div className="lab-head">
        <h2>Try it: two witnesses, one verdict</h2>
        <p>Move the two risks. The combined score uses the weights chosen on validation routes ({ruleWeight} for the rules, {mlWeight} for the model). An average lets one calm witness talk the other down: try a model alarm of 90 while the rules stay silent.</p>
      </div>
      <div className="lab-body">
        <div className="lab-inputs">
          <label><span><b>Rule risk</b><i>{rules}</i></span><input type="range" min={0} max={100} value={rules} onChange={(e) => setRules(+e.target.value)} aria-label="Rule risk" style={{ accentColor: "var(--s-rule)" }} /></label>
          <label><span><b>Model risk</b><i>{model}</i></span><input type="range" min={0} max={100} value={model} onChange={(e) => setModel(+e.target.value)} aria-label="Model risk" style={{ accentColor: "var(--s-ml)" }} /></label>
          <div className="lab-presets">{presets.map(([n, r, m]) => <button key={n} className="btn" onClick={() => { setRules(r); setModel(m); }}>{n}</button>)}</div>
        </div>
        <div className="lab-out">
          <Dial value={100 - avg} label="Trust, if we averaged" note={avg >= 50 ? "would alert" : "no alert: the attack passes"} tone={avgTone} />
          <Dial value={trust} label="Trust, TrustNav (noisy-OR)" note={name} tone={tone} />
          <div className={`lab-verdict ${held ? "held" : ""}`}>
            <b>{held ? "Fix refused" : "Fix accepted"}</b>
            <span>{held ? "The position handed on comes from the odometer along the route." : "The position passes through unchanged."}</span>
            <small>risk = 100 × [1 − (1 − {ruleWeight} × {(rules / 100).toFixed(2)})(1 − {mlWeight} × {(model / 100).toFixed(2)})] = {risk.toFixed(0)}</small>
          </div>
        </div>
      </div>
    </section>
  );
}
