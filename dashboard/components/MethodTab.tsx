"use client";

import type { ReplayData } from "@/lib/types";

type Meta = Omit<ReplayData, "scenarios" | "routes">;

const RULES: [string, string, string, string][] = [
  ["R_POSITION_JUMP", "Position jump", "step > 250 m (critical at 1 km)", "position_jump_weight"],
  ["R_IMPOSSIBLE_SPEED", "Impossible speed", "> platform max speed", "impossible_speed_weight"],
  ["R_ACCELERATION_SPIKE", "Acceleration spike", "> platform max acceleration", "acceleration_spike_weight"],
  ["R_HEADING_DISCONTINUITY", "Heading discontinuity", "> platform max turn rate, moving", "heading_discontinuity_weight"],
  ["R_ROUTE_DEVIATION", "Route deviation", "> 150 m from assigned route", "route_deviation_weight"],
  ["R_SATELLITE_SHIFT", "Satellite change", "±5 satellites in one epoch", "satellite_shift_weight"],
  ["R_CN0_SHIFT", "Signal strength shift", "±6 dB-Hz vs last 5 epochs", "cn0_shift_weight"],
  ["R_DOP_DEGRADATION", "Geometry degraded", "PDOP > 5", "dop_degradation_weight"],
  ["R_PSEUDORANGE_RESIDUAL", "Range residual", "> 12 m", "pseudorange_weight"],
  ["R_CLOCK_ANOMALY", "Clock anomaly", "drift change > 60 ns/s", "clock_anomaly_weight"],
  ["R_SENSOR_GNSS_MISMATCH", "GNSS vs inertial", "speed differs > 8 m/s", "sensor_mismatch_weight"],
  ["R_JAMMING_INDICATOR", "RF interference", "receiver jamming indicator > 80/255", "jamming_weight"],
  ["R_OSNMA_FAILED", "Galileo authentication failed", "OSNMA tag check fails (critical)", "osnma_failed_weight"],
  ["R_OSNMA_LOST", "Galileo authentication lost", "verified data disappears", "osnma_lost_weight"],
  ["R_FIX_LOST", "Position fix lost", "no solution for 3 s", "fix_lost_weight"],
];

