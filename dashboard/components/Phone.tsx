"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/useTheme";

/**
 * TrustNav Phone: the phone's own GNSS fixes, once a second, to the cloud.
 * The engine on a laptop (python -m trustnav_engine.phone) pulls them, scores
 * them and posts frames, so the live console shows this phone as a platform.
 * Nothing here reads the map or the frames; the page only sends.
 */

const INGEST = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ehskwxnzatfvsiqmnsia.supabase.co") + "/functions/v1/ingest";
const KEY_DEVICE = "trustnav-phone-device";
const KEY_TOKEN = "trustnav-phone-token";

type Overlay = "none" | "teleport" | "drift" | "jam";
type Fix = { t: string; lat: number; lon: number; alt: number | null; spd: number | null; hdg: number | null; acc: number | null };

const OVERLAYS: { id: Overlay; label: string; hint: string }[] = [
  { id: "none", label: "Real position", hint: "send the fix as the phone reports it" },
  { id: "teleport", label: "Teleport spoof", hint: "the engine moves the reported position 8 km east" },
  { id: "drift", label: "Slow drift", hint: "pulled away at 0.7 m/s, like a careful spoofer" },
  { id: "jam", label: "Jamming", hint: "no fix at all, like a jammer next to the receiver" },
];

const fmt = (v: number | null | undefined, d = 0, unit = "") => (v == null || Number.isNaN(v) ? "–" : `${v.toFixed(d)}${unit}`);

