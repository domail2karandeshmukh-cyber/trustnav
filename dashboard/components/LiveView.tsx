"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import MapView from "./MapView";
import { ChartKey, Evidence, OsnmaLine, Signals, StatusWord, TrustChart, TrustFigure, TrustTape } from "./Instruments";
import { DroneGlyph, IconBack, IconBell, IconChevron, IconClose, IconKey, IconReport, IconTarget, IconTimeline, VehicleGlyph } from "./Icons";
import Report from "./Report";
import { useToasts } from "./Toasts";
import { KEEP, useFleet, type Fleet } from "@/lib/useFleet";
import { supabase } from "@/lib/supabase";
import type { Device, Frame, Incident, RouteGeom, Status } from "@/lib/types";
import { STATUS_COLOR, STATUS_WORD, clock, fmt, mmss, span } from "@/lib/format";
import { useWide } from "@/lib/useWide";
import type { Theme } from "@/lib/useTheme";

export interface LiveHandle {
  devices: Device[];
  select: Dispatch<SetStateAction<string | null>>;
  selected: string | null;
  toggleFollow: () => void;
  toggleReport: () => void;
  toggleTimeline: () => void;
}

const ORDER: Status[] = ["UNTRUSTED", "SUSPICIOUS", "DEGRADED", "TRUSTED"];

