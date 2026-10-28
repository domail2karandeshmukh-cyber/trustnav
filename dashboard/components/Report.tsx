"use client";

import { useEffect } from "react";
import type { Device, Frame, Incident } from "@/lib/types";
import { OSNMA_INFO, STATUS_WORD, clock, fmt, span } from "@/lib/format";
import { ChartKey, TrustChart, TrustTape } from "./Instruments";
import { IconClose } from "./Icons";

interface Props {
  device: Device;
  frames: Frame[];
  incidents: Incident[];
  mapPng?: string | null;
  source: string;
  onClose: () => void;
}

/** Print-ready incident report for one platform. Opens as an overlay; the Print button saves it as a PDF. */
export default function Report({ device, frames, incidents, mapPng, source, onClose }: Props) {
  const last = frames[frames.length - 1];
  const first = frames[0];
  const worst = frames.reduce((m, f) => (f.trust < m.trust ? f : m), frames[0]);
  const slots = frames.length ? last.s - first.s + 1 : 1;
  const reasons = new Map<string, { title: string; n: number; max: number }>();
  for (const f of frames) for (const r of f.why) {
    const e = reasons.get(r.code) ?? { title: r.title, n: 0, max: 0 };
    e.n += 1; e.max = Math.max(e.max, r.contribution); reasons.set(r.code, e);
  }
  const topReasons = [...reasons.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  const below = frames.filter((f) => f.trust < 50).length;

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  return (
    <div className="report-back" role="dialog" aria-label="Incident report">
      <div className="report-bar">
        <span>Incident report</span>
        <button className="btn sm primary" onClick={() => window.print()}>Print or save as PDF</button>
        <button className="iconbtn" onClick={onClose} aria-label="Close report"><IconClose size={16} /></button>
      </div>
      <article className="report">
        <header>
          <div className="report-brand">TrustNav</div>
          <h1>{device.name}</h1>
          <p className="report-sub">{device.id}, {device.kind === "drone" ? "survey drone" : "road vehicle"}. {source}. Generated {new Date().toLocaleString("en-GB")}.</p>
        </header>

        <section className="report-grid">
          <div className="report-stat"><b className="num">{last ? Math.round(last.trust) : "–"}</b><span>Trust now, {last ? STATUS_WORD[last.st].toLowerCase() : "no data"}</span></div>
          <div className="report-stat"><b className="num">{worst ? Math.round(worst.trust) : "–"}</b><span>Lowest in window{worst ? `, at ${clock(worst.t)}` : ""}</span></div>
          <div className="report-stat"><b className="num">{span(below)}</b><span>Below the alert line</span></div>
          <div className="report-stat"><b className="num">{incidents.length}</b><span>Incident{incidents.length === 1 ? "" : "s"} in window</span></div>
        </section>

        {mapPng && <img className="report-map" src={mapPng} alt="Map of the platform's reported track" />}

        <section>
          <h2>Trust over the window ({span(slots)})</h2>
          <TrustTape frames={frames} slots={slots} first={first?.s ?? 0} height={12}
            brackets={incidents.map((x) => ({ start: x.start, end: x.end, tone: "incident" as const }))} />
          <TrustChart frames={frames} slots={slots} first={first?.s ?? 0} height={110} />
          <ChartKey />
        </section>

        <section>
          <h2>Incidents</h2>
          {incidents.length === 0 ? <p className="quiet">No incident opened in this window.</p> : (
            <table>
              <thead><tr><th>Opened</th><th>Title</th><th>Severity</th><th>Status</th><th className="num">Lowest trust</th><th className="num">Length</th></tr></thead>
              <tbody>
                {incidents.map((x) => (
                  <tr key={x.start}>
                    <td className="num">{clock(x.opened_at)}</td><td>{x.title.replace(/: \d+ observations$/, "")}</td>
                    <td>{x.severity.toLowerCase()}</td><td>{x.status.toLowerCase()}</td>
                    <td className="num">{fmt(x.min_trust, 0)}</td><td className="num">{span(x.end - x.start + 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2>Evidence seen</h2>
          {topReasons.length === 0 ? <p className="quiet">No rule fired and the model saw nothing unusual.</p> : (
            <table>
              <thead><tr><th>Evidence</th><th className="num">Seconds present</th><th className="num">Peak contribution</th></tr></thead>
              <tbody>{topReasons.map((r) => <tr key={r.title}><td>{r.title}</td><td className="num">{r.n}</td><td className="num">+{Math.round(r.max)}</td></tr>)}</tbody>
            </table>
          )}
        </section>

        {last && (
          <section>
            <h2>Latest observation</h2>
            <p>At {clock(last.t)}: position {last.lat == null ? "no fix" : `${last.lat.toFixed(5)}, ${last.lon!.toFixed(5)}`}; speed {fmt(last.spd)} m/s; {last.sats ?? "–"} satellites; Galileo authentication {OSNMA_INFO[last.osnma].word.toLowerCase()}; rule risk {fmt(last.rr, 0)}, model risk {last.mr == null ? "–" : fmt(last.mr, 0)}, combined {fmt(last.hr, 0)}.</p>
          </section>
        )}

        <footer>TrustNav research prototype, ESAIP Angers. All data in this report is synthetic; attacks are simulated in software. The trust score is a research indicator, not a certified integrity figure.</footer>
      </article>
    </div>
  );
}
