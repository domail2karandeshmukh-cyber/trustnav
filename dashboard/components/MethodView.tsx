"use client";

import type { ReplayData } from "@/lib/types";
import FusionLab from "./FusionLab";

type Meta = Omit<ReplayData, "scenarios" | "routes">;

const RULES: [string, string, string][] = [
  ["Position jump", "Step over 250 m per second between fixes (critical at four times that)", "position_jump_weight"],
  ["Impossible speed", "Faster than the platform can move", "impossible_speed_weight"],
  ["Acceleration spike", "Above the platform's maximum acceleration", "acceleration_spike_weight"],
  ["Heading discontinuity", "Turns faster than the platform can, while moving", "heading_discontinuity_weight"],
  ["Route deviation", "More than 150 m from the assigned route", "route_deviation_weight"],
  ["Satellite change", "Five or more satellites gained or lost in one second", "satellite_shift_weight"],
  ["Signal strength shift", "C/N0 moves 6 dB-Hz against the last five seconds", "cn0_shift_weight"],
  ["Geometry degraded", "PDOP above 5", "dop_degradation_weight"],
  ["Range residual", "Pseudorange residual above 12 m", "pseudorange_weight"],
  ["Clock anomaly", "Clock drift changes by more than 60 ns/s", "clock_anomaly_weight"],
  ["GNSS against inertial", "Speeds disagree by more than 8 m/s", "sensor_mismatch_weight"],
  ["RF interference", "Receiver jamming indicator above 80 of 255", "jamming_weight"],
  ["Galileo authentication failed", "OSNMA signature check fails (critical)", "osnma_failed_weight"],
  ["Galileo authentication lost", "Verified Galileo data disappears", "osnma_lost_weight"],
  ["Position fix lost", "No solution for three seconds", "fix_lost_weight"],
  ["Receiver time jump", "Receiver time moves more than 5 s against the host clock, or runs backwards (critical)", "time_jump_weight"],
];

const ROLE: Record<string, string> = { train: "Training", validation: "Validation", heldout: "Held out" };

