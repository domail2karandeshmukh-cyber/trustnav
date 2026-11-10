"use client";

import { useEffect, useRef } from "react";
import { HERO_ATTACK_INDEX, HERO_LIE, HERO_ROUTE, HERO_TRACK } from "@/lib/hero-path";

const CYCLE = 11;        // seconds per loop
const ATTACK_AT = 4.2;   // the spoof starts
const ATTACK_END = 9.2;  // and stops

/** The opening scene: a van on its real Angers route, a spoof that throws the reported position 8 km away, and the trust score reacting.
 *  Pure canvas, drawn from the recorded teleport scenario; a still frame when the visitor prefers reduced motion. */
export default function HeroScene() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, w = 0, h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => { const r = cv.getBoundingClientRect(); w = r.width; h = r.height; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); };
    size();
    const ro = new ResizeObserver(size); ro.observe(cv);
    const css = () => { const s = getComputedStyle(document.documentElement); const v = (n: string) => s.getPropertyValue(n).trim(); return { ok: v("--trusted"), bad: v("--untrusted"), line: v("--line"), ink: v("--ink"), ink3: v("--ink-3"), chart: v("--chart"), warn: v("--degraded"), font: v("--display") || "system-ui, sans-serif" }; };
    const t0 = performance.now();

    const draw = (now: number) => {
      const c = css();
      const t = still ? 6.5 : (Math.max(0, now - t0) / 1000) % CYCLE;
      const wide = w >= 1000;
      const cx = wide ? w * 0.68 : w * 0.5, cy = wide ? h * 0.48 : h * 0.26;
      const k = Math.min(wide ? w * 0.34 : w * 0.8, h * (wide ? 0.62 : 0.36)) / 1700;   // px per metre
      const P = (p: [number, number] | number[]): [number, number] => [cx + (p[0] + 560) * k, cy + (p[1] - 700) * k];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = wide ? 1 : 0.55;

      // where the van is on its recorded track
      const prog = Math.min(1, t / (CYCLE - 0.6));
      const fi = prog * (HERO_TRACK.length - 1), i0 = Math.floor(fi), f = fi - i0;
      const a = HERO_TRACK[i0], b = HERO_TRACK[Math.min(HERO_TRACK.length - 1, i0 + 1)];
      const van = P([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      const attack = t >= ATTACK_AT && t < ATTACK_END;
      const since = t - ATTACK_AT;

      // range rings around the van, one of them breathing outward
      ctx.lineWidth = 1;
      for (let r = 1; r <= 7; r++) { ctx.beginPath(); ctx.arc(van[0], van[1], r * 420 * k, 0, 7); ctx.strokeStyle = c.line; ctx.globalAlpha = (wide ? 1 : 0.55) * (r % 2 ? 0.55 : 0.9); ctx.stroke(); }
      const pulse = (t % 2.2) / 2.2;
      ctx.beginPath(); ctx.arc(van[0], van[1], pulse * 1500 * k, 0, 7); ctx.strokeStyle = attack ? c.bad : c.ok; ctx.globalAlpha = (1 - pulse) * 0.5; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = wide ? 1 : 0.55;

      // the planned route
      ctx.setLineDash([5, 6]); ctx.lineWidth = 1.5; ctx.strokeStyle = c.ink3; ctx.beginPath();
      HERO_ROUTE.forEach((p, i) => { const q = P(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.stroke(); ctx.setLineDash([]);

      // the real path so far
      const trail = (color: string, width: number, alpha: number) => {
        ctx.beginPath(); ctx.lineJoin = "round"; ctx.lineCap = "round";
        for (let i = 0; i <= i0; i++) { const q = P(HERO_TRACK[i]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
        ctx.lineTo(van[0], van[1]); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = (wide ? 1 : 0.55) * alpha; ctx.stroke();
      };
      trail(c.ok, 14, 0.12); trail(c.ok, 7, 0.22); trail(c.ok, 3, 1);
      ctx.globalAlpha = wide ? 1 : 0.55;

      // the lie: the reported position thrown 8 km east
      if (attack) {
        const jump = Math.min(1, since / 0.35), ease = 1 - Math.pow(1 - jump, 3);
        const far = P([a[0] + HERO_LIE[0], a[1] + HERO_LIE[1]]);
        const tip: [number, number] = [van[0] + (far[0] - van[0]) * ease, van[1] + (far[1] - van[1]) * ease];
        for (const [lw, al] of [[12, 0.1], [6, 0.2], [2.2, 1]] as const) {
          ctx.beginPath(); ctx.moveTo(van[0], van[1]); ctx.lineTo(tip[0], tip[1]); ctx.strokeStyle = c.bad; ctx.lineWidth = lw; ctx.globalAlpha = (wide ? 1 : 0.55) * al;
          if (lw < 3) ctx.setLineDash([3, 6]); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.globalAlpha = wide ? 1 : 0.55;
        if (wide && since > 0.5) {
          const dl = Math.hypot(far[0] - van[0], far[1] - van[1]) || 1, lx = van[0] + (far[0] - van[0]) / dl * 120, ly = van[1] + (far[1] - van[1]) / dl * 120;
          ctx.font = `600 12px ${c.font}`; ctx.fillStyle = c.bad; ctx.textAlign = "left";
          ctx.fillText("REPORTED POSITION: 8.0 KM AWAY", lx + 6, ly - 22);
          ctx.fillStyle = c.ink3; ctx.font = "500 12px system-ui, sans-serif"; ctx.fillText("refused by TrustNav", lx + 6, ly - 6);
        }
      }

      // the van, with the shield ring while its position is protected
      ctx.beginPath(); ctx.arc(van[0], van[1], 22, 0, 7); ctx.fillStyle = attack ? c.bad : c.ok; ctx.globalAlpha = 0.18; ctx.fill();
      ctx.globalAlpha = wide ? 1 : 0.55;
      ctx.beginPath(); ctx.arc(van[0], van[1], 9, 0, 7); ctx.fillStyle = c.ok; ctx.fill();
      if (attack) { ctx.beginPath(); ctx.arc(van[0], van[1], 17, 0, 7); ctx.strokeStyle = c.ok; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]); }
      if (wide) {
        ctx.font = `600 12px ${c.font}`; ctx.fillStyle = c.ok; ctx.textAlign = "right";
        ctx.fillText(attack ? "PROTECTED POSITION" : "REAL POSITION", van[0] - 30, van[1] - 22);
        ctx.fillStyle = c.ink3; ctx.font = "500 12px system-ui, sans-serif"; ctx.fillText(attack ? "tracked by odometer" : "Angers, centre loop", van[0] - 30, van[1] - 6);
      }

      // the trust gauge
      const wob = Math.sin(t * 2.3) * 1.5 + Math.sin(t * 5.1) * 0.8;
      let trust = 95 + wob;
      if (attack) trust = Math.max(12, 95 - since * 420) + (since > 0.3 ? Math.sin(t * 3) * 0.6 : 0);
      else if (t >= ATTACK_END) trust = Math.min(95, 12 + (t - ATTACK_END) * 60) + wob * 0.3;
      const col = trust >= 75 ? c.ok : trust >= 50 ? c.warn : c.bad;
      const gx = wide ? w * 0.86 : w * 0.82, gy = wide ? h * 0.8 : h * 0.1, R = wide ? 58 : 34;
      ctx.lineCap = "round"; ctx.lineWidth = wide ? 8 : 5;
      ctx.beginPath(); ctx.arc(gx, gy, R, Math.PI * 0.75, Math.PI * 2.25); ctx.strokeStyle = c.line; ctx.stroke();
      ctx.beginPath(); ctx.arc(gx, gy, R, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * Math.max(0.02, trust / 100))); ctx.strokeStyle = col; ctx.stroke();
      ctx.textAlign = "center"; ctx.fillStyle = col; ctx.font = `600 ${wide ? 44 : 24}px ${c.font}`;
      ctx.fillText(String(Math.round(trust)), gx, gy + (wide ? 14 : 8));
      if (wide) {
        ctx.font = `600 11px ${c.font}`; ctx.fillStyle = c.ink3;
        ctx.fillText("TRUST", gx, gy + 36);
        ctx.fillStyle = col; ctx.font = `600 13px ${c.font}`;
        ctx.fillText(trust >= 75 ? "TRUSTED" : trust >= 50 ? "DEGRADED" : trust >= 25 ? "SUSPICIOUS" : "UNTRUSTED", gx, gy + R + 26);
      }
      ctx.globalAlpha = 1;
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="hero-scene" aria-hidden="true" />;
}
