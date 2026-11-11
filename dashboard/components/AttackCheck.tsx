"use client";

import { useEffect, useState } from "react";
import { span } from "@/lib/format";

interface Group { seconds: number; alert_seconds: number; below_trusted_seconds: number }
interface Det { key: string; exposures_alerted: number; exposures_below_trusted: number; alert_delay_median_s: number | null; tests_collapsed: Group; tests_no_fix: Group; no_test: Group; outside_normal_signal: Group }
interface Ublox { exposures: number; exposure_seconds: number; clean_cn0_median_dbhz: number; groups: Record<string, number>; detectors: Det[]; tests: { none: boolean; min_cn0_dbhz: number | null }[] }
interface Config { key: string; first_alert_delay_s: number | null; captured_refused: number; clean: { alert_seconds: number }; no_test: { alert_seconds: number }; handed_on_max_error_m: number | null; handed_on_median_error_m: number | null }
interface AttackData {
  repository: string;
  phone: {
    reference_check: { median_m: number; max_m: number };
    capture: { duration_s: number; fixes: number; silent_seconds: number; time_offset_median_s: number; offset_while_parked_m: number; reported_max_error_m: number; drive_off_after_s: number; cn0_before_dbhz: number; cn0_during_dbhz: number };
    clean_seconds: number; no_test_seconds: number;
    configurations: Config[];
    timeline: { rows: [number, number, number, number][] };
  };
  ublox_calibration: { seconds: number };
  ublox_jamming: Ublox; ublox_spoofing: Ublox;
}

const ROWS: [string, string][] = [
  ["published", "The 15 rules as first published"],
  ["odometer", "The same, with the car's speed as odometer"],
  ["hybrid_v21", "The same, with the model re-calibrated on this phone"],
  ["time", "16 rules: receiver time checked against the phone's own clock"],
];

/** Error of the reported position and of the position handed on, through the capture, on a log scale. */
function Chart({ rows, total, driveOff, held }: { rows: [number, number, number, number][]; total: number; driveOff: number; held: number }) {
  const W = 640, H = 380, L = 52, R = 16, T = 16, B = 40;
  const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
  const x = (s: number) => L + ((W - L - R) * s) / total;
  const y = (m: number) => T + (H - T - B) * (1 - (Math.log10(Math.max(1, m)) - 0) / 4.3);      // 1 m to 20 km
  const path = (k: 1 | 2) => rows.map((r, i) => `${i ? "L" : "M"}${x(r[0]).toFixed(1)} ${y(r[k]).toFixed(1)}`).join("");
  const last = rows[rows.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Position error through the capture: the phone's reported position ends ${km(last[1])} from the truth, the position TrustNav hands on stays within ${Math.round(held)} m`}>
      {[1, 10, 100, 1000, 10000].map((m) => (
        <g key={m}>
          <line x1={L} x2={W - R} y1={y(m)} y2={y(m)} stroke="var(--line)" strokeWidth="1" />
          <text x={L - 8} y={y(m) + 4} textAnchor="end" className="atk-tick">{m >= 1000 ? `${m / 1000} km` : `${m} m`}</text>
        </g>
      ))}
      {[0, 5, 10, 15, 20, 25].filter((m) => m * 60 <= total).map((m) => (
        <text key={m} x={x(m * 60)} y={H - B + 18} textAnchor="middle" className="atk-tick">{m} min</text>
      ))}
      <line x1={x(driveOff)} x2={x(driveOff)} y1={T} y2={H - B} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="4 4" />
      <text x={x(driveOff) + 6} y={T + 12} className="atk-tick">the car drives off</text>
      <path d={path(1)} fill="none" stroke="var(--untrusted)" strokeWidth="9" opacity=".14" strokeLinejoin="round" strokeLinecap="round" />
      <path d={path(1)} fill="none" stroke="var(--untrusted)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={path(2)} fill="none" stroke="var(--trusted)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <text x={x(last[0]) - 8} y={y(last[1]) - 8} textAnchor="end" className="atk-lab bad">what the phone reports: {km(last[1])} off</text>
      <text x={x(last[0]) - 8} y={y(held) - 12} textAnchor="end" className="atk-lab ok">what TrustNav hands on: within {Math.round(held)} m</text>
      <text x={L} y={H - 4} className="atk-tick">time since the spoofer captured the phone</text>
    </svg>
  );
}

