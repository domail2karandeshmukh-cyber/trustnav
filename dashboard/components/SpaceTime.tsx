"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Frame, Status } from "@/lib/types";
import { STATUS_HEX } from "@/lib/format";

/**
 * Space-time view: ground is the map in metres, height is time.
 * Each platform's reported track rises as a ribbon coloured by trust; the
 * real path (when the simulator knows it) rises beside it. A spoof is a
 * ribbon tearing away from the real one; jamming is a gap; drift is a lean.
 * Pure canvas, no tiles, same on every screen.
 */

export interface STTrack { id: string; label: string; kind: "vehicle" | "drone"; frames: Frame[]; selected?: boolean; faded?: boolean; truth?: [number, number][]; truthFrom?: number }
export interface STRoute { id: string; points: [number, number][] }

interface Props {
  tracks: STTrack[];
  routes: STRoute[];
  /** time window shown: first second and number of seconds */
  first: number;
  slots: number;
  /** second marked as "now" or the replay cursor */
  cursor?: number;
  theme: "light" | "dark";
  onPick?: (id: string) => void;
  /** attack window for a bracket on the time axis */
  attack?: [number, number] | null;
  autoRotate?: boolean;
  fitKey: string;
}

const R = 6371000;

export default function SpaceTime({ tracks, routes, first, slots, cursor, theme, onPick, attack, autoRotate = true, fitKey }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const cam = useRef({ az: -0.65, el: 0.62, zoom: 1, panX: 0, panY: 0, idle: performance.now(), hover: null as string | null });
  const [, setTick] = useState(0);
  const pick = useRef(onPick); pick.current = onPick;

  // local metre frame around the scene
  const scene = useMemo(() => {
    const pts: [number, number][] = [];
    routes.forEach((r) => r.points.forEach((p) => pts.push(p)));
    tracks.forEach((t) => { t.frames.forEach((f) => { if (f.lat != null && f.lon != null) pts.push([f.lat, f.lon]); }); t.truth?.forEach((p) => pts.push(p)); });
    if (!pts.length) return null;
    const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const lon0 = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const k = Math.PI / 180;
    const toXY = (lat: number, lon: number): [number, number] => [(lon - lon0) * k * Math.cos(lat0 * k) * R, (lat - lat0) * k * R];
    let ext = 50;
    pts.forEach((p) => { const [x, y] = toXY(p[0], p[1]); ext = Math.max(ext, Math.abs(x), Math.abs(y)); });
    return { toXY, ext };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, routes]);

  useEffect(() => { cam.current.zoom = 1; cam.current.panX = 0; cam.current.panY = 0; }, [fitKey]);

  // interaction
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let drag: { x: number; y: number; az: number; el: number; pan: boolean; px: number; py: number } | null = null;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, az: cam.current.az, el: cam.current.el, pan: e.shiftKey || e.button === 1, px: cam.current.panX, py: cam.current.panY }; el.setPointerCapture(e.pointerId); cam.current.idle = performance.now(); };
    const move = (e: PointerEvent) => {
      cam.current.idle = performance.now();
      if (!drag) { cam.current.hover = hit(e); return; }
      if (drag.pan) { cam.current.panX = drag.px + (e.clientX - drag.x); cam.current.panY = drag.py + (e.clientY - drag.y); }
      else { cam.current.az = drag.az + (e.clientX - drag.x) * 0.008; cam.current.el = Math.max(0.12, Math.min(1.45, drag.el - (e.clientY - drag.y) * 0.006)); }
    };
    const up = (e: PointerEvent) => {
      if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) { const id = hit(e); if (id) pick.current?.(id); }
      drag = null;
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); cam.current.zoom = Math.max(0.4, Math.min(6, cam.current.zoom * Math.exp(-e.deltaY * 0.0012))); cam.current.idle = performance.now(); };
    const hit = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best: string | null = null, bd = 18;
      for (const [id, p] of heads.current) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = id; } }
      return best;
    };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("wheel", wheel); };
  }, []);

  const heads = useRef<Map<string, [number, number]>>(new Map());
  const data = useRef({ tracks, routes, first, slots, cursor, theme, attack, scene, autoRotate });
  data.current = { tracks, routes, first, slots, cursor, theme, attack, scene, autoRotate };

  // render loop
  useEffect(() => {
    let raf = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current, el = box.current;
      const d = data.current;
      if (!c || !el || !d.scene) return;
      const W = el.clientWidth, H = el.clientHeight;
      if (W < 10 || H < 10) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const dark = d.theme === "dark";
      const now = performance.now();
      if (d.autoRotate && !reduce && now - cam.current.idle > 2500) cam.current.az += 0.0016;
      const { az, el: elev, zoom, panX, panY } = cam.current;
      const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(elev), se = Math.sin(elev);
      const ext = d.scene.ext;
      const base = (Math.min(W, H) * 0.36) / ext * zoom;
      const zScale = (Math.min(W, H) * 0.55) / Math.max(1, d.slots) * zoom; // px per second of height
      const cx = W / 2 + panX, cy = H * 0.62 + panY;
      const P = (x: number, y: number, t: number): [number, number, number] => {
        const X = x * ca - y * sa, Y = x * sa + y * ca;
        return [cx + X * base, cy - Y * se * base - (t - d.first) * zScale * ce, Y];
      };

      // background
      g.clearRect(0, 0, W, H);
      const grad = g.createRadialGradient(cx, cy - H * 0.2, 40, cx, cy, Math.max(W, H));
      grad.addColorStop(0, dark ? "#17213a" : "#ffffff");
      grad.addColorStop(1, dark ? "#0b1019" : "#eef1f5");
      g.fillStyle = grad; g.fillRect(0, 0, W, H);

      // ground grid
      const step = ext > 3000 ? 1000 : ext > 1200 ? 500 : ext > 400 ? 200 : 100;
      g.lineWidth = 1; g.strokeStyle = dark ? "rgba(255,255,255,.06)" : "rgba(20,35,59,.07)";
      const lim = Math.ceil(ext / step) * step;
      for (let v = -lim; v <= lim; v += step) {
        let a = P(v, -lim, d.first), b = P(v, lim, d.first); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        a = P(-lim, v, d.first); b = P(lim, v, d.first); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
      // scale bar + time axis
      g.font = "500 11.5px Barlow, system-ui, sans-serif"; g.fillStyle = dark ? "rgba(232,238,248,.55)" : "rgba(20,35,59,.55)";
      const s0 = P(-lim, -lim, d.first), s1 = P(-lim + step, -lim, d.first);
      g.strokeStyle = dark ? "rgba(232,238,248,.45)" : "rgba(20,35,59,.45)"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(s0[0], s0[1]); g.lineTo(s1[0], s1[1]); g.stroke();
      g.fillText(step >= 1000 ? `${step / 1000} km` : `${step} m`, s0[0] + 4, s0[1] + 16);
      const axisX = P(lim, lim, d.first), axisT = P(lim, lim, d.first + d.slots - 1);
      g.strokeStyle = dark ? "rgba(232,238,248,.25)" : "rgba(20,35,59,.25)"; g.setLineDash([2, 4]);
      g.beginPath(); g.moveTo(axisX[0], axisX[1]); g.lineTo(axisT[0], axisT[1]); g.stroke(); g.setLineDash([]);
      const ticks = d.slots > 240 ? 60 : d.slots > 90 ? 30 : 10;
      for (let t = 0; t < d.slots; t += ticks) {
        const p = P(lim, lim, d.first + t);
        g.fillText(t === 0 ? "start" : `+${t >= 60 ? `${Math.floor(t / 60)} min` : `${t} s`}`, p[0] + 8, p[1] + 4);
      }
      if (d.attack) {
        const a0 = P(lim, lim, Math.max(d.first, d.attack[0])), a1 = P(lim, lim, Math.min(d.first + d.slots - 1, d.attack[1]));
        g.strokeStyle = STATUS_HEX.UNTRUSTED; g.lineWidth = 3; g.beginPath(); g.moveTo(a0[0] + 3, a0[1]); g.lineTo(a1[0] + 3, a1[1]); g.stroke();
        g.fillStyle = STATUS_HEX.UNTRUSTED; g.font = "600 11.5px Barlow, system-ui, sans-serif"; g.fillText("attack", a1[0] + 8, a1[1] - 6);
      }

      // routes on the ground
      g.setLineDash([6, 6]); g.lineWidth = 1.5; g.strokeStyle = dark ? "rgba(127,176,255,.45)" : "rgba(31,95,191,.4)";
      for (const r of d.routes) {
        g.beginPath();
        r.points.forEach((pt, i) => { const [x, y] = d.scene!.toXY(pt[0], pt[1]); const p = P(x, y, d.first); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
        g.stroke();
      }
      g.setLineDash([]);

      // tracks, back to front
      const order = d.tracks.map((t) => {
        const f = t.frames.find((x) => x.lat != null);
        const depth = f ? P(...d.scene!.toXY(f.lat!, f.lon!), d.first)[2] : 0;
        return { t, depth };
      }).sort((a, b) => a.depth - b.depth);
      heads.current.clear();
      const placed: [number, number, number, number][] = [];
      for (const { t } of order) {
        const alpha = t.faded ? 0.28 : 1;
        // ground shadow
        g.lineWidth = 2; g.strokeStyle = dark ? `rgba(0,0,0,${0.35 * alpha})` : `rgba(20,35,59,${0.12 * alpha})`;
        g.beginPath(); let pen = false;
        for (const f of t.frames) {
          if (f.lat == null || f.s < d.first || f.s >= d.first + d.slots) { pen = false; continue; }
          const p = P(...d.scene.toXY(f.lat, f.lon!), d.first); if (pen) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); pen = true;
        }
        g.stroke();
        // truth path rising
        if (t.truth && t.truth.length > 1) {
          g.setLineDash([2, 5]); g.lineWidth = 1.6; g.strokeStyle = dark ? `rgba(232,238,248,${0.75 * alpha})` : `rgba(20,35,59,${0.7 * alpha})`;
          g.beginPath();
          const start = t.frames.length ? t.frames[0].s : d.first;
          t.truth.forEach((pt, i) => { const s = start + i; if (s < d.first || s >= d.first + d.slots || s < (t.truthFrom ?? -1)) return; const p = P(...d.scene!.toXY(pt[0], pt[1]), s); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
          g.stroke(); g.setLineDash([]);
        }
        // reported ribbon, coloured by status, with vertical "time drop" every 30 s
        let prev: [number, number, number] | null = null; let prevF: Frame | null = null;
        for (const f of t.frames) {
          if (f.s < d.first || f.s >= d.first + d.slots) continue;
          if (f.lat == null) { prev = null; prevF = f; continue; }
          const p = P(...d.scene.toXY(f.lat, f.lon!), f.s);
          if (prev && prevF && prevF.lat != null) {
            const jump = Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.12 * Math.min(W, H);
            const col = STATUS_HEX[f.st as Status];
            g.strokeStyle = col; g.globalAlpha = alpha;
            if (f.st === "UNTRUSTED" || f.st === "SUSPICIOUS") { g.shadowColor = col; g.shadowBlur = t.selected ? 14 : 8; } else { g.shadowBlur = 0; }
            g.lineWidth = t.selected ? 4 : 2.6; g.lineCap = "round";
            if (jump) g.setLineDash([3, 5]);
            g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(p[0], p[1]); g.stroke();
            g.setLineDash([]); g.shadowBlur = 0; g.globalAlpha = 1;
          }
          if (f.s % 30 === 0) { const gp = P(...d.scene.toXY(f.lat, f.lon!), d.first); g.strokeStyle = dark ? "rgba(255,255,255,.08)" : "rgba(20,35,59,.08)"; g.lineWidth = 1; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(gp[0], gp[1]); g.stroke(); }
          prev = p; prevF = f;
        }
        // head
        const last = [...t.frames].reverse().find((f) => f.lat != null && f.s < d.first + d.slots && f.s >= d.first);
        if (last) {
          const p = P(...d.scene.toXY(last.lat!, last.lon!), last.s);
          heads.current.set(t.id, [p[0], p[1]]);
          const col = STATUS_HEX[last.st as Status];
          const hovered = cam.current.hover === t.id;
          g.globalAlpha = alpha;
          if (t.selected || hovered) { g.beginPath(); g.arc(p[0], p[1], 15, 0, Math.PI * 2); g.strokeStyle = t.selected ? (dark ? "#7fb0ff" : "#1f5fbf") : col; g.lineWidth = 2; g.stroke(); }
          if (last.trust < 50) { const pulse = 0.5 + 0.5 * Math.sin(now / 350); g.beginPath(); g.arc(p[0], p[1], 10 + pulse * 10, 0, Math.PI * 2); g.strokeStyle = col; g.globalAlpha = alpha * (1 - pulse) * 0.8; g.lineWidth = 2; g.stroke(); g.globalAlpha = alpha; }
          g.beginPath();
          if (t.kind === "drone") { g.moveTo(p[0], p[1] - 7); g.lineTo(p[0] + 7, p[1]); g.lineTo(p[0], p[1] + 7); g.lineTo(p[0] - 7, p[1]); g.closePath(); }
          else g.arc(p[0], p[1], 6.5, 0, Math.PI * 2);
          g.fillStyle = col; g.fill(); g.lineWidth = 2; g.strokeStyle = dark ? "#0b1019" : "#fff"; g.stroke();
          g.font = `${t.selected ? 600 : 500} 12px Barlow, system-ui, sans-serif`;
          const label = `${t.label}  ${Math.round(last.trust)}`;
          const tw = g.measureText(label).width + 12;
          let ly = p[1] - 10;
          for (let k = 0; k < 6; k++) {
            const clash = placed.some(([bx, by, bw, bh]) => p[0] + 11 < bx + bw && p[0] + 11 + tw > bx && ly < by + bh && ly + 20 > by);
            if (!clash) break;
            ly += 22;
          }
          placed.push([p[0] + 11, ly, tw, 20]);
          if (ly !== p[1] - 10) { g.strokeStyle = dark ? "rgba(232,238,248,.35)" : "rgba(20,35,59,.35)"; g.lineWidth = 1; g.beginPath(); g.moveTo(p[0] + 8, p[1]); g.lineTo(p[0] + 11, ly + 10); g.stroke(); }
          g.fillStyle = t.selected ? (dark ? "#e8eef8" : "#14233b") : (dark ? "rgba(17,24,39,.92)" : "rgba(255,255,255,.95)");
          roundRect(g, p[0] + 11, ly, tw, 20, 6); g.fill();
          g.fillStyle = t.selected ? (dark ? "#0b1019" : "#fff") : (dark ? "#e8eef8" : "#14233b");
          g.fillText(label, p[0] + 17, ly + 14);
          g.globalAlpha = 1;
        }
      }
      // cursor plane label
      if (d.cursor != null) {
        const p = P(lim, lim, d.cursor);
        g.fillStyle = dark ? "#7fb0ff" : "#1f5fbf"; g.beginPath(); g.arc(p[0], p[1], 4, 0, Math.PI * 2); g.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(t); }, []);

  return (
    <div ref={box} className="st" role="img" aria-label="Space-time view: ground is the map, height is time; each ribbon is a platform's reported track coloured by trust">
      <canvas ref={canvas} />
      <div className="st-hint">Drag to rotate, wheel to zoom, shift-drag to pan. Height is time; colour is trust.</div>
    </div>
  );
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