export default function LiveView({ routes, theme, onHandle, visible }: { routes: Record<string, RouteGeom> | null; theme: Theme; onHandle?: (h: LiveHandle) => void; visible: boolean }) {
  const fleet = useFleet();
  const wide = useWide();
  const toasts = useToasts();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [alertsOpen, setAlertsOpen] = useState(true);
  const [follow, setFollow] = useState(false);
  const [timeline, setTimeline] = useState(false);
  const [report, setReport] = useState(false);
  const snap = useRef<(() => string | null) | null>(null);
  const seenInc = useRef<Set<string>>(new Set());
  const seenReady = useRef(false);
  const visibleRef = useRef(visible); visibleRef.current = visible;

  const latest = useMemo(() => {
    const m: Record<string, Frame> = {};
    for (const [id, arr] of Object.entries(fleet.frames)) if (arr.length) m[id] = arr[arr.length - 1];
    return m;
  }, [fleet.frames]);
  const active = useMemo(() => fleet.devices.filter((d) => latest[d.id]), [fleet.devices, latest]);
  const sorted = useMemo(() => active.slice().sort((a, b) => latest[a.id].trust - latest[b.id].trust || a.id.localeCompare(b.id)), [active, latest]);
  const attention = sorted.filter((d) => latest[d.id].trust < 75);
  const listed = filter === "all" ? sorted : attention;
  const counts = useMemo(() => {
    const c: Record<Status, number> = { TRUSTED: 0, DEGRADED: 0, SUSPICIOUS: 0, UNTRUSTED: 0 };
    active.forEach((d) => { c[latest[d.id].st] += 1; });
    return c;
  }, [active, latest]);

  // a run or loop restart clears history; drop a selection that no longer exists
  useEffect(() => { if (selected && fleet.source !== "connecting" && !latest[selected] && active.length) setSelected(null); }, [selected, latest, active.length, fleet.source]);

  const selDev = fleet.devices.find((d) => d.id === selected) ?? null;
  const selFrames = selected ? fleet.frames[selected] ?? [] : [];
  const sel = selFrames.length ? selFrames[selFrames.length - 1] : null;

  useEffect(() => { onHandle?.({
    devices: active, select: setSelected, selected,
    toggleFollow: () => setFollow((v) => !v),
    toggleReport: () => setReport((v) => !v && !!selectedRef.current),
    toggleTimeline: () => setTimeline((v) => !v),
  }); }, [active, selected, onHandle]);
  const selectedRef = useRef(selected); selectedRef.current = selected;

  // toast when a new incident opens (after the first paint, so a reload does not replay old ones)
  useEffect(() => {
    const open = fleet.incidents.filter((x) => x.status === "OPEN");
    if (!seenReady.current) {
      if (fleet.source !== "connecting") { open.forEach((x) => seenInc.current.add(x.device_id + x.start)); seenReady.current = true; }
      return;
    }
    for (const x of open) {
      const k = x.device_id + x.start;
      if (seenInc.current.has(k)) continue;
      seenInc.current.add(k);
      if (!visibleRef.current) continue;
      const dev = fleet.devices.find((d) => d.id === x.device_id);
      toasts.push({
        id: k, tone: x.severity === "CRITICAL" ? "critical" : "info", ttl: 12000,
        title: `${x.severity === "CRITICAL" ? "Critical" : x.severity === "HIGH" ? "High" : "Medium"}: ${incidentTitle(x)}`,
        body: `${dev?.name ?? x.device_id}, trust fell to ${fmt(x.min_trust, 0)}.`,
        action: { label: "Show", run: () => setSelected(x.device_id) },
      });
    }
  }, [fleet.incidents, fleet.devices, fleet.source, toasts]);

  // a fresh lap or run: forget the old incident keys
  useEffect(() => { seenInc.current.clear(); seenReady.current = false; }, [fleet.run?.id, fleet.source]);

  const mapRoutes = useMemo(() => {
    const slugs = [...new Set(active.map((d) => d.route_slug).filter(Boolean) as string[])];
    return slugs.filter((s) => routes?.[s]).map((s) => ({ id: s, points: routes![s].points }));
  }, [active, routes]);
  const tracks = useMemo(() => active.map((d) => ({ id: d.id, frames: (fleet.frames[d.id] ?? []).slice(-90), faded: !!selected && d.id !== selected })), [active, fleet.frames, selected]);
  const markers = useMemo(() => active.filter((d) => latest[d.id].lat != null).map((d) => {
    const f = latest[d.id];
    return { id: d.id, label: d.id, lat: f.lat!, lon: f.lon!, status: f.st, heading: f.hdg, kind: d.kind, alarm: f.trust < 50, selected: d.id === selected };
  }), [active, latest, selected]);
  const focus = sel?.lat != null && selected ? { lat: sel.lat, lon: sel.lon!, key: selected } : null;
  const fitKey = `${fleet.source}:${fleet.run?.id ?? "loop"}:${active.length > 0}`;

  const open = fleet.incidents.filter((x) => x.status === "OPEN");
  const name = (id: string) => fleet.devices.find((d) => d.id === id)?.name ?? id;

  const alerts = <AlertFeed incidents={fleet.incidents} name={name} onPick={setSelected} />;
  const headline = fleet.source === "connecting" ? null
    : counts.UNTRUSTED + counts.SUSPICIOUS === 0 && counts.DEGRADED === 0 ? `All ${active.length} platforms trusted`
    : counts.UNTRUSTED > 0 ? `${counts.UNTRUSTED} platform${counts.UNTRUSTED > 1 ? "s" : ""} untrusted: ${sorted.filter((d) => latest[d.id].st === "UNTRUSTED").map((d) => d.name).join(", ")}`
    : counts.SUSPICIOUS > 0 ? `${counts.SUSPICIOUS} suspicious: ${sorted.filter((d) => latest[d.id].st === "SUSPICIOUS").map((d) => d.name).join(", ")}`
    : `${counts.DEGRADED} degraded, nothing suspicious`;

  return (
    <div className="workspace">
      <aside className="panel" aria-label={selDev ? `${selDev.name} details` : "Fleet"}>
        {selDev ? (
          <DeviceDetail device={selDev} frames={selFrames} incidents={fleet.incidents.filter((x) => x.device_id === selDev.id)}
            routeName={selDev.route_slug ? routes?.[selDev.route_slug]?.name.split(" (")[0] : undefined} onBack={() => setSelected(null)}
            follow={follow} onFollow={() => setFollow((v) => !v)} onReport={() => setReport(true)} />
        ) : (
          <>
            <header className="panel-head">
              <div><h1>Fleet</h1>{headline && <p className="headline" aria-live="polite">{headline}</p>}</div>
              <div className="seg" role="group" aria-label="Filter platforms">
                <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All <span className="num">{sorted.length}</span></button>
                <button aria-pressed={filter === "attention"} onClick={() => setFilter("attention")}>Needs attention <span className="num">{attention.length}</span></button>
              </div>
            </header>
            {!wide && open.length > 0 && <div className="panel-sec">{alerts}</div>}
            {fleet.source === "connecting" ? (
              <div className="rows">{[0, 1, 2, 3].map((i) => <div key={i} className="row skeleton" />)}</div>
            ) : listed.length === 0 ? (
              <p className="empty">{filter === "attention" ? "Every platform is trusted right now." : "No platform is reporting."}</p>
            ) : (
              <ul className="rows">
                {listed.map((d) => <FleetRow key={d.id} device={d} frames={fleet.frames[d.id] ?? []} routes={routes} onPick={() => setSelected(d.id)} />)}
              </ul>
            )}
            <p className="panel-foot">Sorted by trust, lowest first. Each strip shows the last two minutes, one cell per second.</p>
          </>
        )}
      </aside>

      <section className="stage-map">
        <MapView fitKey={fitKey} routes={mapRoutes} tracks={tracks} markers={markers} onMarkerClick={setSelected} focus={focus} theme={theme}
          follow={follow && selected ? selected : null} glideMs={visible ? 950 : 0} onSnapshot={(fn) => { snap.current = fn; }}
          padding={wide ? { top: 40, right: alertsOpen ? 360 : 60, bottom: 90, left: 40 } : { top: 30, right: 30, bottom: 30, left: 30 }} />
        {wide && (
          <div className={`float alerts-float${alertsOpen ? "" : " closed"}`}>
            <button className="float-head" onClick={() => setAlertsOpen((v) => !v)} aria-expanded={alertsOpen}>
              <IconBell size={17} />
              <span>Alerts</span>
              {open.length > 0 && <span className="badge num">{open.length} open</span>}
              <IconChevron size={16} style={{ marginLeft: "auto", transform: alertsOpen ? "rotate(90deg)" : undefined }} />
            </button>
            {alertsOpen && <div className="float-body">{alerts}</div>}
          </div>
        )}
        {wide && timeline && sorted.length > 0 && (
          <div className="float timeline" aria-label="Fleet timeline">
            <div className="timeline-head"><b>Fleet timeline</b><span>Last five minutes, every platform, one cell per second. Brackets are incidents.</span></div>
            {sorted.map((d) => {
              const fr = fleet.frames[d.id] ?? [];
              const last = fr[fr.length - 1];
              const inc = fleet.incidents.filter((x) => x.device_id === d.id).map((x) => ({ start: x.start, end: x.status === "OPEN" ? last.s : x.end, tone: "incident" as const }));
              return (
                <button key={d.id} className={`tl-row${d.id === selected ? " on" : ""}`} onClick={() => setSelected(d.id)}>
                  <span className="tl-name">{d.name}</span>
                  <span className="tl-tape"><TrustTape frames={fr} slots={KEEP} first={last.s - (KEEP - 1)} height={9} brackets={inc} /></span>
                  <span className="tl-trust num" style={{ color: STATUS_COLOR[last.st] }}>{Math.round(last.trust)}</span>
                </button>
              );
            })}
          </div>
        )}
        <StatusStrip fleet={fleet} counts={counts} timeline={timeline} onTimeline={() => setTimeline((v) => !v)} lastFix={Math.max(0, ...Object.values(latest).map((f) => new Date(f.t ?? 0).getTime()))} />
      </section>
      {report && selDev && (
        <Report device={selDev} frames={selFrames} incidents={fleet.incidents.filter((x) => x.device_id === selDev.id)}
          mapPng={snap.current?.() ?? null} onClose={() => setReport(false)}
          source={fleet.source === "live" ? "Live cloud feed" : "Recorded demo"} />
      )}
    </div>
  );
}