/** The detector replayed on recordings of real jamming and real spoofing (Jammertest 2024, University of Vaasa). */
export default function AttackCheck() {
  const [d, setD] = useState<AttackData | null>(null);
  useEffect(() => { fetch("/data/attackcheck.json").then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null)); }, []);
  if (!d) return null;
  const p = d.phone, c = p.capture;
  const cfg = (k: string) => p.configurations.find((x) => x.key === k)!;
  const time = cfg("time"), full = cfg("full");
  const jam = d.ublox_jamming, spo = d.ublox_spoofing;
  const det = (u: Ublox, k: string) => u.detectors.find((x) => x.key === k)!;
  const jh = det(jam, "hybrid"), jr = det(jam, "rules"), sh = det(spo, "hybrid");
  const share = (a: number, b: number, digits = 0) => `${((100 * a) / Math.max(1, b)).toFixed(digits)}%`;
  const mins = (s: number) => Math.round(s / 60);
  const tenths = (s: number) => Math.floor(s / 6) / 10;            // 1 593 s reads "26.5", as in the paper
  return (
    <section className="real atk" aria-labelledby="atk-h">
      <h2 id="atk-h">On recordings of real attacks</h2>
      <p>
        The tables above come from a simulator. What follows does not. At Jammertest 2024 in Norway the authorities let jammers and spoofers transmit, and the
        University of Vaasa recorded a u-blox receiver and a phone in a car through it. The recordings were replayed through the same adapter and detector.
      </p>

      <h3 className="atk-sub">A phone captured by a spoofer for {tenths(c.duration_s)} minutes</h3>
      <div className="real-grid">
        <figure className="real-map">
          <Chart rows={p.timeline.rows} total={c.duration_s} driveOff={c.drive_off_after_s} held={full.handed_on_max_error_m ?? 0} />
          <figcaption>
            <span>The spoofer set the phone&apos;s clock back {mins(Math.abs(c.time_offset_median_s))} minutes and its position {Math.round(c.offset_while_parked_m)} m aside. When the car drove off, the phone stayed where the spoofer had put it.</span>
          </figcaption>
        </figure>
        <div className="atk-side">
          <table className="atk-table">
            <thead><tr><th>Detector</th><th className="num">First alert</th><th className="num">Captured fixes refused</th></tr></thead>
            <tbody>
              {ROWS.map(([k, label]) => {
                const x = cfg(k);
                return (
                  <tr key={k} className={k === "time" ? "hl" : ""}>
                    <th scope="row">{label}</th>
                    <td className="num">{x.first_alert_delay_s == null ? "never" : x.first_alert_delay_s === 0 ? "same second" : `after ${span(x.first_alert_delay_s)}`}</td>
                    <td className="num">{x.captured_refused} of {c.fixes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="atk-read">
            The first version missed this attack. Nothing in the spoofed stream was physically impossible: a parked car that stays parked. What the spoofer could not
            hide was time, so a sixteenth rule now compares the receiver&apos;s time with the clock of the device it is plugged into.
            With it: {time.clean.alert_seconds === 0 ? "no alert" : `${time.clean.alert_seconds} alerts`} in the {mins(p.clean_seconds)} clean minutes before the capture
            and {time.no_test.alert_seconds === 0 ? "none" : time.no_test.alert_seconds} in the {mins(p.no_test_seconds)}-minute drive declared free of tests.
          </p>
        </div>
      </div>

      <h3 className="atk-sub">A u-blox receiver under real jamming, and beside the spoofer</h3>
      <div className="real-attacks">
        <div className="real-fact atk-fact">
          <b style={{ color: "var(--trusted)" }}>{jh.exposures_alerted} of {jam.exposures}</b>
          <div><strong>jamming exposures alerted</strong><span>Driving past parked jammers and starting inside a jammed area. The re-calibrated model alerts about {jh.alert_delay_median_s} s into an exposure and marks all {jh.exposures_below_trusted} as degraded. The rules alone alert on {jr.exposures_alerted}: this receiver&apos;s stream carries no jamming indicator.</span></div>
        </div>
        <div className="real-fact atk-fact">
          <b style={{ color: "var(--degraded)" }}>{share(sh.tests_collapsed.below_trusted_seconds, sh.tests_collapsed.seconds)}</b>
          <div><strong>of {mins(sh.tests_collapsed.seconds)} minutes beside the spoofer shown as degraded</strong><span>The u-blox in the same car saw its signal strength fall from {Math.round(spo.clean_cn0_median_dbhz)} to as low as {Math.round(Math.min(...spo.tests.filter((t) => !t.none && t.min_cn0_dbhz != null).map((t) => t.min_cn0_dbhz as number)))} dB-Hz but was not captured: its position stayed within {p.reference_check.max_m} m of a second phone all morning. TrustNav kept its position and lowered its trust; it went under the alert line in {share(sh.tests_collapsed.alert_seconds, sh.tests_collapsed.seconds)} of those seconds.</span></div>
        </div>
        <div className="real-fact atk-fact">
          <b style={{ color: "var(--ink)" }}>{share(jh.outside_normal_signal.alert_seconds, jh.outside_normal_signal.seconds, 1)}</b>
          <div><strong>false alerts with a normal signal</strong><span>Outside the tests: {jh.outside_normal_signal.alert_seconds} of {jh.outside_normal_signal.seconds.toLocaleString("en-GB")} seconds on the jamming day, {sh.outside_normal_signal.alert_seconds === 0 ? "none" : sh.outside_normal_signal.alert_seconds} of {sh.outside_normal_signal.seconds.toLocaleString("en-GB")} on the spoofing morning, {sh.no_test.alert_seconds === 0 ? "none" : sh.no_test.alert_seconds} in the {mins(sh.no_test.seconds)} minutes declared free of tests.</span></div>
        </div>
      </div>

      <p className="note">
        Recordings: VAARA, University of Vaasa (<a href={d.repository} target="_blank" rel="noreferrer">github.com/UniVaasaDigiEco/VAARA</a>), Jammertest 2024, Andøya, 10 and 11 September 2024; test times from the dataset&apos;s own log.
        The u-blox, which the spoofer did not capture, is the reference for the phone. The position handed on (within {Math.round(full.handed_on_max_error_m ?? 0)} m, median {full.handed_on_median_error_m} m, over
        {" "}{tenths(c.duration_s)} minutes including {c.silent_seconds} seconds in which the phone sent nothing) uses the car&apos;s speed as the odometer and its track as the route, so it is a best case.
        The model was re-calibrated on the {mins(d.ublox_calibration.seconds)} minutes the u-blox recorded before the first test; with so little clean data its risk cannot go above 69, which is why it alerts on
        exposures but not on every jammed second. A lost fix alone ({jh.tests_no_fix.seconds} s here) is held, not called an attack: a tunnel does the same. The recordings also exposed four defects in the adapter
        and the response layer, all fixed: a sentence glued to a binary frame was dropped, a missing satellite count was guessed, a hold was stepped per observation and not per second, and the position-jump limit ignored gaps.
      </p>
    </section>
  );
}