export default function Phone() {
  useTheme();
  const [device, setDevice] = useState("PHONE-01");
  const [token, setToken] = useState("");
  const [running, setRunning] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [fix, setFix] = useState<Fix | null>(null);
  const [sent, setSent] = useState(0);
  const [queued, setQueued] = useState(0);
  const [lastSend, setLastSend] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secure, setSecure] = useState(true);
  const watch = useRef<number | null>(null);
  const latest = useRef<Fix | null>(null);
  const queue = useRef<(Fix & { overlay: Overlay })[]>([]);
  const overlayRef = useRef<Overlay>("none");
  overlayRef.current = overlay;
  const wake = useRef<any>(null);

  useEffect(() => {
    try {
      const d = localStorage.getItem(KEY_DEVICE); if (d) setDevice(d);
      const t = localStorage.getItem(KEY_TOKEN); if (t) setToken(t);
    } catch { /* storage blocked */ }
    setSecure(typeof window !== "undefined" ? window.isSecureContext : true);
  }, []);

  const remember = (d: string, t: string) => {
    try { localStorage.setItem(KEY_DEVICE, d); localStorage.setItem(KEY_TOKEN, t); } catch { /* storage blocked */ }
  };

  const flush = useCallback(async (dev: string, tok: string) => {
    if (!queue.current.length) return;
    const batch = queue.current.splice(0, 50);
    setQueued(queue.current.length);
    try {
      const r = await fetch(INGEST, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trustnav-token": tok },
        body: JSON.stringify({ type: "phone_obs", device_id: dev, obs: batch }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      setSent((n) => n + batch.length);
      setLastSend(new Date().toLocaleTimeString());
      setError(null);
    } catch (e: any) {
      // keep the fixes for the next try, but never let the queue grow without bound
      queue.current = batch.concat(queue.current).slice(-300);
      setQueued(queue.current.length);
      setError(e?.message === "Failed to fetch" ? "No network; keeping fixes until it returns" : String(e?.message ?? e));
    }
  }, []);

  const stop = useCallback(() => {
    if (watch.current != null) { navigator.geolocation.clearWatch(watch.current); watch.current = null; }
    try { wake.current?.release?.(); } catch { /* ignore */ }
    wake.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    const dev = device.trim().toUpperCase();
    const tok = token.trim();
    if (!/^[A-Z0-9-]{3,32}$/.test(dev)) { setError("Device name: 3 to 32 characters, letters, digits and dashes"); return; }
    if (tok.length < 24) { setError("Paste the ingest token (it is long)"); return; }
    if (!("geolocation" in navigator)) { setError("This browser has no geolocation"); return; }
    setDevice(dev); remember(dev, tok); setError(null);
    setRunning(true);
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const c = p.coords;
        latest.current = {
          t: new Date(p.timestamp).toISOString(), lat: c.latitude, lon: c.longitude,
          alt: c.altitude ?? null, spd: c.speed ?? null, hdg: c.heading ?? null, acc: c.accuracy ?? null,
        };
        setFix(latest.current);
      },
      (e) => setError(e.code === 1 ? "Location permission refused: allow it in the browser settings" : e.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    try { (navigator as any).wakeLock?.request?.("screen").then((l: any) => { wake.current = l; }).catch(() => {}); } catch { /* unsupported */ }
  }, [device, token]);

  // one observation per second (the latest fix), posted every two seconds
  useEffect(() => {
    if (!running) return;
    const dev = device.trim().toUpperCase(), tok = token.trim();
    let tick = 0;
    const id = setInterval(() => {
      const f = latest.current;
      const now = new Date();
      if (f) {
        const age = now.getTime() - Date.parse(f.t);
        // a steady 1 Hz stream: the current fix while it is fresh, "no fix" once it is 10 s old
        const fresh = age < 10000;
        queue.current.push(fresh
          ? { ...f, t: now.toISOString(), overlay: overlayRef.current }
          : { t: now.toISOString(), lat: null as any, lon: null as any, alt: null, spd: null, hdg: null, acc: null, overlay: overlayRef.current });
        setQueued(queue.current.length);
      }
      if (++tick % 2 === 0) void flush(dev, tok);
    }, 1000);
    return () => { clearInterval(id); void flush(dev, tok); };
  }, [running, device, token, flush]);

  useEffect(() => () => stop(), [stop]);

  return (
    <main className="phone">
      <header className="phone-head">
        <a className="phone-brand" href="/">TrustNav</a>
        <span className="phone-kicker">Phone receiver</span>
      </header>

      <h1>Your phone as a live receiver</h1>
      <p className="phone-lede">
        This page sends the phone&apos;s own satellite position once a second, and the live console scores it like any receiver.
      </p>

      {!secure && <p className="phone-error">Open this page over https; browsers only give the position to secure pages.</p>}

      <section className="phone-card">
        <label className="phone-field">
          <span>Device name</span>
          <input className="input" value={device} disabled={running} onChange={(e) => setDevice(e.target.value)} placeholder="PHONE-01" autoCapitalize="characters" />
        </label>
        <label className="phone-field">
          <span>Ingest token</span>
          <input className="input" type="password" value={token} disabled={running} onChange={(e) => setToken(e.target.value)} placeholder="paste the token" autoComplete="off" />
        </label>
        {!running
          ? <button className="btn primary phone-main" onClick={start}>Start sending</button>
          : <button className="btn phone-main" onClick={stop}>Stop</button>}
        {error && <p className="phone-error" role="alert">{error}</p>}
      </section>

      <section className="phone-card phone-status" aria-live="polite">
        <div><span>State</span><strong className={running ? "on" : ""}>{running ? (fix ? "sending" : "waiting for a fix") : "stopped"}</strong></div>
        <div><span>Position</span><strong>{fix ? `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}` : "–"}</strong></div>
        <div><span>Accuracy</span><strong>{fmt(fix?.acc, 0, " m")}</strong></div>
        <div><span>Speed</span><strong>{fmt(fix?.spd == null ? null : fix.spd * 3.6, 1, " km/h")}</strong></div>
        <div><span>Heading</span><strong>{fmt(fix?.hdg, 0, "°")}</strong></div>
        <div><span>Sent</span><strong>{sent}{queued ? ` (+${queued} queued)` : ""}</strong></div>
        <div><span>Last send</span><strong>{lastSend ?? "–"}</strong></div>
      </section>

      <section className="phone-card">
        <h2>Simulate an attack on this stream</h2>
        <p className="phone-hint">Nothing is transmitted: the engine alters the reported position in software.</p>
        <div className="phone-overlays" role="radiogroup" aria-label="Attack overlay">
          {OVERLAYS.map((o) => (
            <button key={o.id} className={"phone-overlay" + (overlay === o.id ? " on" : "")} role="radio" aria-checked={overlay === o.id} onClick={() => setOverlay(o.id)}>
              <strong>{o.label}</strong><span>{o.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="phone-card phone-how">
        <h2>How to run it</h2>
        <ol>
          <li>On the laptop: <code>python -m trustnav_engine.phone --device {device.trim().toUpperCase() || "PHONE-01"} --name &quot;My phone&quot;</code> (with <code>TRUSTNAV_INGEST_URL</code> and <code>TRUSTNAV_TOKEN</code> set). Add <code>--route angers_centre_loop</code> if you walk that loop.</li>
          <li>Here: paste the token, tap <em>Start sending</em>, allow the location, keep the screen on.</li>
          <li>Open <a href="/#live">the live console</a> on any screen: the phone appears as a platform within a few seconds.</li>
        </ol>
        <p className="phone-hint">A phone gives position, speed and heading only, so the motion, route and time rules do the work.</p>
      </section>
    </main>
  );
}
