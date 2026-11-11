"use client";

import type { ReplayData } from "@/lib/types";
import FusionLab from "./FusionLab";
import { TabPanel, Tabs } from "./Tabs";

type Meta = Omit<ReplayData, "scenarios" | "routes">;

// name, what crosses the line, weight key, critical
const RULES: [string, string, string, boolean?][] = [
  ["Position jump", "Step over 250 m per second between fixes", "position_jump_weight", true],
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
  ["Galileo authentication failed", "OSNMA signature check fails", "osnma_failed_weight", true],
  ["Galileo authentication lost", "Verified Galileo data disappears", "osnma_lost_weight"],
  ["Position fix lost", "No solution for three seconds", "fix_lost_weight"],
  ["Receiver time jump", "Receiver time moves more than 5 s against the host clock, or runs backwards", "time_jump_weight", true],
];

const ROLE: [("train" | "validation" | "heldout"), string, string][] = [
  ["train", "Training", "the model learns normal driving here"],
  ["validation", "Validation", "the two fusion weights are chosen here"],
  ["heldout", "Held out", "every reported number comes from here"],
];

export const METHOD_TABS = [
  { id: "idea", label: "In one picture" },
  { id: "try", label: "Try it" },
  { id: "rules", label: `The ${RULES.length} rules` },
  { id: "compare", label: "Against what exists" },
  { id: "detail", label: "Fine print" },
] as const;
type TabId = (typeof METHOD_TABS)[number]["id"];

