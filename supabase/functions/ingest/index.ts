// TrustNav ingest: the only write path for live engines and receivers.
// Auth: x-trustnav-token header, compared by SHA-256 hash to ingest_tokens.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const num = (v: unknown) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const token = req.headers.get("x-trustnav-token") ?? "";
  if (token.length < 24) return json(401, { error: "missing token" });
  const { data: tok } = await db.from("ingest_tokens").select("id").eq("token_hash", await sha256(token)).is("revoked_at", null).maybeSingle();
  if (!tok) return json(401, { error: "invalid token" });

  let p: any;
  try { p = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }

  if (p.type === "start_run") {
    const devices = (p.devices ?? []).slice(0, 50).map((d: any) => ({
      id: String(d.id).slice(0, 32), name: String(d.name).slice(0, 80),
      kind: d.kind === "drone" ? "drone" : "vehicle", profile: String(d.profile ?? "generic_road_vehicle"),
      route_slug: d.route_slug ?? null,
    }));
    if (devices.length) {
      const { error } = await db.from("devices").upsert(devices);
      if (error) return json(500, { error: error.message });
    }
    await db.from("runs").update({ status: "stopped", ended_at: new Date().toISOString() })
      .eq("status", "running").in("mode", ["live_engine", "receiver"]);
    const mode = p.mode === "receiver" ? "receiver" : "live_engine";
    const { data, error } = await db.from("runs").insert({
      mode, label: String(p.label ?? "Live engine").slice(0, 120), duration_s: num(p.duration_s),
      engine_version: p.engine_version ?? null, model_version: p.model_version ?? null,
    }).select("id").single();
    if (error) return json(500, { error: error.message });
    return json(200, { run_id: data.id });
  }

  if (p.type === "frames") {
    const frames = (p.frames ?? []).slice(0, 100).map((f: any) => ({
      run_id: p.run_id, device_id: f.device_id, seq: f.s, t: f.t, lat: num(f.lat), lon: num(f.lon),
      trust: num(f.trust), status: f.st, rule_risk: num(f.rr), ml_risk: num(f.mr), hybrid_risk: num(f.hr),
      osnma: f.osnma ?? null, fix: f.fix !== false, sats: num(f.sats), speed_mps: num(f.spd), heading_deg: num(f.hdg),
      attack: typeof f.atk === "boolean" ? f.atk : null, attack_kind: f.kind ?? null, features: f.f ?? null, why: f.why ?? null,
    }));
    if (frames.length) {
      const { error } = await db.from("frames").upsert(frames, { onConflict: "run_id,device_id,seq", ignoreDuplicates: true });
      if (error) return json(500, { error: error.message });
    }
    const incidents = (p.incidents ?? []).slice(0, 100).map((i: any) => ({
      run_id: p.run_id, device_id: i.device_id, scenario: i.scenario ?? null, severity: i.severity, status: i.status,
      title: String(i.title).slice(0, 160), start_seq: i.start, end_seq: i.end, opened_at: i.opened_at,
      closed_at: i.closed_at ?? null, min_trust: num(i.min_trust), observations: num(i.observations),
      evidence: i.evidence ?? null, updated_at: new Date().toISOString(),
    }));
    if (incidents.length) {
      const { error } = await db.from("incidents").upsert(incidents, { onConflict: "run_id,device_id,start_seq" });
      if (error) return json(500, { error: error.message });
    }
    return json(200, { frames: frames.length, incidents: incidents.length });
  }

  if (p.type === "end_run") {
    await db.from("runs").update({ status: "finished", ended_at: new Date().toISOString() }).eq("id", p.run_id);
    return json(200, { ok: true });
  }

  return json(400, { error: "unknown type" });
});
