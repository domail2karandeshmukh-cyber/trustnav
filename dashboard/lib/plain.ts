import type { Frame, Status } from "./types";
import { dist, span } from "./format";

/**
 * Plain-language layer. Everything here is derived from the evidence the engine
 * produced (rule codes, the model's lead input, the response), never from the
 * simulator's attack label, so the same sentences work on a real receiver.
 */

export interface Plain { title: string; body: string; tone: Status }

const has = (f: Frame, code: string) => f.why.some((r) => r.code === code);
const lead = (f: Frame) => f.why[0];
const mlAbout = (f: Frame, words: string[]) => {
  const ml = f.why.find((r) => r.code === "ML_ANOMALY");
  if (!ml) return false;
  const t = (ml.title + " " + ml.detail).toLowerCase();
  return words.some((w) => t.includes(w));
};

export function plainVerdict(f: Frame | null, kind: "vehicle" | "drone"): Plain | null {
  if (!f) return null;
  const thing = kind === "drone" ? "drone" : "van";
  const r = f.resp;
  const response = r && r.mode === "hold"
    ? ` TrustNav has stopped passing this position on${r.gap_m != null ? `: the receiver's claim is ${dist(r.gap_m)} from where the ${thing} really is` : ""}. It is tracking the ${thing} by its odometer${r.source === "route_odometer" ? " along its route" : ""} (${span(r.held_s)} so far).${r.action === "ISOLATE" ? ` Treat this ${thing} as compromised until it is verified.` : " Check it by phone or camera before acting on it."}`
    : "";

  if (!f.fix || f.lat == null) {
    const jam = has(f, "R_JAMMING_INDICATOR");
    return {
      tone: f.st,
      title: jam ? "Satellite signal is being jammed" : "No satellite position",
      body: (jam
        ? `A radio noise source is drowning the satellite signals, so the receiver cannot work out where the ${thing} is.`
        : `The receiver cannot see enough satellites to compute a position.`) + response,
    };
  }

  if (f.st === "TRUSTED") {
    return { tone: f.st, title: "Position can be believed", body: `It moves like a ${thing}, stays on its route, and the satellite signals look genuine. Nothing to do.` };
  }

  if (f.st === "DEGRADED") {
    const signal = has(f, "R_CN0_SHIFT") || has(f, "R_SATELLITE_SHIFT") || has(f, "R_DOP_DEGRADATION") || mlAbout(f, ["c/n0", "pdop", "satellite"]);
    return {
      tone: f.st,
      title: "Minor doubts, nothing to act on",
      body: signal
        ? "Signal quality dipped for a moment, which buildings, bridges and trees cause every day. The score stays above the alert line."
        : `Something looks slightly unusual (${lead(f)?.title.toLowerCase() ?? "ordinary noise"}) but stays above the alert line.`,
    };
  }

  // suspicious or untrusted: name the attack pattern from the strongest evidence
  if (has(f, "R_OSNMA_FAILED")) {
    return { tone: f.st, title: "Satellite data is forged", body: `The Galileo satellites' digital signature does not match the navigation data the receiver is using: someone is transmitting fake Galileo messages.` + response };
  }
  if (has(f, "R_POSITION_JUMP") || has(f, "R_IMPOSSIBLE_SPEED")) {
    const jump = f.why.find((x) => x.code === "R_POSITION_JUMP" || x.code === "R_IMPOSSIBLE_SPEED");
    return { tone: f.st, title: "Satellite signal is being faked (spoofing)", body: `The receiver says the ${thing} ${jump?.code === "R_POSITION_JUMP" ? `jumped ${jump.detail.match(/moved ([\d,]+ m)/)?.[1] ?? "a long way"} in one second` : "is moving faster than it physically can"}, which is impossible. A transmitter is imitating the satellites.` + response };
  }
  if (has(f, "R_JAMMING_INDICATOR") || has(f, "R_FIX_LOST")) {
    return { tone: f.st, title: "Satellite signal is being jammed", body: `A radio noise source is drowning the satellite signals; the receiver is losing satellites and its position is unreliable.` + response };
  }
  const off = r?.gap_m ?? f.f?.route_deviation_m ?? 0;
  if (has(f, "R_ROUTE_DEVIATION") || mlAbout(f, ["route deviation"])) {
    if (off > 500) {
      return { tone: f.st, title: "Satellite signal is being faked (spoofing)", body: `The receiver places the ${thing} ${dist(off)} from the road it is actually on. A transmitter is imitating the satellites and feeding a false position.` + response };
    }
    return { tone: f.st, title: "Position is drifting off its road", body: `The position is slowly being pushed away from the road the ${thing} is on while the signal looks clean: the pattern of a careful spoofer.` + response };
  }
  if (mlAbout(f, ["c/n0", "pdop", "residual", "clock", "satellite", "doppler"])) {
    return { tone: f.st, title: "Signal looks artificial", body: `The satellite signals are stronger and more uniform than real ones, and the range measurements disagree with each other: a transmitter is imitating the satellites.` + response };
  }
  if (has(f, "R_OSNMA_LOST")) {
    return { tone: f.st, title: "Galileo's authenticated data disappeared", body: `The signed Galileo messages stopped while the receiver still reports a position. On its own this is ambiguous (buildings can cause it); with other evidence it points to a GPS-only spoofer.` + response };
  }
  const l = lead(f);
  return { tone: f.st, title: "Position cannot be trusted", body: (l ? `${l.title}: ${gloss(l.detail)}` : "The combined evidence crossed the alert line.") + response };
}

/** Fleet-level sentence for the panel header. */
export function plainFleet(total: number, names: { untrusted: string[]; suspicious: string[]; degraded: number }, held: number): string {
  const bad = [...names.untrusted, ...names.suspicious];
  if (!total) return "";
  if (!bad.length && !names.degraded) return `All ${total} positions can be believed right now.`;
  if (!bad.length) return `${names.degraded} with minor doubts, nothing to act on.`;
  const list = bad.length <= 3 ? bad.join(", ") : `${bad.slice(0, 2).join(", ")} and ${bad.length - 2} more`;
  return `${bad.length} of ${total} cannot be believed: ${list}.${held ? ` ${held === 1 ? "Its" : "Their"} false position${held > 1 ? "s are" : " is"} refused and estimated from the odometer.` : ""}`;
}

/** Engineer's wording -> everyday wording, for evidence text. */
const GLOSS: [RegExp, string][] = [
  [/\bmean C\/N0\b/g, "average signal strength (C/N0)"],
  [/\bMean C\/N0\b/g, "Average signal strength (C/N0)"],
  [/\bC\/N0 spread\b/g, "signal-strength spread (C/N0)"],
  [/(?<!\()\bC\/N0\b(?! spread)/g, "signal strength (C/N0)"],
  [/\bPDOP\b/g, "satellite geometry (PDOP)"],
  [/\bpseudorange residual\b/gi, "range-measurement disagreement"],
  [/\bRange residual\b/g, "Range-measurement disagreement"],
  [/\bOSNMA tag verification\b/g, "Galileo signature (OSNMA) check"],
  [/^Fix moved\b/g, "Position moved"],
  [/^Fix lies\b/g, "Position lies"],
  [/\bin one epoch\b/g, "in one second"],
  [/\bthe last 5 epochs\b/g, "the last 5 seconds"],
  [/\bepochs\b/g, "seconds"],
  [/\bepoch\b/g, "second"],
  [/\bjamming indicator\b/g, "jamming indicator (radio noise level)"],
];
export function gloss(text: string): string {
  let out = text;
  for (const [re, rep] of GLOSS) out = out.replace(re, rep);
  return out;
}