export default function MethodView({ meta, tab, onTab }: { meta: Meta; tab?: string; onTab: (id: string) => void }) {
  const rs = meta.settings.rules ?? {};
  const active: TabId = METHOD_TABS.some((t) => t.id === tab) ? (tab as TabId) : "idea";
  const top = Math.max(...RULES.map(([, , w]) => Number(rs[w] ?? 0)), 1);
  return (
    <article className="doc board">
      <header className="board-head">
        <h1>How TrustNav decides</h1>
        <Tabs tabs={METHOD_TABS} value={active} onChange={onTab} label="Method" />
      </header>

      {active === "idea" && (
        <TabPanel id="idea">
          <p className="board-say">From raw receiver output to a decision, every second.</p>
          <figure className="pipeline" aria-label="Processing pipeline">
            <div><b>Receiver output</b><span>Position, speed, satellites, signal, clock, time, Galileo authentication</span></div>
            <div><b>{meta.features.all.length} features</b><span>Each fix against the last five seconds and the route</span></div>
            <div className="split">
              <div><b>{RULES.length} rules</b><span>Physical limits, each with a named threshold</span></div>
              <div><b>Anomaly model</b><span>Trained on normal driving only</span></div>
            </div>
            <div><b>Fusion</b><span>Either witness can raise the alarm</span></div>
            <div><b>Trust score and evidence</b><span>0 to 100, with the reasons in words</span></div>
            <div className="out"><b>Response</b><span>Below 50 the fix is refused and the position comes from the odometer</span></div>
          </figure>
          <div className="trio">
            <div>
              <h2>Two witnesses</h2>
              <p>Rules sit where physics stops making sense, so they almost never cry wolf, but a slow attack stays under every threshold. A model of normal driving notices the van 12 m off its road.</p>
            </div>
            <div>
              <h2>From detection to response</h2>
              <p>A fix under trust {meta.settings.safeguard?.hold_below_trust ?? 50} is refused. The position handed on is dead reckoned from the odometer along the route, and the receiver only takes over again when a clean fix rejoins that estimate.</p>
            </div>
            <div>
              <h2>Signatures are not enough</h2>
              <p>Galileo signs its messages (OSNMA) and a failed signature is critical. A relayed signal keeps its signatures valid while the position is wrong, so only the motion evidence catches it.</p>
            </div>
          </div>
        </TabPanel>
      )}

      {active === "try" && (
        <TabPanel id="try">
          <FusionLab ruleWeight={meta.fusion_search.chosen.rule_weight} mlWeight={meta.fusion_search.chosen.ml_weight} />
        </TabPanel>
      )}

      {active === "rules" && (
        <TabPanel id="rules">
          <p className="board-sub">Each rule adds its weight times a severity: 0.5 at the threshold, 1.0 at three times it. A critical rule holds the risk at {rs.critical_risk_floor ?? 70} or more.</p>
          <ul className="rulegrid">
            {RULES.map(([name, when, w, critical]) => {
              const v = Number(rs[w] ?? 0);
              return (
                <li key={name}>
                  <div className="rule-top"><b>{name}</b>{critical && <em>critical</em>}<span className="num">{rs[w] ?? "–"}</span></div>
                  <i aria-hidden="true"><u style={{ width: `${(100 * v) / top}%` }} /></i>
                  <small>{when}</small>
                </li>
              );
            })}
          </ul>
        </TabPanel>
      )}

      {active === "compare" && (
        <TabPanel id="compare">
          <p className="board-sub">Existing tools sit inside one receiver and output a flag, or watch a fixed site. None of those we found gives a fleet a per-vehicle, per-second, explained score with a response.</p>
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
                  ["Status", "shipping", "shipping", "shipping", "shipping", "operational", "prototype, replayed on real recordings"],
                ] as string[][]).map((row) => (
                  <tr key={row[0]}><th scope="row">{row[0]}</th>{row.slice(1).map((c, i) => <td key={i} className={i === 5 ? "hl" : ""}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">Receiver flags are inputs to TrustNav, not rivals. Sources are in <code>docs/COMPARISON.md</code> in the repository.</p>
        </TabPanel>
      )}

      {active === "detail" && (
        <TabPanel id="detail">
          <div className="doc-cols">
            <div className="prose">
              <h2>From model score to risk</h2>
              <pre className="formula">{`p     = min(1, 2 × min(p_forest, p_tail))
risk  = 100 × min(1, −log10(p) / 4)
trust = 100 − combined risk`}</pre>
              <p><code>p</code> is the share of normal seconds, from runs the model was not fitted on, that looked at least this unusual. A risk of 50 is roughly a one-in-a-hundred event in normal operation.</p>

              <h2>Fusion</h2>
              <pre className="formula">{`combined = 100 × (1 − (1 − w_r·p_rules)(1 − w_m·p_model))
w_r = ${meta.fusion_search.chosen.rule_weight}, w_m = ${meta.fusion_search.chosen.ml_weight}, chosen on validation routes`}</pre>
              <p>Averaging would dilute a confident alarm: a model at 90 and quiet rules at 20 average to 55. This fusion keeps it at 75.</p>

              <h2>What it cannot do</h2>
              <p>It does not touch the radio signal: no software can stop a jammer. Its estimate drifts with the odometer, about three percent of the distance travelled, so a long hold carries an action: <strong>verify</strong> by other means or, in the untrusted band, <strong>isolate</strong> the device.</p>

              <h2>What this build does not claim</h2>
              <ul className="plain">
                {meta.limitations.map((l) => <li key={l}>{l}</li>)}
                <li>No radio signal is transmitted, jammed or spoofed by this project.</li>
                <li>The trust score is a research indicator, not a certified integrity figure. It is not for aviation, maritime or any other safety-critical use.</li>
              </ul>
            </div>

            <aside className="doc-side">
              <h2>Data split</h2>
              <ul className="split-list">
                {ROLE.map(([role, label, why]) => {
                  const rts = meta.route_catalogue.filter((r) => r.role === role);
                  return (
                    <li key={role}>
                      <b>{label}</b><span className="num">{rts.length} routes, {(rts.reduce((a, r) => a + r.length_m, 0) / 1000).toFixed(0)} km</span>
                      <small>{why}</small>
                      <details><summary>Routes</summary><p>{rts.map((r) => r.name).join("; ")}</p></details>
                    </li>
                  );
                })}
              </ul>
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
          <footer className="doc-foot">
            <p>Research prototype by Karan Deshmukh, MSc Cybersecurity and Data Science, ESAIP Angers. Engine {meta.engine_version}.</p>
            <p>Map data © OpenStreetMap contributors, basemap © CARTO.</p>
          </footer>
        </TabPanel>
      )}
    </article>
  );
}