function FleetRow({ device, frames, routes, onPick }: { device: Device; frames: Frame[]; routes: Record<string, RouteGeom> | null; onPick: () => void }) {
  const f = frames[frames.length - 1];
  const tail = frames.slice(-120);
  const route = device.route_slug ? routes?.[device.route_slug]?.name.split(" (")[0] : null;
  return (
    <li>
      <button className="row" onClick={onPick}>
        <span className="row-glyph" style={{ color: STATUS_COLOR[f.st] }}>
          {device.kind === "drone" ? <DroneGlyph size={20} /> : <VehicleGlyph size={20} />}
        </span>
        <span className="row-main">
          <span className="row-name">{device.name}</span>
          <span className="row-sub">{device.id}{route ? `, ${route}` : ""}</span>
        </span>
        <span className="row-right">
          <span className="row-trust num" style={{ color: STATUS_COLOR[f.st] }}>{Math.round(f.trust)}</span>
          <StatusWord st={f.st} />
        </span>
        <span className="row-tape"><TrustTape frames={tail} slots={120} first={f.s - 119} height={8} /></span>
      </button>
    </li>
  );
}

function sinceText(frames: Frame[]) {
  if (!frames.length) return null;
  const last = frames[frames.length - 1];
  let i = frames.length - 1;
  while (i > 0 && frames[i - 1].st === last.st) i--;
  const secs = last.s - frames[i].s;
  if (i === 0 && frames.length >= KEEP) return `${STATUS_WORD[last.st]} for over ${span(KEEP)}`;
  return `${STATUS_WORD[last.st]} for ${span(secs)}`;
}

