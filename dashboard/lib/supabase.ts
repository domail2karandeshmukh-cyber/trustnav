import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Frame, Incident } from "./types";

// The publishable key only allows what the database's row-level security
// permits: reading live data and calling the passcode-checked demo controls.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ehskwxnzatfvsiqmnsia.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY ?? "sb_publishable_fAG_hxhBqkiJ5ycoCqZ8bQ_T_8Y3IE0";

let client: SupabaseClient | null = null;
export function supabase() {
  if (!client) client = createClient(URL, KEY, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 20 } } });
  return client;
}

/** Database row -> the engine's compact frame shape used by every view. */
export function rowToFrame(r: any): Frame {
  return {
    device_id: r.device_id,
    s: r.seq,
    t: r.t,
    lat: r.lat,
    lon: r.lon,
    trust: r.trust,
    st: r.status,
    rr: r.rule_risk,
    mr: r.ml_risk,
    hr: r.hybrid_risk,
    spd: r.speed_mps,
    hdg: r.heading_deg,
    sats: r.sats,
    osnma: r.osnma ?? "unknown",
    fix: r.fix,
    atk: r.attack,
    kind: r.attack_kind,
    f: r.features ?? {},
    why: r.why ?? [],
  };
}

export function rowToIncident(r: any): Incident {
  return {
    id: r.id,
    device_id: r.device_id,
    scenario: r.scenario,
    severity: r.severity,
    status: r.status,
    title: r.title,
    start: r.start_seq,
    end: r.end_seq,
    opened_at: r.opened_at,
    closed_at: r.closed_at,
    min_trust: r.min_trust,
    observations: r.observations,
    evidence: r.evidence ?? [],
  };
}
