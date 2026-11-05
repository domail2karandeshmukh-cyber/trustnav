"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import MapView, { type CameraApi } from "./MapView";
import type { ExplainApi } from "./Explainer";
import SpaceTime from "./SpaceTime";
import { ChartKey, Evidence, OsnmaLine, PlainVerdict, ResponseLine, Signals, StatusWord, TrustChart, TrustFigure, TrustTape } from "./Instruments";
import { plainFleet, plainVerdict, thingOf } from "@/lib/plain";
import { useNarrate, useVoicePref } from "@/lib/useVoice";
import { DroneGlyph, IconBack, IconBell, IconChevron, IconClose, IconKey, IconMute, IconPlay, IconReport, IconTarget, IconTimeline, IconVoice, VehicleGlyph } from "./Icons";
import Report from "./Report";
import { useToasts } from "./Toasts";
import { KEEP, useFleet, type Fleet } from "@/lib/useFleet";
import { supabase } from "@/lib/supabase";
import type { Device, Frame, Incident, RouteGeom, Status } from "@/lib/types";
import { STATUS_COLOR, STATUS_HEX, STATUS_WORD, clock, dist, fmt, mmss, span } from "@/lib/format";
import { useWide } from "@/lib/useWide";
import type { Theme } from "@/lib/useTheme";

export interface LiveHandle {
  devices: Device[];
  select: Dispatch<SetStateAction<string | null>>;
  selected: string | null;
  toggleFollow: () => void;
  toggleReport: () => void;
  toggleTimeline: () => void;
  togglePresent: () => void;
  /** what the narrated explainer may do to this view */
  explain: ExplainApi;
}

const ORDER: Status[] = ["UNTRUSTED", "SUSPICIOUS", "DEGRADED", "TRUSTED"];

