"use client";

import { useEffect, useState } from "react";
import { IconPlay } from "./Icons";

const KEY = "trustnav-intro-seen";

/** Full-screen opening over the live map: one sentence, two doors. Shown once per browser session. */
export default function Hero({ onStory, onConsole }: { onStory: () => void; onConsole: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { if (!sessionStorage.getItem(KEY)) setShow(true); else onConsole(); } catch { setShow(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const close = () => { setShow(false); try { sessionStorage.setItem(KEY, "1"); } catch { /* storage blocked */ } };
  useEffect(() => {
    if (!show) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); onConsole(); } if (e.key === "Enter") { close(); onStory(); } };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);
  if (!show) return null;
  return (
    <div className="hero" role="dialog" aria-label="Welcome">
      <div className="hero-in">
        <div className="hero-kicker">TrustNav</div>
        <h1>Can this position<br />be trusted?</h1>
        <p>Every second, for every vehicle and drone, TrustNav scores how much its satellite position can be believed, catches spoofing and jamming, and says why in plain words.</p>
        <div className="hero-actions">
          <button className="btn hero-btn primary" onClick={() => { close(); onStory(); }}><IconPlay size={18} /> Watch an attack, 60 seconds</button>
          <button className="btn hero-btn" onClick={() => { close(); onConsole(); }}>Open the live console</button>
        </div>
        <div className="hero-facts">
          <span><b>7 of 7</b> attacks caught</span>
          <span><b>0.44%</b> false alarms</span>
          <span><b>Galileo OSNMA</b> aware</span>
          <span><b>1 Hz</b> live scoring</span>
        </div>
        <p className="hero-foot">Research prototype, ESAIP Angers. Attacks are simulated in software.</p>
      </div>
    </div>
  );
}

export const resetHero = () => { try { sessionStorage.removeItem(KEY); } catch { /* storage blocked */ } };