function DeviceDetail({ device, frames, incidents, routeName, onBack, follow, onFollow, onReport }: {
  device: Device; frames: Frame[]; incidents: Incident[]; routeName?: string; onBack: () => void;
  follow: boolean; onFollow: () => void; onReport: () => void;
}) {
  const f = frames[frames.length - 1] ?? null;
  const first = f ? f.s - (KEEP - 1) : 0;
  const brackets = incidents.map((x) => ({ start: x.start, end: x.status === "OPEN" ? f?.s ?? x.end : x.end, tone: "incident" as const }));
  return (
    <div className="detail">
      <header className="detail-head">
        <button className="iconbtn" onClick={onBack} aria-label="Back to fleet"><IconBack /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{device.name}</h1>
          <p>{device.id}, {device.kind === "drone" ? "survey drone" : "road vehicle"}{routeName ? ` on ${routeName}` : ""}</p>
        </div>
        <div className="detail-actions">
          <button className={`iconbtn${follow ? " on" : ""}`} onClick={onFollow} aria-pressed={follow} aria-label="Follow on the map" title={follow ? "Stop following" : "Follow on the map (F)"}><IconTarget size={17} /></button>
          <button className="iconbtn" onClick={onReport} aria-label="Incident report" title="Incident report (R)"><IconReport size={17} /></button>
        </div>
      </header>
      <TrustFigure frame={f} since={sinceText(frames)} />
      <section className="panel-sec">
        <div className="sec-head"><h2>Last five minutes</h2>{f?.t && <span className="num">{clock(f.t)}</span>}</div>
        <TrustTape frames={frames} slots={KEEP} first={first} height={12} brackets={brackets} />
        <TrustChart frames={frames} slots={KEEP} first={first} height={96} />
        <ChartKey />
      </section>
      <section className="panel-sec">
        <h2>Why</h2>
        <Evidence frame={f} />
      </section>
      <section className="panel-sec"><OsnmaLine status={f?.osnma ?? null} /></section>
      {incidents.length > 0 && (
        <section className="panel-sec">
          <h2>Incidents</h2>
          <ul className="incs">
            {incidents.map((x) => <IncidentItem key={x.start} x={x} />)}
          </ul>
        </section>
      )}
      <section className="panel-sec">
        <h2>Measurements</h2>
        <Signals frame={f} extra={f?.atk == null ? undefined : [["Simulator truth", f.atk ? "Under attack" : "Clean"]]} />
      </section>
    </div>
  );
}

function incidentTitle(x: Incident) { return x.title.replace(/: \d+ observations$/, ""); }

function IncidentItem({ x, name, onPick }: { x: Incident; name?: string; onPick?: () => void }) {
  const body = (
    <>
      <span className="inc-sev" style={{ background: x.severity === "CRITICAL" ? "var(--untrusted)" : x.severity === "HIGH" ? "var(--suspicious)" : "var(--degraded)" }} />
      <span className="inc-main">
        <span className="inc-title">{incidentTitle(x)}</span>
        <span className="inc-sub">
          {name && <b>{name}</b>}
          {x.status === "OPEN" ? <span className="open">Open since {clock(x.opened_at)}</span> : <span>Resolved after {span(x.end - x.start + 1)}</span>}
        </span>
      </span>
      <span className="inc-min num" title="Lowest trust during the incident">{fmt(x.min_trust, 0)}<small>lowest</small></span>
    </>
  );
  return <li>{onPick ? <button className="inc" onClick={onPick}>{body}</button> : <div className="inc">{body}</div>}</li>;
}

function AlertFeed({ incidents, name, onPick }: { incidents: Incident[]; name: (id: string) => string; onPick: (id: string) => void }) {
  const list = incidents.slice().sort((a, b) => (a.status === b.status ? b.opened_at.localeCompare(a.opened_at) : a.status === "OPEN" ? -1 : 1));
  if (!list.length) return <p className="empty small">No alerts yet. An alert opens when a platform stays below trust 50 for three seconds.</p>;
  return (
    <ul className="incs">
      {list.slice(0, 12).map((x) => <IncidentItem key={x.device_id + x.start} x={x} name={name(x.device_id)} onPick={() => onPick(x.device_id)} />)}
    </ul>
  );
}

