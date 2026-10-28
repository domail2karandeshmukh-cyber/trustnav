"use client";

import { useEffect, useState } from "react";

const STEPS = [
  { title: "Every platform, scored every second", body: "The list on the left ranks the fleet by trust, lowest first. The coloured strip under each name is the last two minutes: green is trusted, red is untrusted." },
  { title: "Click anything to see why", body: "Select a van on the map or in the list. The panel turns into its file: the trust score, how long it has been in that state, the evidence in plain words, and the raw measurements." },
  { title: "Watch an attack happen", body: "About a minute and a half in, one van is spoofed. Its trust collapses, an alert opens, and the detail panel names the evidence. The Replay page lets you scrub through every recorded attack." },
];
const KEY = "trustnav-tour-done";

export default function Tour({ onDone }: { onDone?: () => void }) {
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
        <button className="btn sm primary" onClick={() => (step + 1 < STEPS.length ? setStep(step + 1) : finish())}>{step + 1 < STEPS.length ? "Next" : "Start watching"}</button>
      </div>
    </div>
  );
}

export const resetTour = () => { try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } };
