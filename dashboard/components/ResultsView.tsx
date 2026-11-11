"use client";

import type { ReactNode } from "react";
import type { ReplayData } from "@/lib/types";
import { dist, fmt, pct, span } from "@/lib/format";
import { useJSON } from "@/lib/useJSON";
import { TrustTape } from "./Instruments";
import RealCheck, { type RealData } from "./RealCheck";
import AttackCheck, { type AttackData } from "./AttackCheck";
import { Shift, TabPanel, Tabs } from "./Tabs";

type Meta = Omit<ReplayData, "scenarios" | "routes"> & { scenarios: Omit<ReplayData["scenarios"][number], "frames">[] };

const COLS = [
  ["rules", "Rules only", "Fixed physical thresholds"],
  ["ml", "Model only", "Anomaly detectors trained on normal data"],
  ["hybrid", "Combined", "Both, fused. This is what the console shows"],
] as const;

export const RESULT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "runs", label: "Each attack" },
  { id: "real-attacks", label: "Real attacks" },
  { id: "real-drive", label: "Real drive" },
  { id: "tables", label: "Full tables" },
] as const;
type TabId = (typeof RESULT_TABS)[number]["id"];

export default function ResultsView({ meta, replay, onOpen, tab, onTab }: { meta: Meta; replay: ReplayData | null; onOpen: (slug: string) => void; tab?: string; onTab: (id: string) => void }) {
  const attack = useJSON<AttackData>("/data/attackcheck.json");
  const real = useJSON<RealData>("/data/realcheck.json");
  const active: TabId = RESULT_TABS.some((t) => t.id === tab) ? (tab as TabId) : "overview";

  const ex = meta.experiments;
  const hyb = ex.hybrid;
  const attacks = hyb.per_scenario.filter((p) => p.attack_observations > 0);
  const caught = attacks.filter((p) => p.detection_latency_obs != null).length;
  const quick = attacks.filter((p) => p.detection_latency_obs != null && p.detection_latency_obs <= 1).length;
  const total = hyb.support_positive + hyb.support_negative;
  const prot = meta.protection;
  const name = (slug: string) => meta.scenarios.find((x) => x.slug === slug)?.name ?? slug;
  const scenarioCell = (slug: string) => (
    <td><button className="link" onClick={() => onOpen(slug)}>{name(slug).split(":")[0]}</button><small>{name(slug).split(":")[1]?.trim()}</small></td>
  );

  return (
    <article className="doc board">
      <header className="board-head">
        <h1>Results</h1>
        <Tabs tabs={RESULT_TABS} value={active} onChange={onTab} label="Results" />
      </header>

      {active === "overview" && (
        <TabPanel id="overview">
          <div className="board-top">
            <div>
              <p className="board-say">{caught === attacks.length ? "Every attack caught." : `${caught} of ${attacks.length} attacks caught.`}<br />{quick} of {attacks.length} within one second.</p>
              <p className="board-sub">{meta.scenarios.length} recorded runs, {total.toLocaleString("en-GB")} seconds, on routes the model never saw in training.</p>
              <div className="reads">
                {([
                  [pct(hyb.precision), "precision", "alerts that were real attacks", "trusted"],
                  [pct(hyb.recall), "recall", "attacked seconds that raised an alert", "trusted"],
                  [pct(hyb.false_positive_rate, 2), "false alarms", "clean seconds wrongly flagged", "degraded"],
                ] as const).map(([v, l, d, tone]) => (
                  <div key={l} className="read" style={{ borderTopColor: `var(--${tone})` }}><b>{v}</b><span>{l}</span><small>{d}</small></div>
                ))}
              </div>
            </div>
            <div className="score-bars" role="img" aria-label={`Recall: rules ${pct(ex.rules.recall)}, model ${pct(ex.ml.recall)}, combined ${pct(hyb.recall)}. F1: rules ${fmt(ex.rules.f1, 3)}, model ${fmt(ex.ml.f1, 3)}, combined ${fmt(hyb.f1, 3)}.`}>
              {([["Recall", "recall"], ["F1", "f1"], ["Precision", "precision"]] as const).map(([label, key]) => (
                <div key={key} className="score-group">
                  <h3>{label}</h3>
                  {COLS.map(([k, n]) => (
                    <div key={k} className={`score-bar ${k}`}>
                      <span>{n}</span>
                      <i><em style={{ width: `${Math.max(1, ex[k][key] * 100)}%` }} /></i>
                      <b>{key === "f1" ? fmt(ex[k][key], 3) : pct(ex[k][key])}</b>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="doors">
            {attack && (() => {
              const cfg = (k: string) => attack.phone.configurations.find((x) => x.key === k)!;
              const was = cfg("published").first_alert_delay_s, now = cfg("time").first_alert_delay_s;
              return (
                <button className="door" onClick={() => onTab("real-attacks")}>
                  <span className="door-k">Against a real spoofer</span>
                  <Shift from={was == null ? "never" : span(was)} to={now === 0 ? "same second" : now == null ? "never" : span(now)} />
                  <span className="door-d">first alert, before and after the sixteenth rule</span>
                </button>
              );
            })()}
            {prot && (
              <button className="door" onClick={() => onTab("runs")}>
                <span className="door-k">What the operator would have seen</span>
                <Shift from={dist(prot.spoofing_worst_reported_error_m ?? 0)} to={dist(prot.spoofing_worst_protected_error_m ?? 0)} />
                <span className="door-d">worst false position, without and with the response</span>
              </button>
            )}
            {real && (
              <button className="door" onClick={() => onTab("real-drive")}>
                <span className="door-k">False alarms on a clean real drive</span>
                <Shift from={`${real.whole_drive_cn0_sats_baseline.alert_seconds} s`} to={`${real.whole_drive_rules_only.alert_seconds} s`} />
                <span className="door-d">usual signal-strength check, then TrustNav&apos;s rules</span>
              </button>
            )}
          </div>
        </TabPanel>
      )}

      {active === "runs" && (
        <TabPanel id="runs">
          <p className="board-sub">Ten recorded runs. Open one to replay it second by second.</p>
          <div className="scroll-x">
            <table className="scen runs">
              <thead>
                <tr><th>Run</th><th className="tape-col">Trust over the whole run</th><th className="num">First alert</th><th className="num">Ordinary screen<small>worst error</small></th><th className="num hl">TrustNav hands on<small>worst error</small></th></tr>
              </thead>
              <tbody>
                {hyb.per_scenario.map((p) => {
                  const full = replay?.scenarios.find((x) => x.slug === p.scenario);
                  const hit = full?.frames.filter((f) => f.atk) ?? [];
                  const pr = prot?.per_scenario.find((x) => x.scenario === p.scenario);
                  const normal = p.attack_observations === 0;
                  const v = p.detection_latency_obs;
                  return (
                    <tr key={p.scenario}>
                      {scenarioCell(p.scenario)}
                      <td className="tape-col">{full ? <TrustTape frames={full.frames} slots={full.frames.length} height={10}
                        brackets={hit.length ? [{ start: hit[0].s, end: hit[hit.length - 1].s, tone: "attack" }] : undefined} /> : <span className="skeleton line" />}</td>
                      <td className="num">{normal ? <span className="muted">no attack</span> : v == null ? "missed" : v === 0 ? "same second" : `${v} s`}</td>
                      <td className="num">{normal || !pr ? "" : pr.reported_blank_s > 0 ? `blank ${span(pr.reported_blank_s)}` : dist(pr.reported_max_error_m ?? 0)}</td>
                      <td className="num hl">{normal || !pr ? "" : dist(pr.protected_max_error_m ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note">The bracket above a strip marks when the attack was active. <span className="runs-note-wide">Errors are measured against the simulator&apos;s true position.</span></p>
        </TabPanel>
      )}

      {active === "real-attacks" && <TabPanel id="real-attacks">{attack ? <AttackCheck d={attack} /> : <p className="board-sub">Loading the recordings…</p>}</TabPanel>}

      {active === "real-drive" && <TabPanel id="real-drive">{real ? <RealCheck d={real} /> : <p className="board-sub">Loading the recording…</p>}</TabPanel>}

      {active === "tables" && <TabPanel id="tables"><Tables meta={meta} scenarioCell={scenarioCell} /></TabPanel>}
    </article>
  );
}

/** Everything behind the exhibits, for the reader who wants to check. */
function Tables({ meta, scenarioCell }: { meta: Meta; scenarioCell: (slug: string) => ReactNode }) {
  const ex = meta.experiments;
  const hyb = ex.hybrid;
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
    <>
      <section>
        <h2>Three ways to decide</h2>
        <div className="scroll-x">
          <table className="compare">
            <thead>
              <tr><th />{COLS.map(([k, n, note]) => <th key={k} className={k === "hybrid" ? "hl" : ""}><b>{n}</b><small>{note}</small></th>)}</tr>
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
      </section>

      <section>
        <h2>Detection, run by run</h2>
        <div className="scroll-x">
          <table className="scen">
            <thead><tr><th>Run</th><th className="num">Rules</th><th className="num">Model</th><th className="num hl">Combined</th><th className="num">False alerts</th></tr></thead>
            <tbody>
              {hyb.per_scenario.map((p) => {
                const r = ex.rules.per_scenario.find((x) => x.scenario === p.scenario)!;
                const m = ex.ml.per_scenario.find((x) => x.scenario === p.scenario)!;
                const lat = (v: number | null) => (p.attack_observations === 0 ? "" : v == null ? "missed" : `${v} s`);
                return (
                  <tr key={p.scenario}>
                    {scenarioCell(p.scenario)}
                    <td className="num">{lat(r.detection_latency_obs)}</td>
                    <td className="num">{lat(m.detection_latency_obs)}</td>
                    <td className="num hl">{p.attack_observations === 0 ? <span className="muted">no attack</span> : lat(p.detection_latency_obs)}</td>
                    <td className="num">{p.false_alerts}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">Time from the start of the attack to the first alert.</p>
      </section>

      {meta.protection && (
        <section>
          <h2>Response, run by run</h2>
          <div className="scroll-x">
            <table className="scen prot">
              <thead>
                <tr><th>Run</th><th className="num">Ordinary screen<small>worst error</small></th><th className="num hl">With response layer<small>worst error</small></th><th className="num">Hold began<small>after attack start</small></th><th className="num">Held</th><th className="num">False holds</th></tr>
              </thead>
              <tbody>
                {meta.protection.per_scenario.map((p) => {
                  const normal = p.attack_observations === 0;
                  return (
                    <tr key={p.scenario}>
                      {scenarioCell(p.scenario)}
                      <td className="num">{normal ? <span className="muted">no attack</span> : p.reported_blank_s > 0 ? `blank ${span(p.reported_blank_s)}` : dist(p.reported_max_error_m ?? 0)}</td>
                      <td className="num hl">{normal ? "" : dist(p.protected_max_error_m ?? 0)}</td>
                      <td className="num">{normal ? "" : p.hold_after_s == null ? "never" : p.hold_after_s === 0 ? "same second" : `${p.hold_after_s} s`}</td>
                      <td className="num">{p.held_s ? span(p.held_s) : "–"}</td>
                      <td className="num">{p.false_hold_s ? `${p.false_hold_s} s` : "0"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note">Holds outside an attack total {span(meta.protection.false_hold_s_total)} over the ten runs, each at an error of a few metres.</p>
        </section>
      )}

      <section>
        <h2>Choosing the fusion weights</h2>
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
        <p className="note">F1 on separate validation routes; darker is higher. Outlined: the chosen pair, rules {meta.fusion_search.chosen.rule_weight} and model {meta.fusion_search.chosen.ml_weight}.</p>
      </section>

      <section>
        <h2>Read these numbers with care</h2>
        <ul className="plain">{meta.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      </section>
    </>
  );
}