function StatusStrip({ fleet, counts, timeline, onTimeline, lastFix }: { fleet: Fleet; counts: Record<Status, number>; timeline: boolean; onTimeline: () => void; lastFix: number }) {
  const [presenter, setPresenter] = useState(false);
  const [health, setHealth] = useState(false);
  const age = lastFix ? Math.max(0, (Date.now() - lastFix) / 1000) : null;
  const label = fleet.source === "live" ? "Live from the cloud" : fleet.source === "loop" ? "Recorded demo, looping" : "Connecting";
  return (
    <div className="float strip">
      <button className={`src ${fleet.source}`} onClick={() => setHealth((v) => !v)} aria-expanded={health} title="System health"><i />{label}</button>
      {health && (
        <div className="pop health" role="dialog" aria-label="System health">
          <div className="pop-head"><b>System health</b><button className="iconbtn" onClick={() => setHealth(false)} aria-label="Close"><IconClose size={16} /></button></div>
          <dl className="facts">
            <div><dt>Data source</dt><dd>{label}</dd></div>
            <div><dt>Realtime channel</dt><dd style={{ color: fleet.realtime === "up" ? "var(--trusted)" : fleet.realtime === "down" ? "var(--untrusted)" : undefined }}>{fleet.realtime === "up" ? "Connected" : fleet.realtime === "down" ? "Unreachable" : "Connecting"}</dd></div>
            <div><dt>Last fix received</dt><dd className="num">{age == null ? "–" : age < 2.5 ? "just now" : `${age.toFixed(0)} s ago`}</dd></div>
            <div><dt>Platforms reporting</dt><dd className="num">{Object.values(counts).reduce((a, b) => a + b, 0)}</dd></div>
            <div><dt>Run</dt><dd>{fleet.run ? fleet.run.label : "Recorded demo loop"}</dd></div>
            {fleet.run?.engine_version && <div><dt>Engine</dt><dd>{fleet.run.engine_version}</dd></div>}
          </dl>
          <p>Reads are public and synthetic. Writes need the ingest token or the presenter passcode.</p>
        </div>
      )}
      {fleet.source !== "connecting" && <span className="num strip-time">{mmss(fleet.elapsed)}{fleet.duration ? ` / ${mmss(fleet.duration)}` : ""}</span>}
      <span className="strip-counts">
        {ORDER.filter((s) => counts[s] > 0).map((s) => (
          <span key={s} title={STATUS_WORD[s]}><i style={{ background: STATUS_COLOR[s] }} /><span className="num">{counts[s]}</span> {STATUS_WORD[s].toLowerCase()}</span>
        ))}
      </span>
      <span className="strip-note">Attacks are simulated</span>
      <button className={`iconbtn${timeline ? " on" : ""}`} onClick={onTimeline} aria-pressed={timeline} aria-label="Fleet timeline" title="Fleet timeline (T)"><IconTimeline size={18} /></button>
      <button className="iconbtn" onClick={() => setPresenter((v) => !v)} aria-expanded={presenter} aria-label="Presenter controls" title="Presenter controls"><IconKey size={18} /></button>
      {presenter && <Presenter running={fleet.source === "live" && fleet.run?.mode === "demo_feed"} onClose={() => setPresenter(false)} />}
    </div>
  );
}

function Presenter({ running, onClose }: { running: boolean; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { try { const c = sessionStorage.getItem("trustnav-presenter"); if (c) setCode(c); } catch { /* storage blocked */ } }, []);
  const call = async (fn: "start_demo_feed" | "stop_demo_feed") => {
    setBusy(true); setMsg(null);
    try {
      const { error } = await supabase().rpc(fn, { passcode: code });
      if (error) { setMsg(error.message.includes("too many") ? "Too many wrong passcodes. Try again in 10 minutes." : "Passcode not accepted."); return; }
      try { sessionStorage.setItem("trustnav-presenter", code); } catch { /* storage blocked */ }
      setMsg(fn === "start_demo_feed" ? "Live feed started. The first attack arrives at about 1:37." : "Live feed stopped.");
    } catch {
      setMsg("The live database is unreachable from this network.");
    } finally { setBusy(false); }
  };
  return (
    <div className="pop" role="dialog" aria-label="Presenter controls">
      <div className="pop-head"><b>Presenter</b><button className="iconbtn" onClick={onClose} aria-label="Close"><IconClose size={16} /></button></div>
      <p>Streams seven platforms over Angers from the cloud, about seven minutes, with staggered attacks.</p>
      <form onSubmit={(e) => { e.preventDefault(); call("start_demo_feed"); }}>
        <input className="input" type="password" placeholder="Passcode" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Presenter passcode" autoComplete="off" />
        <div className="pop-actions">
          <button className="btn primary" type="submit" disabled={busy || !code}>{running ? "Restart live feed" : "Start live feed"}</button>
          {running && <button className="btn" type="button" disabled={busy || !code} onClick={() => call("stop_demo_feed")}>Stop</button>}
        </div>
      </form>
      {msg && <p className="pop-msg" role="status">{msg}</p>}
    </div>
  );
}
