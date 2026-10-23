import type { Osnma, Status } from "./types";

export const STATUS_COLOR: Record<Status, string> = {
  TRUSTED: "var(--trusted)",
  DEGRADED: "var(--degraded)",
  SUSPICIOUS: "var(--suspicious)",
  UNTRUSTED: "var(--untrusted)",
};

/** Hex values for MapLibre paint properties, which cannot read CSS variables. */
export const STATUS_HEX: Record<Status, string> = {
  TRUSTED: "#11865f",
  DEGRADED: "#c28a00",
  SUSPICIOUS: "#d4561c",
  UNTRUSTED: "#c2185b",
};

export const STATUS_WORD: Record<Status, string> = {
  TRUSTED: "Trusted",
  DEGRADED: "Degraded",
  SUSPICIOUS: "Suspicious",
  UNTRUSTED: "Untrusted",
};

export const OSNMA_INFO: Record<Osnma, { word: string; tone: string; help: string }> = {
  verified: { word: "Verified", tone: "var(--trusted)", help: "Galileo navigation data carries valid OSNMA signatures." },
  pending: { word: "Pending", tone: "var(--ink-2)", help: "Receiver is still collecting the keys it needs (about 40 s after start)." },
  unavailable: { word: "Lost", tone: "var(--degraded)", help: "Authenticated Galileo data disappeared. Ambiguous on its own: buildings can cause it, so can a GPS-only spoofer." },
  failed: { word: "Failed", tone: "var(--untrusted)", help: "Signature check failed: the Galileo data was not signed by Galileo. Strong evidence of forgery." },
  unknown: { word: "Unknown", tone: "var(--ink-3)", help: "Receiver does not report OSNMA. Never treated as a failure." },
};

export const ATTACK_WORD: Record<string, string> = {
  none: "Normal",
  teleport: "Teleport spoof",
  drift: "Drift spoof",
  signal: "Signal anomaly",
  stealth_drift: "Stealth drift",
  osnma_forgery: "OSNMA forgery",
  jamming: "Jamming",
  drone_drift: "Drone spoof",
};

export const FEATURE_LABEL: Record<string, [string, string]> = {
  derived_speed_mps: ["Derived speed", "m/s"],
  reported_speed_mps: ["Reported speed", "m/s"],
  speed_disagreement_mps: ["Speed disagreement", "m/s"],
  acceleration_mps2: ["Acceleration", "m/s²"],
  distance_m: ["Step distance", "m"],
  heading_rate_dps: ["Heading rate", "°/s"],
  route_deviation_m: ["Route deviation", "m"],
  cn0_mean_dbhz: ["C/N0 mean", "dB-Hz"],
  cn0_delta_dbhz: ["C/N0 change", "dB-Hz"],
  cn0_std_dbhz: ["C/N0 spread", "dB-Hz"],
  pdop: ["PDOP", ""],
  pseudorange_residual_m: ["Range residual", "m"],
  clock_drift_delta_nsps: ["Clock drift change", "ns/s"],
  clock_bias_delta_ns: ["Clock bias jump", "ns"],
  satellite_count: ["Satellites", ""],
  sensor_speed_mismatch_mps: ["GNSS-inertial mismatch", "m/s"],
};

export function fmt(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const a = Math.abs(v);
  if (a >= 10000) return Math.round(v).toLocaleString("en-GB");
  if (a >= 100) return v.toFixed(0);
  return v.toFixed(digits);
}

export function pct(v: number, digits = 1) {
  return `${(v * 100).toFixed(digits)}%`;
}

export function clock(iso: string | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function mmss(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function statusOf(trust: number): import("./types").Status {
  return trust >= 75 ? "TRUSTED" : trust >= 50 ? "DEGRADED" : trust >= 25 ? "SUSPICIOUS" : "UNTRUSTED";
}

/** "4 s", "2 min 05 s" */
export function span(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}
