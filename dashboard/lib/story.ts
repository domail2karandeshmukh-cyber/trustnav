import type { Incident, Scenario } from "./types";
import { ATTACK_WORD, span } from "./format";

export interface Beat {
  /** second of the run at which this beat starts */
  at: number;
  title: string;
  body: string;
  /** camera: follow the platform closely, or pull back to the whole scene */
  camera: "close" | "wide";
  /** short pause on this beat, in ms of wall time */
  hold?: number;
}

function meters(a: [number, number], b: [number, number]) {
  const k = Math.PI / 180;
  const x = (b[1] - a[1]) * k * Math.cos(((a[0] + b[0]) / 2) * k);
  return Math.hypot(x, (b[0] - a[0]) * k) * 6371000;
}

const dist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** Builds the narrated walkthrough of one recorded scenario from its data. */
export function storyFor(sc: Scenario, incidents: Incident[], name: string, latency: number | null): Beat[] {
  const frames = sc.frames;
  const attack = frames.find((f) => f.atk)?.s ?? null;
  const end = frames[frames.length - 1].s;
  const kind = sc.profile === "small_uav" ? "drone" : "van";
  const beats: Beat[] = [];

  if (attack == null) {
    beats.push({ at: 0, camera: "close", hold: 2500, title: `${name} on a normal run`, body: `Nothing is wrong here. Watch how the trust score behaves on an honest ${kind}: this is the baseline every attack is measured against.` });
    const dips = frames.filter((f) => f.trust < 75);
    if (dips.length) beats.push({ at: dips[0].s, camera: "close", hold: 2500, title: "A small dip, no alarm", body: `Trust dips to ${Math.round(Math.min(...dips.map((f) => f.trust)))} for a moment (${dips[0].why[0]?.title.toLowerCase() ?? "ordinary noise"}). It never crosses the alert line, so no incident opens.` });
    beats.push({ at: Math.max(0, end - 20), camera: "wide", hold: 4000, title: "Clean run, no false alarms", body: `${span(end)} on real Angers streets and the score stayed above the line. Low false alarms are what make the real alerts credible.` });
    return beats;
  }

  const pre = Math.max(0, attack - 14);
  beats.push({ at: pre, camera: "close", hold: 3000, title: `${name}, trusted`, body: `A ${kind} on its assigned route. Every second TrustNav checks its position against physics, its own history and Galileo's signatures. Trust is ${Math.round(frames[pre].trust)}.` });

  const atk = frames.find((f) => f.s === attack)!;
  const atkFrame = frames.find((f) => f.s === attack + 2) ?? atk;
  const off = atkFrame.tl && atkFrame.lat != null ? meters([atkFrame.lat, atkFrame.lon!], atkFrame.tl) : 0;
  const what: Record<string, string> = {
    teleport: `A spoofer captures the receiver and throws the reported position ${dist(off)} away in a single second.`,
    drift: `A spoofer starts pulling the reported position sideways, slowly, so no single second looks impossible.`,
    signal: `A spoofer switches on. The signal is suddenly too clean, too strong, and the clock jumps.`,
    stealth_drift: `A relay attack: the real signal is re-broadcast, so Galileo's signatures still verify, but the position drifts off the road.`,
    osnma_forgery: `Forged Galileo data arrives. The signatures do not match what Galileo signed.`,
    jamming: `A jammer drowns the signal. The receiver loses its fix.`,
    drone_drift: `A spoofer pushes the ${kind} off its survey line at about one metre per second.`,
  };
  beats.push({ at: attack, camera: "close", hold: 3500, title: `The attack begins: ${ATTACK_WORD[sc.attack].toLowerCase()}`, body: what[sc.attack] ?? sc.description });

  const first = frames.find((f) => f.s >= attack && f.trust < 50);
  if (first) {
    const top = first.why[0];
    beats.push({ at: first.s, camera: "close", hold: 4500, title: latency != null && latency <= 1 ? "Caught at once" : `Caught after ${span(first.s - attack)}`, body: `Trust falls to ${Math.round(first.trust)}. ${top ? `Strongest evidence: ${top.title.toLowerCase()}, ${top.detail.replace(/\.$/, "")}.` : "The combined score crosses the alert line."}` });
  }
  const inc = incidents.filter((x) => x.scenario === sc.slug).sort((a, b) => a.start - b.start)[0];
  if (inc && (!first || inc.start > first.s + 1)) {
    beats.push({ at: inc.start, camera: "close", hold: 3000, title: "Incident opened", body: `Three seconds below the line: an incident opens and the operator is alerted. Its title names the strongest evidence: ${inc.title.replace(/: \d+ observations$/, "").toLowerCase()}.` });
  }
  const far = frames.find((f) => f.atk && f.tl && f.lat != null && meters([f.lat, f.lon!], f.tl) > 60 && f.s > (first?.s ?? attack) + 5);
  if (far) {
    const m = meters([far.lat!, far.lon!], far.tl!);
    beats.push({ at: far.s, camera: "wide", hold: 4000, title: "Where it really is", body: `The receiver reports the coloured track. The dotted path is where the ${kind} really went: ${dist(m)} apart by now. A driver trusting the screen would be lost.` });
  }
  const rec = frames.find((f) => f.s > attack + 10 && !f.atk && f.trust >= 75);
  if (rec) beats.push({ at: rec.s, camera: "close", hold: 3000, title: "Signal back, trust recovers", body: `The attack ends and the score climbs back above 75. The incident closes on its own after five clean seconds.` });

  const last = Math.min(end, (rec?.s ?? (far?.s ?? (inc?.start ?? first?.s ?? attack))) + 25);
  beats.push({ at: last, camera: "wide", hold: 6000, title: latency == null ? "Missed" : latency <= 1 ? "Detected in the same second" : `Detected in ${span(latency)}`, body: latency == null ? "This one slipped under every threshold." : `Rules alone would ${sc.attack === "stealth_drift" ? "have needed about 3.5 minutes" : sc.attack === "drift" || sc.attack === "signal" || sc.attack === "drone_drift" ? "have missed it entirely" : "have caught it too, but louder attacks are the easy ones"}. The combined score caught 7 of 7 attacks on held-out routes with a 0.44% false alarm rate.` });
  return beats;
}
