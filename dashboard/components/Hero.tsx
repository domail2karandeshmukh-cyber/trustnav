"use client";

import { useEffect, useState } from "react";
import { IconPlay } from "./Icons";
import { HERO, HERO_LANGS, HERO_NAMES, heroLang, type HeroLang } from "@/lib/i18n-hero";

const KEY = "trustnav-intro-seen";

/** Full-screen opening over the live map: one sentence, three doors, ten languages. Shown once per browser session. */
export default function Hero({ onStory, onConsole, onExplain }: { onStory: () => void; onConsole: () => void; onExplain?: () => void }) {
  const [show, setShow] = useState(false);
  const [lang, setLangState] = useState<HeroLang>("en");
  useEffect(() => {
    setLangState(heroLang());
    try { if (!sessionStorage.getItem(KEY)) setShow(true); else onConsole(); } catch { setShow(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setLang = (l: HeroLang) => { setLangState(l); try { localStorage.setItem("trustnav-lang", l); } catch { /* storage blocked */ } };
  const close = () => { setShow(false); try { sessionStorage.setItem(KEY, "1"); } catch { /* storage blocked */ } };
  useEffect(() => {
    if (!show) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); onConsole(); } if (e.key === "Enter") { close(); onStory(); } };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);
  if (!show) return null;
  const t = HERO[lang];
  return (
    <div className="hero" role="dialog" aria-label="Welcome" lang={lang}>
      <div className="hero-in">
        <div className="hero-top">
          <div className="hero-kicker">TrustNav</div>
          <label className="hero-lang">
            <span>{t.language}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as HeroLang)} aria-label={t.language}>
              {HERO_LANGS.map((l) => <option key={l} value={l}>{HERO_NAMES[l]}</option>)}
            </select>
          </label>
        </div>
        <h1>{t.title}</h1>
        <p>{t.lede}</p>
        <div className="hero-actions">
          <button className="btn hero-btn primary" onClick={() => { close(); onStory(); }}><IconPlay size={18} /> {t.story}</button>
          {onExplain && <button className="btn hero-btn" onClick={() => { close(); onConsole(); onExplain(); }}>{t.explain}</button>}
          <button className="btn hero-btn" onClick={() => { close(); onConsole(); }}>{t.console}</button>
        </div>
        <div className="hero-facts">
          {t.facts.map(([b, s]) => <span key={b}><b>{b}</b> {s}</span>)}
        </div>
        <p className="hero-foot">{t.foot}</p>
      </div>
    </div>
  );
}

export const resetHero = () => { try { sessionStorage.removeItem(KEY); } catch { /* storage blocked */ } };