export default function MethodView({ meta }: { meta: Meta }) {
  const rs = meta.settings.rules ?? {};
  return (
    <article className="doc">
      <header className="doc-head">
        <h1>How TrustNav decides</h1>
        <p className="doc-lede">Once a second, for every vehicle and drone, TrustNav turns raw receiver output into a trust score from 0 to 100 and the evidence behind it.</p>
      </header>

      <figure className="pipeline" aria-label="Processing pipeline">
        <div><b>Receiver output</b><span>Position, speed, satellites, signal strength, geometry, residuals, clock, jamming indicator, Galileo authentication, inertial speed</span></div>
        <div><b>{meta.features.all.length} features</b><span>Each fix compared with the previous five seconds and the assigned route</span></div>
        <div className="split">
          <div><b>{RULES.length} physical rules</b><span>Each names what it measured and the line it crossed</span></div>
          <div><b>Anomaly model</b><span>Isolation Forest and a per-feature tail detector, trained on normal data only</span></div>
        </div>
        <div><b>Fusion</b><span>Either witness can raise the alarm; together they are stronger</span></div>
        <div><b>Trust score and evidence</b><span>Trusted from 75, degraded from 50, suspicious from 25. An incident opens after three seconds below 50</span></div>
        <div className="out"><b>Response</b><span>Below 50 the fix is refused: the position handed on is estimated from the odometer along the route, and the operator gets an action: continue, verify or isolate</span></div>
      </figure>

      <FusionLab ruleWeight={meta.fusion_search.chosen.rule_weight} mlWeight={meta.fusion_search.chosen.ml_weight} />

      <div className="doc-cols">
        <div className="prose">
          <h2>Why two layers</h2>
          <p><strong>Rules</strong> sit where physics stops making sense, not where a spoof becomes likely. They almost never raise a false alarm and anyone can check them by hand. But an attacker who moves the position slowly stays under every threshold.</p>
          <p><strong>The model</strong> has learned what normal driving and flying look like, so it notices a van 12 m off its road long before the 150 m rule would. Its weakness is the reverse: something unusual but honest, like a junction it has never seen, can look suspicious. City routes are in the training data for that reason.</p>

          <h2>From model score to risk</h2>
          <p>Each detector&apos;s score becomes a probability <code>p</code>: the share of normal seconds, from runs the model was not fitted on, that looked at least this unusual.</p>
          <pre className="formula">{`p     = min(1, 2 × min(p_forest, p_tail))
risk  = 100 × min(1, −log10(p) / 4)
trust = 100 − combined risk`}</pre>
          <p>A risk of 50 is roughly a one-in-a-hundred event in normal operation. A plain percentile would have spread normal data evenly from 0 to 100, so half of all clean seconds would sit above 50.</p>

          <h2>Fusion</h2>
          <pre className="formula">{`combined = 100 × (1 − (1 − w_r·p_rules)(1 − w_m·p_model))
w_r = ${meta.fusion_search.chosen.rule_weight}, w_m = ${meta.fusion_search.chosen.ml_weight}, chosen on validation routes
a critical rule holds combined risk at ${rs.critical_risk_floor ?? 70} or more`}</pre>
          <p>Averaging would dilute a confident alarm: a model at 90 and quiet rules at 20 average to 55. This noisy-OR fusion keeps it at 92.</p>

          <h2>From detection to response</h2>
          <p>An alert alone leaves the operator looking at a lie. So the score drives a response, the way an intrusion prevention system acts on what an intrusion detection system finds. A fix with trust under {meta.settings.safeguard?.hold_below_trust ?? 50}, or with critical evidence, is <strong>refused</strong>: it never reaches dispatch, geofencing or billing. In its place the position is <strong>dead reckoned</strong> from the last trusted fix using the odometer, which a spoofer cannot touch, advancing along the planned route so the sideways error of the last fix is dropped. The receiver only regains control after five clean seconds <em>and</em> a fix that rejoins the estimate, so a spoofer cannot end the hold by looking clean while still far away.</p>
          <p>Two things it cannot do. It does not touch the radio signal: no software can stop a jammer. And its estimate drifts with the odometer, about three percent of the distance travelled, so a long hold needs the operator to verify by other means. That is why every hold carries an action: <strong>verify</strong> (confirm before acting) or, in the untrusted band, <strong>isolate</strong> (do not act on this device at all; a drone holds or returns on inertial navigation).</p>

          <h2>Galileo authentication</h2>
          <p>Since July 2025 Galileo signs its navigation messages (OSNMA). A receiver that checks the signatures can tell real Galileo data from forged data. TrustNav reads three states: <strong>verified</strong>, <strong>lost</strong> (authenticated data disappeared, ambiguous on its own) and <strong>failed</strong> (signatures do not match, which is critical). A receiver that does not report OSNMA is never treated as failing.</p>
          <p>Authentication alone is not enough. In the stealth drift scenario an attacker re-broadcasts the real signal, so signatures stay valid while the position is wrong. Only the motion evidence catches it.</p>
        </div>

        <aside className="doc-side">
          <h2>Rules</h2>
          <table className="rules">
            <thead><tr><th>Rule</th><th className="num">Weight</th></tr></thead>
            <tbody>{RULES.map(([name, when, w]) => (
              <tr key={name}><td><b>{name}</b><small>{when}</small></td><td className="num">{rs[w] ?? "–"}</td></tr>
            ))}</tbody>
          </table>
          <p className="note">Contribution is weight times severity: 0.5 at the threshold, 1.0 at three times it. Rules combine by noisy-OR.</p>

          <h2>Data split</h2>
          <table>
            <tbody>{(["train", "validation", "heldout"] as const).flatMap((role) => meta.route_catalogue.filter((r) => r.role === role).map((r) => (
              <tr key={r.slug}><td><b>{r.name}</b><small>{ROLE[role]}</small></td><td className="num">{(r.length_m / 1000).toFixed(1)} km</td></tr>
            )))}</tbody>
          </table>
          <p className="note">Road routes follow real Angers streets (OpenStreetMap, routed with OSRM). No route is shared between roles.</p>

          <h2>Model</h2>
          <dl className="facts">
            <div><dt>Version</dt><dd>{meta.model.model_version}</dd></div>
            <div><dt>Inputs</dt><dd className="num">{meta.model.feature_count} features</dd></div>
            <div><dt>Fitted on</dt><dd className="num">{meta.model.fit_rows.toLocaleString("en-GB")} normal seconds</dd></div>
            <div><dt>Calibrated on</dt><dd className="num">{meta.model.calibration_rows.toLocaleString("en-GB")} normal seconds</dd></div>
          </dl>
        </aside>
      </div>

      <section>
        <h2>How this differs from what exists</h2>
        <p className="doc-lede">Existing tools either sit inside one receiver and output a flag with no explanation, or they are fixed monitoring stations for sites and countries. None of the ones we found gives a fleet operator a per-vehicle, per-second, explained trust score with a response. Sources and detail are in <code>docs/COMPARISON.md</code> in the repository.</p>
        <div className="scroll-x" role="region" aria-label="Comparison with existing approaches, scrolls sideways" tabIndex={0}>
          <table className="compare landscape">
            <thead>
              <tr><th /><th><b>Receiver flags</b><small>u-blox, Septentrio AIM+</small></th><th><b>Fixed probes</b><small>GPSPatron</small></th><th><b>Anti-jam hardware</b><small>infiniDome</small></th><th><b>Fleet telematics</b><small>Geotab and others</small></th><th><b>Galileo OSNMA</b><small>since July 2025</small></th><th className="hl"><b>TrustNav</b><small>this project</small></th></tr>
            </thead>
            <tbody>
              {([
                ["Protects", "one receiver", "a site or region", "one receiver", "the fleet screen", "Galileo data only", "each moving platform"],
                ["Detects", "jamming, spoofing", "jamming, spoofing", "jamming (mitigates)", "relays the receiver's jamming flag", "forged Galileo data", "jamming, spoofing, forgery"],
                ["Per-second score", "no, a state code", "a probability", "no", "no", "no", "yes, 0 to 100"],
                ["Explains why", "no", "partly, charts", "no", "no", "n/a", "yes, in words with values"],
                ["Uses route and odometer", "no", "no", "no", "no", "no", "yes"],
                ["Responds", "no", "alerts", "yes, at RF", "a report", "a flag", "refuses the fix, estimates, recommends"],
                ["Extra hardware", "none", "probe, 1 to 3 antennas", "2 or more antennas", "none", "capable receiver", "none"],
                ["Status", "shipping", "shipping", "shipping", "shipping", "operational", "prototype, simulated data"],
              ] as string[][]).map((row) => (
                <tr key={row[0]}><th scope="row">{row[0]}</th>{row.slice(1).map((c, i) => <td key={i} className={i === 5 ? "hl" : ""}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">The receiver flags are inputs to TrustNav, not rivals: the receiver adapter reads the u-blox jamming indicator and spoofing state and combines them with motion, route and signal evidence. What no software can do is remove a jammer from the air; that is antenna hardware.</p>
      </section>

      <section>
        <h2>What this build does not claim</h2>
        <ul className="plain">
          {meta.limitations.map((l) => <li key={l}>{l}</li>)}
          <li>No radio signal is transmitted, jammed or spoofed by this project. Attacks exist only in software.</li>
          <li>The trust score is a research indicator, not a certified integrity figure. It is not for aviation, maritime or any other safety-critical use.</li>
        </ul>
      </section>

      <footer className="doc-foot">
        <p>Research prototype by Karan Deshmukh, MSc Cybersecurity and Data Science, ESAIP Angers. Engine {meta.engine_version}.</p>
        <p>Map data © OpenStreetMap contributors, basemap © CARTO.</p>
      </footer>
    </article>
  );
}