export default function MethodTab({ meta }: { meta: Meta }) {
  const rs = meta.settings.rules ?? {};
  const roles = ["train", "validation", "heldout"] as const;
  return (
    <div className="col">
      <div className="panel">
        <div className="ptitle">How a trust score is produced, once per second per platform</div>
        <div className="flow">
          <div><em>1 · INPUT</em><b>Receiver observation</b><span>Position, speed, satellites, C/N0, PDOP, residuals, clock, jamming indicator, Galileo OSNMA status, inertial speed.</span></div>
          <div><em>2 · FEATURES</em><b>{meta.features.all.length} features</b><span>Compared with the last 5 epochs and the assigned route. Missing inputs become explicit flags, never silent zeros.</span></div>
          <div><em>3a · RULES</em><b>{RULES.length} physical checks</b><span>Each names the value it measured and the threshold it crossed.</span></div>
          <div><em>3b · MODEL</em><b>Two unsupervised detectors</b><span>Isolation Forest (unusual combinations) + per-feature tail detector (single extreme values). Trained on normal data only.</span></div>
          <div><em>4 · FUSION</em><b>Noisy-OR</b><span>Two independent witnesses: either can raise the alarm, together they are stronger.</span></div>
          <div><em>5 · OUTPUT</em><b>Trust 0–100 + evidence</b><span>Trusted ≥ 75 · Degraded ≥ 50 · Suspicious ≥ 25 · Untrusted. Incident after 3 s below 50.</span></div>
        </div>
      </div>

      <div className="grid-main" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)" }}>
        <div className="panel">
          <div className="prose">
            <h3>Why two layers</h3>
            <p><strong>Rules</strong> sit where a physical implausibility begins, not where a spoof becomes likely. They almost never raise a false alarm and every alert can be checked by hand, but a careful attacker who moves the position slowly stays under every threshold.</p>
            <p><strong>The model</strong> learns what normal driving and flying look like, so it notices a car 12 m off its road long before the 150 m rule. Its weakness is the reverse: anything unusual but honest, such as a junction it has not seen, can look suspicious. That is why city routes are part of training.</p>
            <h3>Turning a model score into risk</h3>
            <p>Each detector&apos;s score becomes a tail probability <code>p</code>: the share of normal fixes, from runs the model was not fitted on, that were at least this anomalous.</p>
            <div className="formula">{`p     = min(1, 2 × min(p_forest, p_tail))      # Bonferroni, two tests
risk  = 100 × min(1, −log10(p) / 4)
trust = 100 − fused risk`}</div>
            <p>Risk 50 therefore means about a 1-in-100 event under normal operation. A percentile rank would have spread normal data evenly over 0–100, so a risk-50 alert would fire on half of all clean fixes.</p>
            <h3>Fusion</h3>
            <div className="formula">{`fused = 100 × (1 − (1 − w_r·p_rules)(1 − w_m·p_model))
w_r = ${meta.fusion_search.chosen.rule_weight}, w_m = ${meta.fusion_search.chosen.ml_weight}   (chosen on validation routes)
a CRITICAL rule pins fused risk to at least ${rs.critical_risk_floor ?? 70}`}</div>
            <p>Averaging would weaken a confident alarm: a model at 90 and quiet rules at 20 average to 55. With equal weights, noisy-OR keeps it at 92.</p>
            <h3>Galileo OSNMA</h3>
            <p>Since July 2025 Galileo signs its navigation messages (Open Service Navigation Message Authentication). A receiver that checks the signatures can tell real Galileo data from forged data. TrustNav uses three states: <strong>verified</strong>, <strong>lost</strong> (authenticated data disappeared, which is ambiguous on its own) and <strong>failed</strong> (signatures do not match, which is critical). <em>Unknown</em> is never treated as a failure.</p>
            <p>OSNMA is not enough alone. The stealth drift scenario models a relay attack: the signatures stay valid because the real signal is re-broadcast, yet the position is wrong. Only motion evidence catches it.</p>
          </div>
        </div>
        <div className="col">
          <div className="panel">
            <div className="ptitle">Rules and weights</div>
            <div className="scroll-x">
              <table>
                <thead><tr><th>Rule</th><th>Fires when</th><th className="num">Weight</th></tr></thead>
                <tbody>{RULES.map(([code, name, when, w]) => (
                  <tr key={code}><td>{name}<div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{code}</div></td><td style={{ fontSize: 12.5, color: "var(--ink-dim)" }}>{when}</td><td className="num">{rs[w] ?? "–"}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <p style={{ margin: 0, padding: "8px 16px 14px", fontSize: 12, color: "var(--ink-faint)" }}>Contribution = weight × severity. Severity is 0.5 at the threshold and 1.0 at three times it. Rules combine by noisy-OR.</p>
          </div>
          <div className="panel">
            <div className="ptitle">Data split · routes never shared between roles</div>
            <div className="scroll-x">
              <table>
                <thead><tr><th>Role</th><th>Route</th><th className="num">Length</th></tr></thead>
                <tbody>{roles.flatMap((role) => meta.route_catalogue.filter((r) => r.role === role).map((r) => (
                  <tr key={r.slug}><td><span className="chip">{role === "heldout" ? "held-out" : role}</span></td><td>{r.name}</td><td className="num">{(r.length_m / 1000).toFixed(1)} km</td></tr>
                )))}</tbody>
              </table>
            </div>
            <p style={{ margin: 0, padding: "8px 16px 14px", fontSize: 12, color: "var(--ink-faint)" }}>Road routes follow real Angers streets (OpenStreetMap via OSRM). Training fits the model, validation picks fusion weights, held-out produces every reported number.</p>
          </div>
          <div className="panel">
            <div className="ptitle">Model</div>
            <div className="tele" style={{ gridTemplateColumns: "1fr" }}>
              <div><span className="k">Version</span><span className="v">{meta.model.model_version}</span></div>
              <div><span className="k">Detectors</span><span className="v">{String(meta.model.model_type)}</span></div>
              <div><span className="k">Model inputs</span><span className="v">{meta.model.feature_count}</span></div>
              <div><span className="k">Fit rows / calibration rows</span><span className="v">{meta.model.fit_rows.toLocaleString("en-GB")} / {meta.model.calibration_rows.toLocaleString("en-GB")}</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="ptitle">What this build does not claim</div>
        <div className="prose" style={{ maxWidth: "none" }}>
          <ul>{meta.limitations.map((l) => <li key={l}>{l}</li>)}
            <li>No radio signal is transmitted, jammed or spoofed by this project. Attacks exist only in software.</li>
            <li>The trust score is a research indicator, not a certified integrity figure. Not for aviation, maritime or any other safety-critical use.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
