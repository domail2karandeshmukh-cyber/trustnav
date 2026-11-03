"use client";

import { useEffect } from "react";
import { IconClose, IconPlay } from "./Icons";
import { STATUS_COLOR } from "@/lib/format";

/** "How to read this screen": the whole console in plain words, one page, for a first-time viewer. */
export default function Guide({ onClose, onStory, onPresent }: { onClose: () => void; onStory: () => void; onPresent: () => void }) {
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
          Every second, for each van and drone, TrustNav checks whether its satellite position can be believed and gives it a score
          from <b>0</b> (certainly false) to <b>100</b> (certainly true). Below <b>50</b> it refuses the position and tracks the vehicle by its
          odometer instead, so nothing downstream acts on a lie.
        </p>

        <div className="guide-cols">
          <section>
            <h3>The map</h3>
            <ul className="guide-legend">
              <li><i className="g-ring" style={{ borderColor: STATUS_COLOR.TRUSTED }} /><span><b>Ring around a vehicle</b>: its trust score, drawn as a gauge. Green is trusted, amber has minor doubts, orange is suspicious, pink is untrusted.</span></li>
              <li><i className="g-ring hollow" style={{ borderColor: STATUS_COLOR.UNTRUSTED }} /><span><b>Hollow marker, "refused"</b>: the position the receiver claims. TrustNav is not passing it on.</span></li>
              <li><i className="g-shield" /><span><b>Teal shield</b>: where TrustNav believes the vehicle really is, worked out from its odometer along its route.</span></li>
              <li><i className="g-dash" /><span><b>Dashed line between them</b>: the lie, with its length. In the teleport attack it is 8 km.</span></li>
              <li><i className="g-trail" /><span><b>Coloured trail</b>: the last 90 seconds of reported positions, coloured by trust.</span></li>
            </ul>
          </section>
          <section>
            <h3>The panels</h3>
            <ul className="guide-legend">
              <li><i className="g-num">76</i><span><b>Fleet trust</b> (top left): the average score, with the share of vehicles in each band.</span></li>
              <li><i className="g-badge">ISOLATED</i><span><b>Alerts</b> (top right): one card per incident, with the last minute of trust, the action taken, and a tick to acknowledge it.</span></li>
              <li><i className="g-text">Why</i><span><b>Click any vehicle</b>: first a verdict in plain words, then the evidence (each line names what was measured and the limit it crossed), then what to do.</span></li>
              <li><i className="g-text">1 2 3 4</i><span><b>Pages</b>: Live is now; Replay plays ten recorded attacks; Results has the numbers; Method explains how it decides.</span></li>
            </ul>
          </section>
        </div>

        <section>
          <h3>The three things that go wrong</h3>
          <div className="guide-attacks">
            <div><b>Jamming</b><span>A noise transmitter drowns the satellites. The receiver loses its position. TrustNav keeps an estimate from the odometer, so the screen never goes blank.</span></div>
            <div><b>Spoofing</b><span>A transmitter imitates the satellites and feeds a false position, either a jump or a slow drift. TrustNav notices the impossible motion, the too-perfect signal, or the drift off the road, and refuses the position.</span></div>
            <div><b>Forgery</b><span>Fake Galileo navigation data. Galileo signs its messages (OSNMA), so the signature fails and the forgery is caught within seconds.</span></div>
          </div>
        </section>

        <div className="guide-actions">
          <button className="btn primary" onClick={() => { onClose(); onStory(); }}><IconPlay size={16} /> Watch an attack, 60 seconds</button>
          <button className="btn" onClick={() => { onClose(); onPresent(); }}>Presentation mode (P)</button>
          <span className="guide-hint">Press <kbd>?</kbd> any time to see this again. All attacks are simulated in software.</span>
        </div>
      </div>
    </div>
  );
}
