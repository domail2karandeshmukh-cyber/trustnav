"use client";

import type { ReplayData } from "@/lib/types";
import { ATTACK_WORD, fmt, pct } from "@/lib/format";

type Meta = Omit<ReplayData, "scenarios" | "routes"> & { scenarios: Omit<ReplayData["scenarios"][number], "frames">[] };

const METHOD_INFO = {
  rules: { name: "Rules only", tone: "var(--s-rule)", note: "Thresholds where physics breaks. Never a false alarm, but slow attacks slip under them." },
  ml: { name: "Model only", tone: "var(--s-ml)", note: "Isolation Forest + tail detector, trained on normal data only. Catches subtle changes early." },
  hybrid: { name: "Hybrid (deployed)", tone: "var(--s-trust)", note: "Noisy-OR of both. What the console shows as trust." },
} as const;

export default function EvalTab({ meta }: { meta: Meta }) {
  const ex = meta.experiments;
  const hyb = ex.hybrid;
  const scen = meta.scenarios;
  return (
    <div className="col">
      <div className="panel">
        <div className="ptitle">Held-out evaluation · {scen.length} scenarios · {hyb.support_positive + hyb.support_negative} observations</div>
        <div className="stats">
          <div className="stat"><em>F1 (hybrid)</em><strong>{fmt(hyb.f1, 3)}</strong><small>precision {pct(hyb.precision)} · recall {pct(hyb.recall)}</small></div>
          <div className="stat"><em>False alarm rate</em><strong>{pct(hyb.false_positive_rate, 2)}</strong><small>{hyb.confusion_matrix.fp} of {hyb.support_negative} clean fixes</small></div>
          <div className="stat"><em>ROC AUC</em><strong>{fmt(hyb.roc_auc ?? null, 3)}</strong><small>ranking quality, threshold-free</small></div>
          <div className="stat"><em>Mean detection latency</em><strong>{fmt(hyb.mean_detection_latency_obs)} s</strong><small>attack start to first alert</small></div>
          <div className="stat"><em>Fusion weights</em><strong className="mono" style={{ fontSize: 17 }}>{meta.fusion_search.chosen.rule_weight} / {meta.fusion_search.chosen.ml_weight}</strong><small>rules / model, chosen on validation</small></div>
        </div>
        <p style={{ margin: 0, padding: "0 16px 14px", color: "var(--ink-dim)", fontSize: 12.5 }}>
          Every number comes from routes the model never saw (Angers centre loop, Angers east loop, Lac de Maine drone survey).
          All data is synthetic, so treat these as an upper bound on real-world performance.
        </p>
      </div>

      <div className="methods">
        {(["rules", "ml", "hybrid"] as const).map((k) => {
          const m = ex[k]; const cm = m.confusion_matrix;
          return (
            <div className="panel" key={k}>
              <div className="ptitle" style={{ color: METHOD_INFO[k].tone }}>{METHOD_INFO[k].name}</div>
              <p style={{ margin: 0, padding: "6px 16px 0", fontSize: 12.5, color: "var(--ink-dim)" }}>{METHOD_INFO[k].note}</p>
              <div className="m-metrics">
                <div><em>Precision</em><strong>{pct(m.precision)}</strong></div>
                <div><em>Recall</em><strong>{pct(m.recall)}</strong></div>
                <div><em>F1</em><strong>{fmt(m.f1, 3)}</strong></div>
                <div><em>False alarms</em><strong>{pct(m.false_positive_rate, 2)}</strong></div>
              </div>
              <div className="cm" aria-label="Confusion matrix">
                <div><span>TRUE ALERT</span><span>{cm.tp}</span></div>
                <div><span>FALSE ALERT</span><span>{cm.fp}</span></div>
                <div><span>MISSED</span><span>{cm.fn}</span></div>
                <div><span>TRUE CLEAR</span><span>{cm.tn}</span></div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <div className="ptitle">Per scenario · detection latency in seconds (– = not detected)</div>
        <div className="scroll-x">
          <table>
            <thead><tr><th>Scenario</th><th>Type</th><th className="num">Attacked fixes</th><th className="num">Rules</th><th className="num">Model</th><th className="num">Hybrid</th><th>Hybrid coverage</th><th className="num">False alerts</th></tr></thead>
            <tbody>
              {hyb.per_scenario.map((p) => {
                const r = ex.rules.per_scenario.find((x) => x.scenario === p.scenario)!;
                const m = ex.ml.per_scenario.find((x) => x.scenario === p.scenario)!;
                const s = scen.find((x) => x.slug === p.scenario);
                const cov = p.attack_observations ? Math.min(1, (p.alerts - p.false_alerts) / p.attack_observations) : null;
                const lat = (v: number | null) => (v == null ? "–" : String(v));
                return (
                  <tr key={p.scenario}>
                    <td>{s?.name ?? p.scenario}</td>
                    <td><span className="chip">{ATTACK_WORD[s?.attack ?? "none"]}</span></td>
                    <td className="num">{p.attack_observations}</td>
                    <td className="num">{p.attack_observations ? lat(r.detection_latency_obs) : ""}</td>
                    <td className="num">{p.attack_observations ? lat(m.detection_latency_obs) : ""}</td>
                    <td className="num" style={{ color: "var(--s-trust)" }}>{p.attack_observations ? lat(p.detection_latency_obs) : ""}</td>
                    <td>{cov == null ? <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>normal run</span> :
                      <div className="bar-cell"><div className="track"><div className="fill" style={{ width: `${cov * 100}%`, background: "var(--s-trust)" }} /></div><span className="mono num" style={{ fontSize: 11.5 }}>{pct(cov, 0)}</span></div>}</td>
                    <td className="num" style={{ color: p.false_alerts ? "var(--degraded)" : undefined }}>{p.false_alerts}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="ptitle">Fusion weight search · validation routes only</div>
        <div className="scroll-x">
          <table>
            <thead><tr><th className="num">Rule weight</th><th className="num">Model weight</th><th className="num">F1</th><th className="num">False alarm rate</th><th></th></tr></thead>
            <tbody>
              {meta.fusion_search.grid.map((g) => {
                const chosen = g.rule_weight === meta.fusion_search.chosen.rule_weight && g.ml_weight === meta.fusion_search.chosen.ml_weight;
                return (
                  <tr key={`${g.rule_weight}-${g.ml_weight}`} style={chosen ? { background: "var(--panel-2)" } : undefined}>
                    <td className="num">{g.rule_weight}</td><td className="num">{g.ml_weight}</td>
                    <td className="num">{fmt(g.f1, 3)}</td><td className="num">{pct(g.false_positive_rate, 2)}</td>
                    <td>{chosen && <span className="chip" style={{ color: "var(--s-trust)" }}>chosen</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