export default function LiveView({ routes, theme, onHandle, visible, onGuide }: { routes: Record<string, RouteGeom> | null; theme: Theme; onHandle?: (h: LiveHandle) => void; visible: boolean; onGuide: () => void }) {
  const fleet = useFleet();
  const wide = useWide();
  const toasts = useToasts();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [alertsOpen, setAlertsOpen] = useState(true);
  const [follow, setFollow] = useState(false);
  const [timeline, setTimeline] = useState(false);
  const [stage, setStage] = useState<"map" | "st">("map");
  const [report, setReport] = useState(false);
  const [present, setPresent] = useState(false);
  const [presentBearing, setPresentBearing] = useState(0);
  const [acked, setAcked] = useState<Set<string>>(() => new Set());
  const [explaining, setExplaining] = useState(false);
  const [voice, setVoice] = useVoicePref();
  const snap = useRef<(() => string | null) | null>(null);
  const seenInc = useRef<Set<string>>(new Set());
  const seenReady = useRef(false);
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const presentRef = useRef(false); presentRef.current = present;
  const cam = useRef<CameraApi | null>(null);

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

  // any manual choice ends a presentation
  const pick: Dispatch<SetStateAction<string | null>> = (v) => { setPresent(false); setSelected(v); };
  // the explainer reads live data through refs so its functions stay stable
  const latestRef = useRef(latest); latestRef.current = latest;
  const activeRef = useRef(active); activeRef.current = active;
  const explain = useMemo<ExplainApi>(() => ({
    fitAll: () => { setPresent(false); setStage("map"); setFollow(false); setSelected(null); setTimeout(() => cam.current?.fit(), 50); },
    selectTrusted: () => {
      const l = latestRef.current;
      const d = activeRef.current.filter((x) => l[x.id]?.lat != null && l[x.id].resp?.mode !== "hold").sort((a, b) => l[b.id].trust - l[a.id].trust)[0];
      if (!d) return null;
      setPresent(false); setStage("map"); setSelected(d.id);
      return { name: d.name, trust: l[d.id].trust };
    },
    selectHeld: () => {
      const l = latestRef.current;
      const d = activeRef.current.filter((x) => l[x.id]?.resp?.mode === "hold" && l[x.id].resp?.lat != null).sort((a, b) => (l[b.id].resp?.gap_m ?? 0) - (l[a.id].resp?.gap_m ?? 0))[0];
      if (!d) return null;
      setPresent(false); setStage("map"); setSelected(d.id);
      const g = l[d.id].resp?.gap_m;
      return { name: d.name, gap: g != null ? dist(g) : "" };
    },
    deselect: () => { setSelected(null); setFollow(false); },
    openAlerts: () => setAlertsOpen(true),
    setActive: (on) => setExplaining(on),
  }), []);
  useEffect(() => { onHandle?.({
    devices: active, select: pick, selected,
    toggleFollow: () => setFollow((v) => !v),
    toggleReport: () => setReport((v) => !v && !!selectedRef.current),
    toggleTimeline: () => setTimeline((v) => !v),
    togglePresent: () => setPresent((v) => !v),
    explain,
  }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selected, onHandle, explain]);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  // Esc deselects before the report's own listener runs, so the report state must follow the selection
  useEffect(() => { if (!selected) setReport(false); }, [selected]);

  // presentation mode: the camera visits every platform, incidents first, eight seconds each
  const sortedRef = useRef(sorted); sortedRef.current = sorted;
  const openIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!present) return;
    let i = -1, bearing = 20;
    const step = () => {
      const openIds = openIdsRef.current;
      const ids = [...sortedRef.current.filter((d) => openIds.has(d.id)), ...sortedRef.current.filter((d) => !openIds.has(d.id))].map((d) => d.id);
      if (!ids.length) return;
      i = (i + 1) % ids.length;
      bearing = (bearing + 47) % 360;
      setPresentBearing(bearing);
      setSelected(ids[i]);
    };
    step();
    setFollow(true);
    seenInc.current.forEach((k) => toasts.dismiss(k));
    const t = setInterval(step, 8000);
    return () => { clearInterval(t); setFollow(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present]);

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
      if (!visibleRef.current || presentRef.current) continue;
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
    return { id: d.id, label: d.id, lat: f.lat!, lon: f.lon!, status: f.st, heading: f.hdg, kind: d.kind, alarm: f.trust < 50, selected: d.id === selected,
      trust: f.trust, held: f.resp?.mode === "hold" };
  }), [active, latest, selected]);
  // the response layer, live: where each refused platform really is (as far as the odometer knows)
  const shields = useMemo(() => active.flatMap((d) => {
    const f = latest[d.id];
    const r = f.resp;
    if (!r || r.mode !== "hold" || r.lat == null) return [];
    const from: [number, number] | undefined = f.lat != null ? [f.lat, f.lon!] : undefined;
    return [{ id: d.id, lat: r.lat, lon: r.lon!, from, label: r.gap_m != null ? `${dist(r.gap_m)} refused` : `estimate, ${span(r.held_s)}` }];
  }), [active, latest]);
  const protectedPath = useMemo(() => {
    const segs: [number, number][][] = [];
    for (const d of active) {
      let cur: [number, number][] = [];
      for (const f of (fleet.frames[d.id] ?? []).slice(-90)) {
        const r = f.resp;
        if (r && r.mode === "hold" && r.lat != null && r.lon != null) cur.push([r.lat, r.lon]);
        else if (cur.length) { segs.push(cur); cur = []; }
      }
      if (cur.length) segs.push(cur);
    }
    return segs;
  }, [active, fleet.frames]);
  const held = shields.length;
  const worstLie = Math.max(0, ...active.map((d) => latest[d.id].resp?.gap_m ?? 0).filter((g) => g != null));
  const spoken = present && selDev && sel ? (() => { const v = plainVerdict(sel, thingOf(selDev)); return `${selDev.name}, ${STATUS_WORD[sel.st].toLowerCase()}, trust ${Math.round(sel.trust)}. ${v ? `${v.title}. ${v.body}` : ""}`; })() : null;
  useNarrate(spoken, "en-GB", present && voice && !explaining);
  const lie = sel?.resp && sel.resp.mode === "hold" && sel.resp.lat != null && sel.lat != null && (sel.resp.gap_m ?? 0) > 250
    ? [[sel.lat, sel.lon!], [sel.resp.lat, sel.resp.lon!]] as [number, number][] : undefined;
  const focus = sel?.lat != null && selected ? { lat: sel.lat, lon: sel.lon!, key: present ? `${selected}:${presentBearing}` : selected, bearing: present ? presentBearing : undefined, zoom: present ? 15.4 : undefined, bounds: lie } : null;
  const fitKey = `${fleet.source}:${fleet.run?.id ?? "loop"}:${active.length > 0}`;

  const open = fleet.incidents.filter((x) => x.status === "OPEN");
  openIdsRef.current = new Set(open.map((x) => x.device_id));
  const name = (id: string) => fleet.devices.find((d) => d.id === id)?.name ?? id;
  const ack = (k: string) => setAcked((prev) => { const n = new Set(prev); n.add(k); return n; });

  const alerts = <AlertFeed incidents={fleet.incidents} name={name} onPick={pick} frames={fleet.frames} latest={latest} acked={acked} onAck={ack} />;
  const meanTrust = active.length ? active.reduce((a, d) => a + latest[d.id].trust, 0) / active.length : null;
  const headline = fleet.source === "connecting" ? null
    : plainFleet(active.length, {
      untrusted: sorted.filter((d) => latest[d.id].st === "UNTRUSTED").map((d) => d.name),
      suspicious: sorted.filter((d) => latest[d.id].st === "SUSPICIOUS").map((d) => d.name),
      degraded: counts.DEGRADED,
    }, held);

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
            <p className="panel-blurb">TrustNav checks, every second, whether each vehicle&apos;s satellite position can be believed, and refuses the ones that cannot. <button className="link" onClick={onGuide}>How to read this screen</button></p>
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
        {!wide && (
          <div className="seg stage-toggle" role="group" aria-label="View">
            <button aria-pressed={stage === "map"} onClick={() => setStage("map")}>Map</button>
            <button aria-pressed={stage === "st"} onClick={() => setStage("st")}>Space-time</button>
          </div>
        )}
        {stage === "st" && (
          <SpaceTime fitKey={fitKey} theme={theme} first={Math.max(0, (Math.max(0, ...Object.values(latest).map((f) => f.s))) - (KEEP - 1))} slots={KEEP}
            routes={mapRoutes} onPick={setSelected}
            tracks={active.map((d) => ({ id: d.id, label: d.id, kind: d.kind, frames: fleet.frames[d.id] ?? [], selected: d.id === selected, faded: !!selected && d.id !== selected }))} />
        )}
        <div className="stage-mapwrap" hidden={stage !== "map"}>
        <MapView fitKey={fitKey} routes={mapRoutes} tracks={tracks} markers={markers} onMarkerClick={pick} focus={focus} theme={theme} shields={shields} protectedPath={protectedPath}
          follow={follow && selected ? selected : null} glideMs={visible && stage === "map" ? 950 : 0} onSnapshot={(fn) => { snap.current = fn; }} onCamera={(a) => { cam.current = a; }}
          padding={wide ? { top: 110, right: alertsOpen ? 360 : 60, bottom: present || explaining ? 300 : 90, left: 40 } : { top: 30, right: 30, bottom: 30, left: 30 }} />
        </div>
        {wide && fleet.source !== "connecting" && stage === "map" && (
          <FleetKpis trust={meanTrust} counts={counts} open={open.length} held={held} worstLie={worstLie} />
        )}
        {wide && fleet.source !== "connecting" && stage === "map" && (
          <div className="float live-legend" aria-label="Map legend">
            <span><i className="lg-ring" style={{ borderColor: STATUS_COLOR.TRUSTED }} />trusted</span>
            <span><i className="lg-ring" style={{ borderColor: STATUS_COLOR.DEGRADED }} />doubts</span>
            <span><i className="lg-ring" style={{ borderColor: STATUS_COLOR.SUSPICIOUS }} />suspicious</span>
            <span><i className="lg-ring" style={{ borderColor: STATUS_COLOR.UNTRUSTED }} />untrusted</span>
            <span><i className="lg-ring hollow" style={{ borderColor: STATUS_COLOR.UNTRUSTED }} />refused fix</span>
            <span><i className="lg-shield" />real position</span>
            <button className="link" onClick={onGuide}>Guide</button>
          </div>
        )}
        {present && selDev && sel && (
          <div className="caption present" role="status" aria-live="polite" key={selDev.id}>
            <div className="present-head"><span className="present-kicker">Presentation</span><span className="present-count">{sorted.findIndex((d) => d.id === selDev.id) + 1} / {sorted.length}</span></div>
            <h3>{selDev.name} <span style={{ color: STATUS_COLOR[sel.st] }}>{STATUS_WORD[sel.st].toLowerCase()}, trust {Math.round(sel.trust)}</span></h3>
            <p>{sel.why[0] ? `${sel.why[0].title}: ${sel.why[0].detail.split(". ")[0].replace(/\.$/, "")}.` : "Every check passes: position, motion, signal and Galileo authentication agree."}
              {sel.resp && sel.resp.mode === "hold" ? ` Response: ${sel.resp.action === "ISOLATE" ? "isolated" : "held for verification"}; the position in use is estimated from the odometer${sel.resp.gap_m != null ? `, a ${dist(sel.resp.gap_m)} lie refused` : ""}.` : ""}</p>
            <div className="caption-actions"><span className="caption-hint">Esc stops. Any click stops.</span>
              <button className={`iconbtn voice-btn${voice ? " on" : ""}`} onClick={() => setVoice(!voice)} aria-pressed={voice} aria-label={voice ? "Voice on" : "Voice off"} title={voice ? "Voice on: click to mute" : "Voice off: click to read aloud"}>{voice ? <IconVoice size={15} /> : <IconMute size={15} />}</button>
              <button className="btn sm" onClick={() => setPresent(false)}>Stop</button></div>
          </div>
        )}
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
        <StatusStrip fleet={fleet} counts={counts} timeline={timeline} onTimeline={() => setTimeline((v) => !v)} present={present} onPresent={() => setPresent((v) => !v)}
          lastFix={Math.max(0, ...Object.values(latest).map((f) => new Date(f.t ?? 0).getTime()))}
          view={wide ? (
            <div className="seg stage-toggle" role="group" aria-label="View">
              <button aria-pressed={stage === "map"} onClick={() => setStage("map")}>Map</button>
              <button aria-pressed={stage === "st"} onClick={() => setStage("st")}>Space-time</button>
            </div>
          ) : null} />
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
          <p>{device.id}, {thingOf(device) === "drone" ? "survey drone" : thingOf(device) === "phone" ? "phone receiver" : "road vehicle"}{routeName ? ` on ${routeName}` : ""}</p>
        </div>
        <div className="detail-actions">
          <button className={`iconbtn${follow ? " on" : ""}`} onClick={onFollow} aria-pressed={follow} aria-label="Follow on the map" title={follow ? "Stop following" : "Follow on the map (F)"}><IconTarget size={17} /></button>
          <button className="iconbtn" onClick={onReport} aria-label="Incident report" title="Incident report (R)"><IconReport size={17} /></button>
        </div>
      </header>
      <TrustFigure frame={f} since={sinceText(frames)} />
      <PlainVerdict frame={f} kind={thingOf(device)} />
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
      {f?.resp && <section className="panel-sec"><ResponseLine frame={f} kind={device.kind} /></section>}
      {f?.resp && f.resp.action !== "CONTINUE" && <section className="panel-sec"><Playbook kind={device.kind} action={f.resp.action} id={`${device.id}:${incidents.find((x) => x.status === "OPEN")?.start ?? "hold"}`} /></section>}
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

