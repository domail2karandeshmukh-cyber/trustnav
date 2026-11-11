"use client";

import { useEffect, useState } from "react";

const STEPS = [
  { title: "Every platform, scored every second", body: "Lowest trust first. The strip under each name is its last two minutes." },
  { title: "Click anything to see why", body: "A van on the map or in the list opens its file: the score, the verdict in plain words, the evidence." },
  { title: "Watch an attack happen", body: "About a minute and a half in, one van is spoofed. Replay lets you scrub through every recorded attack." },
];
const KEY = "trustnav-tour-done";

export default function Tour({ onDone, onGuide }: { onDone?: () => void; onGuide?: () => void }) {
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    try { if (!localStorage.getItem(KEY)) setStep(0); } catch { setStep(0); }
  }, []);
  const finish = () => { setStep(null); try { localStorage.setItem(KEY, "1"); } catch { /* storage blocked */ } onDone?.(); };
  if (step == null) return null;
  const s = STEPS[step];
  return (
    <div className="tour" role="dialog" aria-label="Welcome tour">
      <div className="tour-step">{step + 1} of {STEPS.length}</div>
      <h3>{s.title}</h3>
      <p>{s.body}</p>
      <div className="tour-actions">
        <button className="btn sm" onClick={finish}>Skip</button>
        {onGuide && <button className="btn sm" onClick={() => { finish(); onGuide(); }}>Full guide</button>}
        <button className="btn sm primary" onClick={() => (step + 1 < STEPS.length ? setStep(step + 1) : finish())}>{step + 1 < STEPS.length ? "Next" : "Start watching"}</button>
      </div>
    </div>
  );
}

export const resetTour = () => { try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } };
