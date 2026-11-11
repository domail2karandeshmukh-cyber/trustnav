"use client";

import { useEffect } from "react";
import { IconClose, IconPlay } from "./Icons";
import { STATUS_COLOR } from "@/lib/format";

/** "How to read this screen": the whole console in plain words, one page, for a first-time viewer. */
export default function Guide({ onClose, onStory, onPresent, onExplain }: { onClose: () => void; onStory: () => void; onPresent: () => void; onExplain?: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [onClose]);
  return (
    <div className="guide-back" role="dialog" aria-label="How to read this screen" onClick={onClose}>
      <div className="guide" onClick={(e) => e.stopPropagation()}>
        <div className="guide-head">
          <div>
            <div className="hero-kicker">TrustNav</div>
            <h2>How to read this screen</h2>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><IconClose size={18} /></button>
        </div>

        <p className="guide-lede">
          Every second, each van and drone gets a score from <b>0</b> (certainly false) to <b>100</b> (certainly true).
          Below <b>50</b> the position is refused and the vehicle is tracked by its odometer.
        </p>

        <div className="guide-cols">
          <section>
            <h3>The map</h3>
            <ul className="guide-legend">
              <li><i className="g-ring" style={{ borderColor: STATUS_COLOR.TRUSTED }} /><span><b>Ring around a vehicle</b>: its trust score as a gauge, from green to pink.</span></li>
              <li><i className="g-ring hollow" style={{ borderColor: STATUS_COLOR.UNTRUSTED }} /><span><b>Hollow marker, "refused"</b>: the position the receiver claims, not passed on.</span></li>
              <li><i className="g-shield" /><span><b>Teal shield</b>: where the vehicle really is, from its odometer along its route.</span></li>
              <li><i className="g-dash" /><span><b>Dashed line between them</b>: the lie, with its length.</span></li>
              <li><i className="g-trail" /><span><b>Coloured trail</b>: the last 90 seconds, coloured by trust.</span></li>
            </ul>
          </section>
          <section>
            <h3>The panels</h3>
            <ul className="guide-legend">
              <li><i className="g-num">76</i><span><b>Fleet trust</b> (top left): the average score and the share in each band.</span></li>
              <li><i className="g-badge">ISOLATED</i><span><b>Alerts</b> (top right): one card per incident, with the action taken.</span></li>
              <li><i className="g-text">Why</i><span><b>Click any vehicle</b>: the verdict in plain words, the evidence, what to do.</span></li>
              <li><i className="g-text">1 2 3 4</i><span><b>Pages</b>: Live is now, Replay plays ten recorded attacks, Results has the numbers, Method explains.</span></li>
            </ul>
          </section>
        </div>

        <section>
          <h3>The three things that go wrong</h3>
          <div className="guide-attacks">
            <div><b>Jamming</b><span>Noise drowns the satellites and the receiver loses its position. TrustNav keeps an estimate from the odometer.</span></div>
            <div><b>Spoofing</b><span>A transmitter imitates the satellites and feeds a false position. TrustNav notices the impossible motion or the drift off the road, and refuses it.</span></div>
            <div><b>Forgery</b><span>Fake Galileo data. Galileo signs its messages, so the signature fails within seconds.</span></div>
          </div>
        </section>

        <div className="guide-actions">
          <button className="btn primary" onClick={() => { onClose(); onStory(); }}><IconPlay size={16} /> Watch an attack, 60 seconds</button>
          {onExplain && <button className="btn" onClick={() => { onClose(); onExplain(); }}>Explain it to me, with voice</button>}
          <button className="btn" onClick={() => { onClose(); onPresent(); }}>Presentation mode (P)</button>
          <span className="guide-hint">Press <kbd>?</kbd> any time to see this again. All attacks are simulated in software.</span>
        </div>
      </div>
    </div>
  );
}
