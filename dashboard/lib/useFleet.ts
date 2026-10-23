"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rowToFrame, rowToIncident, supabase } from "./supabase";
import type { Device, Frame, Incident, Run } from "./types";

/** Seconds of history kept per device. */
export const KEEP = 300;

/**
 * live: a run is streaming from the database right now.
 * loop: no live run (or the database is unreachable), so the browser plays the
 *       recorded engine output of the cloud demo on a loop.
 */
export type Source = "connecting" | "live" | "loop";

interface DemoFile {
  devices: Device[];
  frames: { device_id: string; offset_s: number; frame: Frame }[];
  events: { device_id: string; offset_s: number; incident: Omit<Incident, "device_id" | "opened_at"> & { scenario?: string } }[];
}

export interface Fleet {
  source: Source;
  run: Run | null;
  devices: Device[];
  frames: Record<string, Frame[]>;
  incidents: Incident[];
  elapsed: number;
  duration: number | null;
  realtime: "connecting" | "up" | "down";
}

const LOOP_START = 70; // open the loop shortly before the first attack (97 s)

export function useFleet(): Fleet {
  const [devices, setDevices] = useState<Device[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [frames, setFrames] = useState<Record<string, Frame[]>>({});
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [realtime, setRealtime] = useState<Fleet["realtime"]>("connecting");
  const [dbChecked, setDbChecked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const buffer = useRef<Frame[]>([]);
  const runRef = useRef<Run | null>(null);
  runRef.current = run;

  const live = run?.status === "running";

  // ---- database ---------------------------------------------------------
  const loadRun = useCallback(async (r: Run | null) => {
    setRun(r);
    setFrames({});
    setIncidents([]);
    if (!r || r.status !== "running") return;
    const db = supabase();
    const { data: last } = await db.from("frames").select("seq").eq("run_id", r.id).order("seq", { ascending: false }).limit(1);
    const top = last?.[0]?.seq ?? 0;
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("frames").select("*").eq("run_id", r.id).gte("seq", top - KEEP)
        .order("seq", { ascending: true }).range(from, from + 999);
      if (error) break;
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const by: Record<string, Frame[]> = {};
    for (const row of rows) (by[row.device_id] ??= []).push(rowToFrame(row));
    setFrames(by);
    const { data: inc } = await db.from("incidents").select("*").eq("run_id", r.id).order("opened_at", { ascending: false });
    setIncidents((inc ?? []).map(rowToIncident));
  }, []);

  useEffect(() => {
    const db = supabase();
    let alive = true;
    const giveUp = setTimeout(() => alive && setDbChecked(true), 6000);
    (async () => {
      try {
        const [{ data: dev }, { data: runs, error }] = await Promise.all([
          db.from("devices").select("*").order("id"),
          db.from("runs").select("*").order("started_at", { ascending: false }).limit(1),
        ]);
        if (!alive) return;
        if (!error) {
          setDevices((dev ?? []) as Device[]);
          await loadRun((runs?.[0] as Run) ?? null);
        }
      } catch { /* unreachable: the loop takes over */ }
      if (alive) setDbChecked(true);
    })();

    const ch = db.channel("trustnav-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "frames" }, (p: any) => {
        if (p.new.run_id === runRef.current?.id) buffer.current.push(rowToFrame(p.new));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, (p: any) => {
        if (p.new?.run_id !== runRef.current?.id) return;
        const inc = rowToIncident(p.new);
        setIncidents((list) => {
          const i = list.findIndex((x) => x.device_id === inc.device_id && x.start === inc.start);
          if (i < 0) return [inc, ...list];
          const copy = list.slice(); copy[i] = inc; return copy;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "runs" }, async (p: any) => {
        if (p.eventType === "INSERT") {
          const { data: dev } = await db.from("devices").select("*").order("id");
          setDevices((dev ?? []) as Device[]);
          loadRun(p.new as Run);
        } else if (p.new?.id === runRef.current?.id) {
          setRun(p.new as Run);
        }
      })
      .subscribe((s) => setRealtime(s === "SUBSCRIBED" ? "up" : s === "CLOSED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? "down" : "connecting"));

    const flush = setInterval(() => {
      setNow(Date.now());
      if (!buffer.current.length) return;
      const batch = buffer.current; buffer.current = [];
      setFrames((prev) => {
        const next = { ...prev };
        for (const f of batch) {
          const arr = (next[f.device_id!] ?? []).slice();
          if (!arr.length || arr[arr.length - 1].s < f.s) arr.push(f);
          next[f.device_id!] = arr.length > KEEP ? arr.slice(arr.length - KEEP) : arr;
        }
        return next;
      });
    }, 500);
    return () => { alive = false; clearTimeout(giveUp); clearInterval(flush); db.removeChannel(ch); };
  }, [loadRun]);

  // ---- recorded loop ----------------------------------------------------
  const [demo, setDemo] = useState<{ devices: Device[]; byDevice: Record<string, Frame[]>; events: DemoFile["events"]; length: number } | null>(null);
  const loopZero = useRef<number | null>(null);
  const useLoop = dbChecked && !live;

  useEffect(() => {
    if (!useLoop || demo) return;
    fetch("/data/demo_fleet.json").then((r) => r.json()).then((d: DemoFile) => {
      const byDevice: Record<string, Frame[]> = {};
      for (const row of d.frames) (byDevice[row.device_id] ??= [])[row.offset_s] = { ...row.frame, device_id: row.device_id };
      const length = Math.max(...d.frames.map((f) => f.offset_s)) + 1;
      setDemo({ devices: d.devices, byDevice, events: d.events.slice().sort((a, b) => a.offset_s - b.offset_s), length });
    }).catch(() => {});
  }, [useLoop, demo]);

  useEffect(() => { if (!useLoop) loopZero.current = null; }, [useLoop]);

  const loop = useMemo(() => {
    if (!useLoop || !demo) return null;
    if (loopZero.current == null) loopZero.current = now - LOOP_START * 1000;
    const total = Math.floor((now - loopZero.current) / 1000);
    const off = total % demo.length;
    const base = loopZero.current + (total - off) * 1000; // wall time of offset 0 in this lap
    const iso = (s: number) => new Date(base + s * 1000).toISOString();
    const fr: Record<string, Frame[]> = {};
    for (const d of demo.devices) {
      const arr = demo.byDevice[d.id] ?? [];
      fr[d.id] = arr.slice(Math.max(0, off - KEEP + 1), off + 1).map((f) => ({ ...f, t: iso(f.s) }));
    }
    const latest = new Map<string, Incident>();
    for (const e of demo.events) {
      if (e.offset_s > off) break;
      const inc = e.incident;
      latest.set(`${e.device_id}:${inc.start}`, {
        ...inc, device_id: e.device_id, opened_at: iso(inc.start),
        closed_at: inc.status === "RESOLVED" ? iso(e.offset_s) : null,
      } as Incident);
    }
    const inc = [...latest.values()].sort((a, b) => b.start - a.start);
    return { frames: fr, incidents: inc, elapsed: off, duration: demo.length - 1, devices: demo.devices };
  }, [useLoop, demo, now]);

  if (live && run) {
    const elapsed = Math.max(0, (now - new Date(run.started_at).getTime()) / 1000);
    return { source: "live", run, devices, frames, incidents, elapsed, duration: run.duration_s, realtime };
  }
  if (loop) {
    return { source: "loop", run, devices: loop.devices, frames: loop.frames, incidents: loop.incidents, elapsed: loop.elapsed, duration: loop.duration, realtime };
  }
  return { source: "connecting", run, devices: [], frames: {}, incidents: [], elapsed: 0, duration: null, realtime };
}