function Sparkline({ frames, status }: { frames: Frame[]; status: Status }) {
  const w = 72, h = 22;
  const pts = frames.slice(-60);
  if (pts.length < 2) return null;
  const d = pts.map((f, i) => `${(i / (pts.length - 1)) * w},${h - (f.trust / 100) * (h - 2) - 1}`).join(" ");
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <line x1="0" x2={w} y1={h - 0.5 * (h - 2) - 1} y2={h - 0.5 * (h - 2) - 1} className="spark-line" />
      <polyline points={d} fill="none" stroke={STATUS_HEX[status]} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function IncidentItem({ x, name, onPick, spark, status, action, acked, onAck }: {
  x: Incident; name?: string; onPick?: () => void; spark?: Frame[]; status?: Status; action?: "VERIFY" | "ISOLATE" | null; acked?: boolean; onAck?: () => void;
}) {
  const body = (
    <>
      <span className="inc-sev" style={{ background: x.severity === "CRITICAL" ? "var(--untrusted)" : x.severity === "HIGH" ? "var(--suspicious)" : "var(--degraded)" }} />
      <span className="inc-main">
        <span className="inc-title">{incidentTitle(x)}</span>
        <span className="inc-sub">
          {name && <b>{name}</b>}
          {x.status === "OPEN" ? <span className="open">Open since {clock(x.opened_at)}</span> : <span>Resolved after {span(x.end - x.start + 1)}</span>}
          {x.status === "OPEN" && action && <span className={`act ${action}`}>{action === "ISOLATE" ? "Isolated" : "Verify"}</span>}
          {acked && <span className="acked">Acknowledged</span>}
        </span>
      </span>
      {spark && status && <Sparkline frames={spark} status={status} />}
      <span className="inc-min num" title="Lowest trust during the incident">{fmt(x.min_trust, 0)}<small>lowest</small></span>
    </>
  );
  return (
    <li className={`inc-row${acked ? " is-acked" : ""}`}>
      {onPick ? <button className={`inc${spark ? " with-spark" : ""}`} onClick={onPick}>{body}</button> : <div className="inc">{body}</div>}
      {onAck && x.status === "OPEN" && !acked && <button className="ack" onClick={onAck} aria-label={`Acknowledge: ${incidentTitle(x)}`} title="Acknowledge">✓</button>}
    </li>
  );
}

function AlertFeed({ incidents, name, onPick, frames, latest, acked, onAck }: {
  incidents: Incident[]; name: (id: string) => string; onPick: (id: string) => void;
  frames?: Record<string, Frame[]>; latest?: Record<string, Frame>; acked?: Set<string>; onAck?: (k: string) => void;
}) {
  const list = incidents.slice().sort((a, b) => (a.status === b.status ? b.opened_at.localeCompare(a.opened_at) : a.status === "OPEN" ? -1 : 1));
  if (!list.length) return <p className="empty small">No alerts yet. An alert opens when a platform stays below trust 50 for three seconds.</p>;
  return (
    <ul className="incs">
      {list.slice(0, 12).map((x) => {
        const k = x.device_id + x.start;
        const f = latest?.[x.device_id];
        const act = f?.resp && f.resp.mode === "hold" ? (f.resp.action as "VERIFY" | "ISOLATE") : null;
        return <IncidentItem key={k} x={x} name={name(x.device_id)} onPick={() => onPick(x.device_id)} spark={frames?.[x.device_id]} status={f?.st} action={act}
          acked={acked?.has(k)} onAck={onAck ? () => onAck(k) : undefined} />;
      })}
    </ul>
  );
}

/** Live numbers that count up and down instead of jumping. */
function useTween(value: number | null, ms = 700) {
  const [v, setV] = useState(value ?? 0);
  const cur = useRef(value ?? 0);
  useEffect(() => {
    if (value == null) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = cur.current, to = value, t0 = performance.now();
    if (reduce || Math.abs(to - from) < 0.5) { cur.current = to; setV(to); return; }
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - (1 - k) * (1 - k);
      cur.current = from + (to - from) * e;
      setV(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return v;
}

function FleetKpis({ trust, counts, open, held, worstLie }: { trust: number | null; counts: Record<Status, number>; open: number; held: number; worstLie: number }) {
  const t = useTween(trust);
  const lie = useTween(worstLie);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const tone = t >= 75 ? "TRUSTED" : t >= 50 ? "DEGRADED" : t >= 25 ? "SUSPICIOUS" : "UNTRUSTED";
  return (
    <div className="float kpis" aria-label="Fleet at a glance">
      <div className="kpi">
        <span className="kpi-label">Fleet trust</span>
        <span className="kpi-value num" style={{ color: STATUS_COLOR[tone] }}>{trust == null ? "–" : Math.round(t)}</span>
        <span className="kpi-bar" aria-hidden="true">{ORDER.map((s) => counts[s] > 0 && <i key={s} style={{ flex: counts[s], background: STATUS_COLOR[s] }} />)}</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Platforms</span>
        <span className="kpi-value num">{total}</span>
        <span className="kpi-sub">{counts.TRUSTED} trusted{counts.UNTRUSTED ? `, ${counts.UNTRUSTED} untrusted` : ""}</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Open incidents</span>
        <span className="kpi-value num" style={{ color: open ? "var(--untrusted)" : undefined }}>{open}</span>
        <span className="kpi-sub">{open ? "operator attention" : "all clear"}</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Positions refused</span>
        <span className="kpi-value num" style={{ color: held ? "#0b8f7d" : undefined }}>{held}</span>
        <span className="kpi-sub">{held && worstLie > 0 ? `worst lie ${dist(lie)}` : held ? "estimates in use" : "all fixes accepted"}</span>
      </div>
    </div>
  );
}

const PLAYBOOK: Record<string, string[]> = {
  "vehicle:VERIFY": ["Call the driver and ask for a landmark; compare it with the estimate on the map", "Check the dashcam or telematics odometer against the reported speed", "Hold dispatch decisions for this vehicle until the fix rejoins the estimate"],
  "vehicle:ISOLATE": ["Stop dispatch, geofence and billing decisions for this vehicle now", "Contact the driver and agree a verification point", "Export the incident report (R) for the security log", "Release is automatic: trust back above 50 and a fix that rejoins the estimate"],
  "drone:VERIFY": ["Keep visual line of sight; do not accept new GNSS waypoints", "Compare the inertial track with the reported position", "Hold the mission until the fix rejoins the estimate"],
  "drone:ISOLATE": ["Switch the flight controller to inertial hold or return-to-home without GNSS", "Keep visual line of sight and prepare a manual landing", "Export the incident report (R) for the flight log", "Resume only when trust is back above 50 and the fix rejoins the estimate"],
};
const ticks = new Map<string, boolean>();

function Playbook({ kind, action, id }: { kind: "vehicle" | "drone"; action: "VERIFY" | "ISOLATE"; id: string }) {
  const steps = PLAYBOOK[`${kind}:${action}`] ?? [];
  const [, bump] = useState(0);
  return (
    <div className="playbook">
      <div className="sec-head"><h2>What to do now</h2><span className="num">{steps.filter((_, i) => ticks.get(`${id}:${i}`)).length} / {steps.length}</span></div>
      <ul className="steps">
        {steps.map((st, i) => {
          const k = `${id}:${i}`;
          const on = !!ticks.get(k);
          return (
            <li key={k} className={on ? "done" : ""}>
              <label><input type="checkbox" checked={on} onChange={(e) => { ticks.set(k, e.target.checked); bump((v) => v + 1); }} /><span>{st}</span></label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusStrip({ fleet, counts, timeline, onTimeline, present, onPresent, lastFix, view }: { fleet: Fleet; counts: Record<Status, number>; timeline: boolean; onTimeline: () => void; present: boolean; onPresent: () => void; lastFix: number; view?: ReactNode }) {
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
      <span className="strip-counts" aria-label={ORDER.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${STATUS_WORD[s].toLowerCase()}`).join(", ")}>
        {ORDER.filter((s) => counts[s] > 0).map((s) => (
          <span key={s} title={`${counts[s]} ${STATUS_WORD[s].toLowerCase()}`}><i style={{ background: STATUS_COLOR[s] }} /><span className="num">{counts[s]}</span><span className="strip-word"> {STATUS_WORD[s].toLowerCase()}</span></span>
        ))}
      </span>
      <span className="strip-note">Attacks are simulated</span>
      {view}
      <button className={`iconbtn${timeline ? " on" : ""}`} onClick={onTimeline} aria-pressed={timeline} aria-label="Fleet timeline" title="Fleet timeline (T)"><IconTimeline size={18} /></button>
      <button className={`iconbtn present-btn${present ? " on" : ""}`} onClick={onPresent} aria-pressed={present} aria-label="Presentation mode" title="Presentation mode: the camera visits every platform (P)"><IconPlay size={18} /></button>
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
