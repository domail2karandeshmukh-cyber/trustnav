"use client";

import type { ReplayData } from "@/lib/types";
import { fmt, pct, span } from "@/lib/format";
import { TrustTape } from "./Instruments";

type Meta = Omit<ReplayData, "scenarios" | "routes"> & { scenarios: Omit<ReplayData["scenarios"][number], "frames">[] };

const COLS = [
  ["rules", "Rules only", "Fixed physical thresholds"],
  ["ml", "Model only", "Anomaly detectors trained on normal data"],
  ["hybrid", "Combined", "Both, fused. This is what the console shows"],
] as const;

export default function ResultsView({ meta, replay, onOpen }: { meta: Meta; replay: ReplayData | null; onOpen: (slug: string) => void }) {
  const ex = meta.experiments;
  const hyb = ex.hybrid;
  const attacks = hyb.per_scenario.filter((p) => p.attack_observations > 0);
  const caught = attacks.filter((p) => p.detection_latency_obs != null).length;
  const normals = hyb.per_scenario.filter((p) => p.attack_observations === 0);
  const normalFalse = normals.reduce((a, p) => a + p.false_alerts, 0);
  const total = hyb.support_positive + hyb.support_negative;
  const grid = meta.fusion_search.grid;
  const rws = [...new Set(grid.map((g) => g.rule_weight))].sort((a, b) => a - b);
  const mws = [...new Set(grid.map((g) => g.ml_weight))].sort((a, b) => a - b);
  const f1s = grid.map((g) => g.f1);
  const lo = Math.min(...f1s), hi = Math.max(...f1s);

  const rows: [string, (k: (typeof COLS)[number][0]) => string, string?][] = [
    ["Precision", (k) => pct(ex[k].precision), "Share of alerts that were real attacks"],
    ["Recall", (k) => pct(ex[k].recall), "Share of attacked seconds that raised an alert"],
    ["F1", (k) => fmt(ex[k].f1, 3)],
    ["False alarm rate", (k) => pct(ex[k].false_positive_rate, 2), "Clean seconds wrongly flagged"],
    ["Mean time to detect", (k) => (ex[k].mean_detection_latency_obs == null ? "–" : span(ex[k].mean_detection_latency_obs!)), "Attack start to first alert"],
    ["ROC AUC", (k) => fmt(ex[k].roc_auc ?? null, 3)],
  ];

  return (
    <article className="doc">
      <header className="doc-head">
        <h1>Results</h1>
        <p className="doc-lede">
          The combined score caught {caught} of {attacks.length} attacks and raised {normalFalse === 0 ? "no alert" : `${normalFalse} alerts`} on
          the {normals.length} normal runs. Every number below comes from {meta.scenarios.length} recorded scenarios
          ({total.toLocaleString("en-GB")} one-second observations) on routes the model never saw during training.
        </p>
      </header>

      <section>
        <h2>Three ways to decide</h2>
        <div className="scroll-x">
          <table className="compare">
            <thead>
              <tr><th />{COLS.map(([k, name, note]) => <th key={k} className={k === "hybrid" ? "hl" : ""}><b>{name}</b><small>{note}</small></th>)}</tr>
            </thead>
            <tbody>
              {rows.map(([label, get, help]) => (
                <tr key={label}>
                  <th scope="row">{label}{help && <small>{help}</small>}</th>
                  {COLS.map(([k]) => <td key={k} className={`num${k === "hybrid" ? " hl" : ""}`}>{get(k)}</td>)}
                </tr>
              ))}
              <tr className="sub">
                <th scope="row">Seconds classified<small>True alert, false alert, missed, true clear</small></th>
                {COLS.map(([k]) => { const c = ex[k].confusion_matrix; return <td key={k} className={`num${k === "hybrid" ? " hl" : ""}`}>{c.tp} / {c.fp} / {c.fn} / {c.tn}</td>; })}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="note">Rules never cry wolf but miss slow attacks. The model catches subtle changes but is noisier. Combined, each covers the other&apos;s blind spot.</p>
      </section>

      <section>
        <h2>Scenario by scenario</h2>
        <div className="scroll-x">
          <table className="scen">
            <thead>
              <tr><th>Scenario</th><th className="tape-col">Trust over the whole run</th><th className="num">Rules</th><th className="num">Model</th><th className="num hl">Combined</th><th className="num">False alerts</th></tr>
            </thead>
            <tbody>
              {hyb.per_scenario.map((p) => {
                const r = ex.rules.per_scenario.find((x) => x.scenario === p.scenario)!;
                const m = ex.ml.per_scenario.find((x) => x.scenario === p.scenario)!;
                const s = meta.scenarios.find((x) => x.slug === p.scenario);
                const full = replay?.scenarios.find((x) => x.slug === p.scenario);
                const hit = full?.frames.filter((f) => f.atk) ?? [];
                const lat = (v: number | null) => (p.attack_observations === 0 ? "" : v == null ? "missed" : `${v} s`);
                return (
                  <tr key={p.scenario}>
                    <td><button className="link" onClick={() => onOpen(p.scenario)}>{s?.name.split(":")[0] ?? p.scenario}</button><small>{s?.name.split(":")[1]?.trim()}</small></td>
                    <td className="tape-col">{full ? <TrustTape frames={full.frames} slots={full.frames.length} height={10}
                      brackets={hit.length ? [{ start: hit[0].s, end: hit[hit.length - 1].s, tone: "attack" }] : undefined} /> : <span className="skeleton line" />}</td>
                    <td className="num">{lat(r.detection_latency_obs)}</td>
                    <td className="num">{lat(m.detection_latency_obs)}</td>
                    <td className="num hl">{p.attack_observations === 0 ? <span className="muted">normal run</span> : lat(p.detection_latency_obs)}</td>
                    <td className="num">{p.false_alerts}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">Times are from attack start to the first alert. The bracket above each strip marks when the simulated attack was active. Open a scenario to replay it.</p>
      </section>

      <section>
        <h2>Choosing the fusion weights</h2>
        <p>The weights were picked on separate validation routes, never on the results above. Darker cells score a higher F1.</p>
        <div className="scroll-x">
          <table className="heat">
            <thead><tr><th>Rule weight ↓ Model weight →</th>{mws.map((w) => <th key={w} className="num">{w}</th>)}</tr></thead>
            <tbody>
              {rws.map((rw) => (
                <tr key={rw}>
                  <th scope="row" className="num">{rw}</th>
                  {mws.map((mw) => {
                    const g = grid.find((x) => x.rule_weight === rw && x.ml_weight === mw);
                    if (!g) return <td key={mw} />;
                    const t = hi > lo ? (g.f1 - lo) / (hi - lo) : 1;
                    const chosen = rw === meta.fusion_search.chosen.rule_weight && mw === meta.fusion_search.chosen.ml_weight;
                    return (
                      <td key={mw} className={`num${chosen ? " chosen" : ""}`} style={{ background: `color-mix(in srgb, var(--chart) ${Math.round(8 + t * 62)}%, white)`, color: t > 0.55 ? "#fff" : "var(--ink)" }}
                        title={`F1 ${fmt(g.f1, 3)}, false alarms ${pct(g.false_positive_rate, 2)}`}>
                        {fmt(g.f1, 3)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">Outlined: the chosen pair, rules {meta.fusion_search.chosen.rule_weight} and model {meta.fusion_search.chosen.ml_weight}.</p>
      </section>

      <section>
        <h2>Read these numbers with care</h2>
        <ul className="plain">{meta.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      </section>
    </article>
  );
}
