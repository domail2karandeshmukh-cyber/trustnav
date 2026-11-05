"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconClose, IconPause, IconPlay } from "./Icons";
import { LANGS, LANG_ORDER, SCENES, defaultLang, fill, type Lang, type SceneId } from "@/lib/i18n-explainer";
import { hasVoice, speak, speechAvailable, stopSpeech } from "@/lib/speech";

/** What the explainer may do to the live console while it talks. */
export interface ExplainApi {
  fitAll: () => void;
  selectTrusted: () => { name: string; trust: number } | null;
  selectHeld: () => { name: string; gap: string } | null;
  deselect: () => void;
  openAlerts: () => void;
  /** the view keeps the bottom of the map clear for the caption while this is true */
  setActive: (on: boolean) => void;
}

/** Where the spotlight goes for each scene; the first selector that exists wins. */
const TARGET: Record<SceneId, string[]> = {
  welcome: [".kpis"],
  trusted: [".detail .figure", ".detail"],
  colours: [".live-legend"],
  attack: [".detail .plain", ".detail"],
  checks: [".detail .reasons", ".detail .plain"],
  alerts: [".alerts-float", ".incs"],
  respond: [".detail .playbook", ".detail .resp", ".detail"],
  pages: [".rail"],
  end: [],
};

const words = (t: string) => t.split(/\s+/).length;

/**
 * A narrated, video-style walkthrough of the live console: nine scenes, each
 * moves the camera or selects a platform, highlights one panel, shows a caption
 * and speaks it in the chosen language. Voice comes from the browser; when a
 * language has no voice on this device the captions are timed instead.
 */
export default function Explainer({ api, onClose }: { api: ExplainApi; onClose: () => void }) {
  const [lang, setLangState] = useState<Lang>(() => defaultLang());
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [text, setText] = useState("");
  const [voiceOk, setVoiceOk] = useState<boolean | null>(null);
  const [spot, setSpot] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const run = useRef(0);
  const playingRef = useRef(playing); playingRef.current = playing;
  const pack = LANGS[lang];

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem("trustnav-lang", l); } catch { /* storage blocked */ }
  };

  // spotlight follows the target element (panels re-render, markers move)
  const target = useRef<string[]>([]);
  useEffect(() => {
    const tick = () => {
      for (const sel of target.current) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el && el.offsetParent !== null) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { setSpot({ x: r.left - 8, y: r.top - 8, w: r.width + 16, h: r.height + 16 }); return; }
        }
      }
      setSpot(null);
    };
    tick();
    const t = setInterval(tick, 400);
    window.addEventListener("resize", tick);
    return () => { clearInterval(t); window.removeEventListener("resize", tick); };
  }, [idx]);

  // one scene: act, caption, speak (or time), then advance
  const play = useCallback(async (i: number, l: Lang) => {
    const me = ++run.current;
    stopSpeech();
    const id = SCENES[i];
    const p = LANGS[l];
    let vars: Record<string, string | number> = {};
    let caption = p.s[id];
    if (id === "welcome" || id === "end") { api.deselect(); api.fitAll(); }
    if (id === "trusted") { const t = api.selectTrusted(); if (t) vars = { name: t.name, trust: Math.round(t.trust) }; else caption = p.s.welcome; }
    if (id === "attack") { const h = api.selectHeld(); if (h) vars = h; else caption = p.noAttack; }
    if (id === "checks" || id === "respond") { if (!document.querySelector(".detail")) { api.selectHeld() ?? api.selectTrusted(); } }
    if (id === "alerts") api.openAlerts();
    target.current = TARGET[id];
    const spoken = fill(caption, vars);
    setText(spoken);
    const ok = speechAvailable() && hasVoice(p.code, p.fallbackCode);
    setVoiceOk(ok);
    // let the panel render and the camera start before the voice begins
    await new Promise((r) => setTimeout(r, 700));
    if (run.current !== me) return;
    let finished = false;
    if (ok) finished = await speak(spoken, p.code, p.fallbackCode);
    if (run.current !== me) return;
    if (!finished) {
      const ms = Math.min(26000, Math.max(5000, words(spoken) * 420));
      await new Promise((r) => setTimeout(r, ms));
      if (run.current !== me) return;
    }
    if (!playingRef.current) return;
    if (i + 1 < SCENES.length) setIdx(i + 1);
    else setPlaying(false);
  }, [api]);

  useEffect(() => { if (playing) play(idx, lang); else { run.current++; stopSpeech(); } }, [idx, lang, playing, play]);
  useEffect(() => { api.setActive(true); return () => { run.current++; stopSpeech(); api.deselect(); api.setActive(false); }; }, [api]);

  const go = (n: number) => { const next = Math.max(0, Math.min(SCENES.length - 1, n)); setIdx(next); setPlaying(true); };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      else if (e.key === " ") { e.preventDefault(); e.stopPropagation(); setPlaying((v) => !v); }
      else if (e.key === "ArrowRight") { e.stopPropagation(); go(idx + 1); }
      else if (e.key === "ArrowLeft") { e.stopPropagation(); go(idx - 1); }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, onClose]);

  return (
    <>
      {spot && (
        <>
          <div className="spot-dim" style={{ left: 0, top: 0, right: 0, height: Math.max(0, spot.y) }} aria-hidden="true" />
          <div className="spot-dim" style={{ left: 0, top: spot.y + spot.h, right: 0, bottom: 0 }} aria-hidden="true" />
          <div className="spot-dim" style={{ left: 0, top: spot.y, width: Math.max(0, spot.x), height: spot.h }} aria-hidden="true" />
          <div className="spot-dim" style={{ left: spot.x + spot.w, top: spot.y, right: 0, height: spot.h }} aria-hidden="true" />
          <div className="spot" style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h }} aria-hidden="true" />
        </>
      )}
      <div className="caption explainer" role="dialog" aria-label={pack.ui.title} lang={pack.code}>
        <div className="present-head">
          <span className="present-kicker">{pack.ui.title}</span>
          <span className="present-count">{pack.ui.scene} {idx + 1} / {SCENES.length}</span>
        </div>
        <div className="caption-dots" aria-hidden="true">{SCENES.map((_, k) => <i key={k} className={k === idx ? "on" : k < idx ? "past" : ""} />)}</div>
        <p className="explain-text" aria-live="polite">{text}</p>
        {voiceOk === false && <p className="explain-note">{pack.ui.noVoice}</p>}
        <div className="caption-actions explain-actions">
          <label className="lang-pick">
            <span>{pack.ui.language}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={pack.ui.language}>
              {LANG_ORDER.map((l) => <option key={l} value={l}>{LANGS[l].name}</option>)}
            </select>
          </label>
          <button className="btn sm" onClick={() => go(idx - 1)} disabled={idx === 0}>{pack.ui.prev}</button>
          <button className="btn sm primary" onClick={() => setPlaying((v) => !v)} aria-label={playing ? pack.ui.pause : pack.ui.resume}>
            {playing ? <IconPause size={15} /> : <IconPlay size={15} />} {playing ? pack.ui.pause : pack.ui.resume}
          </button>
          <button className="btn sm" onClick={() => go(idx + 1)} disabled={idx === SCENES.length - 1}>{pack.ui.next}</button>
          <button className="iconbtn" onClick={onClose} aria-label={pack.ui.close}><IconClose size={16} /></button>
        </div>
      </div>
    </>
  );
}
