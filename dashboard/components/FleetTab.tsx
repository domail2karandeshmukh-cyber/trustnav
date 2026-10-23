"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./MapView";
import { Evidence, Gauge, OsnmaPanel, RiskBars, Sparkline, StatusPill, Telemetry, TrustChart } from "./Instruments";
import { rowToFrame, rowToIncident, supabase } from "@/lib/supabase";
import type { Device, Frame, Incident, RouteGeom, Run } from "@/lib/types";
import { OSNMA_INFO, STATUS_COLOR, clock, fmt, mmss } from "@/lib/format";

const KEEP = 300; // seconds of history kept per device
const MODE_WORD: Record<Run["mode"], string> = { demo_feed: "Cloud demo feed", live_engine: "Live engine", receiver: "Live receiver" };

type Conn = "connecting" | "live" | "offline";

export default function FleetTab({ routes, onIncidents }: { routes: Record<string, RouteGeom> | null; onIncidents?: (list: Incident[]) => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [frames, setFrames] = useState<Record<string, Frame[]>>({});
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Incident | null>(null);
  const [now, setNow] = useState(Date.now());
  const buffer = useRef<Frame[]>([]);
  const runRef = useRef<Run | null>(null);
  runRef.current = run;

  const loadRun = useCallback(async (r: Run | null) => {
    setRun(r);
    setFrames({});
    setIncidents([]);
    setBanner(null);
    if (!r) return;
    const db = supabase();
    const { data: last } = await db.from("frames").select("seq").eq("run_id", r.id).order("seq", { ascending: false }).limit(1);
    const top = last?.[0]?.seq ?? 0;
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("frames").select("*").eq("run_id", r.id).gte("seq", top - KEEP)
        .order("seq", { ascending: true }).range(from, from + 999);
      if (error) { setError(error.message); break; }
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const by: Record<string, Frame[]> = {};
    for (const row of rows) (by[row.device_id] ??= []).push(rowToFrame(row));
    setFrames(by);
    const { data: inc } = await db.from("incidents").select("*").eq("run_id", r.id).order("opened_at", { ascending: false });
    setIncidents((inc ?? []).map(rowToIncident));
  }, []);

  // initial load + realtime subscription
  useEffect(() => {
    const db = supabase();
    let alive = true;
    (async () => {
      try {
        const [{ data: dev, error: e1 }, { data: runs, error: e2 }] = await Promise.all([
          db.from("devices").select("*").order("id"),
          db.from("runs").select("*").order("started_at", { ascending: false }).limit(1),
        ]);
        if (!alive) return;
        if (e1 || e2) { setError((e1 ?? e2)!.message); setConn("offline"); return; }
        setDevices((dev ?? []) as Device[]);
        await loadRun((runs?.[0] as Run) ?? null);
      } catch (e) {
        if (alive) { setError(String(e)); setConn("offline"); }
      }
    })();

    const ch = db.channel("trustnav-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "frames" }, (p: any) => {
        if (p.new.run_id === runRef.current?.id) buffer.current.push(rowToFrame(p.new));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, (p: any) => {
        if (p.new?.run_id !== runRef.current?.id) return;
        const inc = rowToIncident(p.new);
        setIncidents((list) => {
          const i = list.findIndex((x) => x.device_id === inc.device_id && x.start === inc.start);
          if (i < 0) { if (inc.status === "OPEN") setBanner(inc); return [inc, ...list]; }
          const copy = list.slice(); copy[i] = inc; return copy;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "runs" }, async (p: any) => {
        if (p.eventType === "INSERT") {
          const { data: dev } = await db.from("devices").select("*").order("id");
          setDevices((dev ?? []) as Device[]);
          loadRun(p.new as Run);
        } else if (p.new?.id === runRef.current?.id) {
          setRun(p.new as Run);
        }
      })
      .subscribe((status) => setConn(status === "SUBSCRIBED" ? "live" : status === "CLOSED" || status === "CHANNEL_ERROR" ? "offline" : "connecting"));

    // flush realtime frames twice a second, so seven devices at 1 Hz stay smooth
    const flush = setInterval(() => {
      setNow(Date.now());
      if (!buffer.current.length) return;
      const batch = buffer.current; buffer.current = [];
      setFrames((prev) => {
        const next = { ...prev };
        for (const f of batch) {
          const arr = (next[f.device_id!] ?? []).slice();
          if (!arr.length || arr[arr.length - 1].s < f.s) arr.push(f);
          next[f.device_id!] = arr.length > KEEP ? arr.slice(arr.length - KEEP) : arr;
        }
        return next;
      });
    }, 500);
    return () => { alive = false; clearInterval(flush); db.removeChannel(ch); };
  }, [loadRun]);

  useEffect(() => { onIncidents?.(incidents); }, [incidents, onIncidents]);

  const latest = useMemo(() => {
    const m: Record<string, Frame> = {};
    for (const [id, arr] of Object.entries(frames)) if (arr.length) m[id] = arr[arr.length - 1];
    return m;
  }, [frames]);

  const activeDevices = useMemo(() => devices.filter((d) => latest[d.id]), [devices, latest]);
  const sorted = useMemo(() => activeDevices.slice().sort((a, b) => latest[a.id].trust - latest[b.id].trust), [activeDevices, latest]);
  useEffect(() => { if (!selected && sorted.length) setSelected(sorted[0].id); }, [sorted, selected]);

  const sel = selected ? latest[selected] ?? null : null;
  const selDev = devices.find((d) => d.id === selected) ?? null;
  const lastT = Math.max(0, ...Object.values(latest).map((f) => new Date(f.t ?? 0).getTime()));
  const fresh = run?.status === "running" && now - lastT < 6000;
  const elapsed = run ? Math.max(0, ((run.status === "running" ? now : new Date(run.ended_at ?? now).getTime()) - new Date(run.started_at).getTime()) / 1000) : 0;
  const alarms = sorted.filter((d) => latest[d.id].trust < 50);

  const mapRoutes = useMemo(() => activeDevices.filter((d) => d.route_slug && routes?.[d.route_slug])
    .map((d) => ({ id: d.id, points: routes![d.route_slug!].points })), [activeDevices, routes]);
  const tracks = useMemo(() => activeDevices.map((d) => ({ id: d.id, frames: frames[d.id].slice(-120) })), [activeDevices, frames]);
  const markers = useMemo(() => activeDevices.filter((d) => latest[d.id].lat != null).map((d) => {
    const f = latest[d.id];
    return { id: d.id, label: d.id, lat: f.lat!, lon: f.lon!, status: f.st, kind: d.kind, alarm: f.trust < 50, selected: d.id === selected };
  }), [activeDevices, latest, selected]);

  return (
    <>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="pad" style={{ display: "flex", gap: "8px 12px", flexWrap: "wrap", alignItems: "center" }}>
          {fresh ? <span className="chip live">Live</span> : <span className="chip">{run ? (run.status === "running" ? "Waiting for data" : "Last run") : "No run yet"}</span>}
          {run && <span className="chip">{MODE_WORD[run.mode]}</span>}
          {run && <span className="chip">{run.status === "running" ? "elapsed" : "ran"} {mmss(elapsed)}{run.duration_s ? ` / ${mmss(run.duration_s)}` : ""}</span>}
          <span className="chip">{activeDevices.length} platforms</span>
          {alarms.length > 0 && <span className="chip" style={{ color: "var(--untrusted)", borderColor: "color-mix(in srgb, var(--untrusted) 50%, transparent)" }}>{alarms.length} untrusted now</span>}
          <span style={{ marginLeft: "auto" }} className={`chip ${conn === "live" ? "" : "warn"}`}>realtime {conn}</span>
        </div>
        <PresenterControls run={run} />
      </div>

      {error && <div className="panel err" style={{ marginBottom: 16 }}>Could not reach the live database: {error}</div>}

      {banner && banner.status === "OPEN" && (
        <div className="banner" role="alert">
          <strong>{banner.severity} · {banner.device_id}</strong>
          <span>{banner.title.replace(/: \d+ observations$/, "")}: trust fell to {fmt(banner.min_trust)}.</span>
          <button className="btn sm" onClick={() => { setSelected(banner.device_id); setBanner(null); }}>Show</button>
          <button className="btn sm" onClick={() => setBanner(null)} aria-label="Dismiss alert">Dismiss</button>
        </div>
      )}

      {!run && !error && (
        <div className="panel notice" style={{ marginBottom: 16 }}>
          <h3>No live run yet</h3>
          Start the cloud demo above (presenter passcode), or run the live engine on a laptop:
          <span className="mono" style={{ display: "block", marginTop: 6, color: "var(--ink)" }}>python -m trustnav_engine.stream</span>
          Meanwhile the Replay tab has all ten recorded scenarios.
        </div>
      )}

      <div className="grid-main">
        <div className="col">
          <div className="panel">
            <MapView fitKey={(run?.id ?? "none") + ":" + activeDevices.length} routes={mapRoutes} tracks={tracks} markers={markers}
              onMarkerClick={setSelected} note={run && !fresh && run.status === "running" ? "Waiting for the next fix" : undefined} />
            <div className="map-legend">
              <span><i className="swatch" style={{ background: "var(--trusted)" }} />Trusted</span>
              <span><i className="swatch" style={{ background: "var(--degraded)" }} />Degraded</span>
              <span><i className="swatch" style={{ background: "var(--suspicious)" }} />Suspicious</span>
              <span><i className="swatch" style={{ background: "var(--untrusted)" }} />Untrusted</span>
              <span><i className="swatch dash" />Assigned route</span>
              <span>◆ drone · ● vehicle</span>
            </div>
          </div>
          {sel && selDev && (
            <div className="panel">
              <div className="ptitle">{selDev.name} · last {Math.min(KEEP, frames[selDev.id]?.length ?? 0)} s</div>
              <TrustChart frames={frames[selDev.id] ?? []} height={200} />
            </div>
          )}
          <div className="panel">
            <div className="ptitle">Incidents this run <span>{incidents.length}</span></div>
            {incidents.length === 0 ? <div className="quiet">No incidents. An incident opens when a platform stays below trust 50 for 3 seconds.</div> : (
              <div className="inc-list">
                {incidents.map((x) => (
                  <button className="inc" key={x.device_id + x.start} onClick={() => setSelected(x.device_id)}>
                    <div className="inc-tags">
                      <span className={`sev ${x.severity}`}>{x.severity}</span>
                      <span className="chip">{x.device_id}</span>
                      <span className="chip" style={{ color: x.status === "OPEN" ? "var(--untrusted)" : "var(--trusted)" }}>{x.status}</span>
                    </div>
                    <h4>{x.title}</h4>
                    <div className="inc-meta">
                      <span>opened <b>{clock(x.opened_at)}</b></span>
                      {x.closed_at && <span>closed <b>{clock(x.closed_at)}</b></span>}
                      <span>min trust <b>{fmt(x.min_trust)}</b></span>
                      <span>evidence <b>{x.evidence.slice(0, 3).map((e) => e.title).join(", ")}</b></span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="col">
          <div className="panel">
            <div className="ptitle">Fleet <span>lowest trust first</span></div>
            {sorted.length === 0 ? <div className="quiet">{run ? "Waiting for the first fixes…" : "No platforms reporting."}</div> : (
              <div className="fleet-list">
                {sorted.map((d) => {
                  const f = latest[d.id];
                  return (
                    <button key={d.id} className="dev" aria-pressed={d.id === selected} onClick={() => setSelected(d.id)} style={{ borderLeftColor: STATUS_COLOR[f.st] }}>
                      <h4><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span><small>{d.id}</small></h4>
                      <span className="trust" style={{ color: STATUS_COLOR[f.st] }}>{Math.round(f.trust)}</span>
                      <div className="meta">
                        <StatusPill st={f.st} />
                        <span>OSNMA <b style={{ color: OSNMA_INFO[f.osnma].tone, fontWeight: 500 }}>{OSNMA_INFO[f.osnma].word}</b></span>
                        <span>{f.fix ? `${f.sats ?? "–"} sats` : "no fix"}</span>
                      </div>
                      <Sparkline values={(frames[d.id] ?? []).slice(-90).map((x) => x.trust)} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {sel && (
            <>
              <div className="panel">
                <div className="ptitle">{selDev?.name ?? selected} · navigation trust</div>
                <Gauge frame={sel} />
                <RiskBars frame={sel} />
              </div>
              <div className="panel">
                <div className="ptitle">Evidence now</div>
                <Evidence frame={sel} />
              </div>
              <div className="panel">
                <div className="ptitle">Galileo authentication (OSNMA)</div>
                <OsnmaPanel status={sel.osnma} />
              </div>
              <div className="panel tele-panel">
                <div className="ptitle">Current observation <span>{clock(sel.t)}</span></div>
                <Telemetry frame={sel} extra={sel.atk == null ? undefined : [["Ground truth", sel.atk ? "attacked" : "clean"]]} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function PresenterControls({ run }: { run: Run | null }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    try { const c = sessionStorage.getItem("trustnav-presenter"); if (c) setCode(c); } catch { /* storage blocked */ }
  }, []);
  const call = async (fn: "start_demo_feed" | "stop_demo_feed") => {
    setBusy(true); setMsg(null);
    const { error } = await supabase().rpc(fn, { passcode: code });
    setBusy(false);
    if (error) { setMsg(error.message.includes("too many") ? "Too many wrong passcodes. Wait 10 minutes." : "Passcode not accepted."); return; }
    try { sessionStorage.setItem("trustnav-presenter", code); } catch { /* storage blocked */ }
    setMsg(fn === "start_demo_feed" ? "Demo feed started. Attacks arrive from about 1:35." : "Demo feed stopped.");
  };
  const running = run?.status === "running" && run.mode === "demo_feed";
  return (
    <div className="controls">
      {!open ? (
        <button className="btn sm" onClick={() => setOpen(true)}>Presenter controls</button>
      ) : (
        <>
          <input className="input" type="password" placeholder="Presenter passcode" value={code} onChange={(e) => setCode(e.target.value)}
            aria-label="Presenter passcode" autoComplete="off" style={{ width: 200 }} />
          <button className="btn primary" disabled={busy || !code} onClick={() => call("start_demo_feed")}>{running ? "Restart demo" : "Start cloud demo"}</button>
          {running && <button className="btn danger" disabled={busy || !code} onClick={() => call("stop_demo_feed")}>Stop</button>}
          <span style={{ fontSize: 12.5, color: "var(--ink-dim)" }}>{msg ?? "Seven platforms over Angers, ~7 minutes, attacks staggered."}</span>
        </>
      )}
    </div>
  );
}
