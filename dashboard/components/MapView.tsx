"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Frame, Status } from "@/lib/types";
import { STATUS_HEX } from "@/lib/format";
import { droneSvg, vehicleSvg } from "./Icons";

export interface MapRoute { id: string; points: [number, number][] }
export interface MapTrack { id: string; frames: Frame[]; faded?: boolean }
export interface MapMarker {
  id: string; label: string; lat: number; lon: number; status: Status; heading: number | null;
  kind: "vehicle" | "drone"; alarm?: boolean; selected?: boolean;
}
export interface Ghost { lat: number; lon: number; from: [number, number] }

interface Props {
  routes: MapRoute[];
  tracks: MapTrack[];
  markers: MapMarker[];
  /** simulator ground truth: the path the platform really took */
  truth?: [number, number][];
  /** where the platform really is, linked to where the receiver says it is */
  ghost?: Ghost | null;
  fitKey: string;
  /** extra [lat, lon] points the initial view must include */
  extent?: [number, number][];
  focus?: { lat: number; lon: number; key: string } | null;
  /** keep the selected marker centred as it moves */
  follow?: string | null;
  padding?: { top: number; right: number; bottom: number; left: number };
  onMarkerClick?: (id: string) => void;
  note?: string;
  theme?: "light" | "dark";
  /** glide markers between updates (ms); 0 snaps */
  glideMs?: number;
  /** receives a function that returns the current map as a PNG data URL */
  onSnapshot?: (fn: () => string | null) => void;
}

// CARTO basemaps (OpenStreetMap data). If one cannot load, the map falls
// back to plain OpenStreetMap raster tiles so the demo still has streets.
const STYLES = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};
const fallbackStyle = (theme: "light" | "dark"): any => ({
  version: 8,
  sources: {
    osm: { type: "raster", tileSize: 256, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], attribution: "© OpenStreetMap contributors" },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": theme === "dark" ? "#0f1621" : "#eef0ec" } },
    { id: "osm", type: "raster", source: "osm", paint: theme === "dark"
      ? { "raster-saturation": -1, "raster-brightness-max": 0.35, "raster-contrast": 0.2 }
      : { "raster-saturation": -0.85, "raster-contrast": -0.15, "raster-brightness-min": 0.12 } },
  ],
});

const JUMP_M = 400;
const PALETTE = {
  light: { casing: "#ffffff", route: "#1f5fbf", truth: "#14233b", link: "#c2185b" },
  dark: { casing: "#0f1621", route: "#7fb0ff", truth: "#e8eef8", link: "#ff5c9a" },
};

function meters(a: [number, number], b: [number, number]) {
  const k = Math.PI / 180;
  const x = (b[1] - a[1]) * k * Math.cos(((a[0] + b[0]) / 2) * k);
  const y = (b[0] - a[0]) * k;
  return Math.hypot(x, y) * 6371000;
}

/** Split a track into same-status segments; abrupt jumps become dashed links. Older points fade. */
function trackFeatures(tracks: MapTrack[]) {
  const feats: any[] = [];
  for (const t of tracks) {
    const n = t.frames.length;
    let seg: [number, number][] = [];
    let segStart = 0;
    let st: Status | null = null;
    let prev: [number, number] | null = null;
    const flush = (end: number) => {
      if (seg.length > 1 && st) {
        const age = 1 - (segStart + end) / 2 / Math.max(1, n); // 0 newest .. 1 oldest
        feats.push({ type: "Feature", properties: { color: STATUS_HEX[st], jump: false, faded: !!t.faded, age }, geometry: { type: "LineString", coordinates: seg } });
      }
    };
    t.frames.forEach((f, i) => {
      if (f.lat == null || f.lon == null) { flush(i); seg = []; prev = null; return; }
      const p: [number, number] = [f.lon, f.lat];
      if (prev && meters([prev[1], prev[0]], [p[1], p[0]]) > JUMP_M) {
        flush(i);
        feats.push({ type: "Feature", properties: { color: STATUS_HEX[f.st], jump: true, faded: !!t.faded, age: 0 }, geometry: { type: "LineString", coordinates: [prev, p] } });
        seg = [p]; segStart = i;
      } else if (st && f.st !== st) {
        seg.push(p);
        flush(i);
        seg = [p]; segStart = i;
      } else {
        if (!seg.length) segStart = i;
        seg.push(p);
      }
      st = f.st;
      prev = p;
    });
    flush(n);
  }
  return { type: "FeatureCollection", features: feats };
}

const lineFC = (lines: [number, number][][]) => ({
  type: "FeatureCollection",
  features: lines.filter((l) => l.length > 1).map((l) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: l.map(([a, b]) => [b, a]) } })),
});

const ease = (t: number) => 1 - (1 - t) * (1 - t);
const lerpAngle = (a: number, b: number, t: number) => {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
};

interface Anim { from: [number, number]; to: [number, number]; hFrom: number; hTo: number; t0: number; dur: number }

export default function MapView({ routes, tracks, markers, truth, ghost, fitKey, extent, focus, follow, padding, onMarkerClick, note, theme = "light", glideMs = 950, onSnapshot }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const libRef = useRef<any>(null);
  const markerRefs = useRef<Map<string, { m: any; el: HTMLDivElement; icon: HTMLElement | null; sig: string; anim: Anim | null; heading: number }>>(new Map());
  const ghostRef = useRef<any>(null);
  const [ready, setReady] = useState(0);
  const [fallback, setFallback] = useState(false);
  const clickRef = useRef(onMarkerClick);
  clickRef.current = onMarkerClick;
  const themeRef = useRef(theme);
  const pad = padding ?? { top: 40, right: 40, bottom: 40, left: 40 };
  const raf = useRef<number | null>(null);
  const followRef = useRef(follow); followRef.current = follow;
  const glideRef = useRef(glideMs); glideRef.current = glideMs;

  const setupLayers = (map: any) => {
    const pal = PALETTE[themeRef.current];
    if (!map.getSource("routes")) {
      map.addSource("routes", { type: "geojson", data: lineFC([]) });
      map.addSource("truth", { type: "geojson", data: lineFC([]) });
      map.addSource("link", { type: "geojson", data: lineFC([]) });
      map.addSource("tracks", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": pal.route, "line-width": 2, "line-opacity": 0.5, "line-dasharray": [2.5, 2] } });
      map.addLayer({ id: "truth", type: "line", source: "truth", paint: { "line-color": pal.truth, "line-width": 2, "line-opacity": 0.6, "line-dasharray": [0.6, 1.6] }, layout: { "line-cap": "round" } });
      map.addLayer({ id: "tracks-case", type: "line", source: "tracks", filter: ["==", ["get", "jump"], false],
        paint: { "line-color": pal.casing, "line-width": 6.5, "line-opacity": ["*", ["case", ["get", "faded"], 0.5, 0.95], ["-", 1, ["*", 0.55, ["get", "age"]]]] }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addLayer({ id: "tracks", type: "line", source: "tracks", filter: ["==", ["get", "jump"], false],
        paint: { "line-color": ["get", "color"], "line-width": 3.2, "line-opacity": ["*", ["case", ["get", "faded"], 0.4, 1], ["-", 1, ["*", 0.6, ["get", "age"]]]] }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addLayer({ id: "jumps", type: "line", source: "tracks", filter: ["==", ["get", "jump"], true],
        paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [1, 1.5] } });
      map.addLayer({ id: "link", type: "line", source: "link", paint: { "line-color": pal.link, "line-width": 1.6, "line-dasharray": [1.5, 1.2] } });
    }
    setReady((v) => v + 1);
  };

  useEffect(() => {
    let cancelled = false;
    let map: any;
    (async () => {
      const lib = (await import("maplibre-gl")).default;
      if (cancelled || !box.current) return;
      libRef.current = lib;
      let fellBack = false;
      map = new lib.Map({
        container: box.current, style: STYLES[themeRef.current], center: [-0.555, 47.47], zoom: 12.6,
        attributionControl: { compact: true }, maxPitch: 0, dragRotate: false, pitchWithRotate: false, fadeDuration: 150,
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });
      onSnapshot?.(() => { try { return map.getCanvas().toDataURL("image/png"); } catch { return null; } });
      map.touchZoomRotate.disableRotation();
      map.addControl(new lib.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("load", () => setupLayers(map));
      map.on("error", (e: any) => {
        if (!fellBack && !map.isStyleLoaded() && String(e?.error?.message ?? "").length) {
          fellBack = true;
          setFallback(true);
          map.setStyle(fallbackStyle(themeRef.current));
          map.once("styledata", () => setupLayers(map));
        }
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      if (raf.current) cancelAnimationFrame(raf.current);
      markerRefs.current.forEach(({ m }) => m.remove());
      markerRefs.current.clear();
      ghostRef.current?.remove();
      ghostRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme swap: new style, then layers again
  useEffect(() => {
    const map = mapRef.current;
    if (themeRef.current === theme) return;
    themeRef.current = theme;
    if (!map) return;
    map.setStyle(fallback ? fallbackStyle(theme) : STYLES[theme]);
    map.once("style.load", () => setupLayers(map));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getSource("routes")) return;
    map.getSource("routes").setData(lineFC(routes.map((r) => r.points)));
    map.getSource("truth").setData(lineFC(truth ? [truth] : []));
    map.getSource("tracks").setData(trackFeatures(tracks));
    map.getSource("link").setData(lineFC(ghost ? [[ghost.from, [ghost.lat, ghost.lon]]] : []));
  }, [ready, routes, tracks, truth, ghost]);

  // animation loop: glide every marker toward its latest fix
  const tick = () => {
    raf.current = null;
    const now = performance.now();
    let busy = false;
    const map = mapRef.current;
    markerRefs.current.forEach((e, id) => {
      if (!e.anim) return;
      const { from, to, hFrom, hTo, t0, dur } = e.anim;
      const t = dur <= 0 ? 1 : Math.min(1, (now - t0) / dur);
      const k = ease(t);
      const lon = from[0] + (to[0] - from[0]) * k;
      const lat = from[1] + (to[1] - from[1]) * k;
      e.m.setLngLat([lon, lat]);
      e.heading = lerpAngle(hFrom, hTo, k);
      if (e.icon) e.icon.style.transform = `rotate(${e.heading}deg)`;
      if (followRef.current === id && map && !map.isMoving()) map.jumpTo({ center: [lon, lat] });
      if (t < 1) busy = true; else e.anim = null;
    });
    if (busy) raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    const seen = new Set<string>();
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    for (const mk of markers) {
      seen.add(mk.id);
      let entry = markerRefs.current.get(mk.id);
      const target: [number, number] = [mk.lon, mk.lat];
      const hTo = mk.heading ?? 0;
      if (!entry) {
        const el = document.createElement("div");
        el.setAttribute("role", "button");
        el.tabIndex = 0;
        el.addEventListener("click", (ev) => { ev.stopPropagation(); clickRef.current?.(mk.id); });
        el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); clickRef.current?.(mk.id); } });
        const m = new lib.Marker({ element: el, anchor: "center" }).setLngLat(target).addTo(map);
        entry = { m, el, icon: null, sig: "", anim: null, heading: hTo };
        markerRefs.current.set(mk.id, entry);
      } else {
        const cur = entry.m.getLngLat();
        const from: [number, number] = [cur.lng, cur.lat];
        const dist = meters([from[1], from[0]], [target[1], target[0]]);
        if (dist > 2) {
          const snap = reduce || dist > JUMP_M || glideRef.current <= 0;
          entry.anim = { from, to: target, hFrom: entry.heading, hTo, t0: performance.now(), dur: snap ? 0 : glideRef.current };
        } else if (Math.abs(((hTo - entry.heading + 540) % 360) - 180) > 1) {
          entry.anim = { from, to: target, hFrom: entry.heading, hTo, t0: performance.now(), dur: reduce ? 0 : 300 };
        }
      }
      const color = STATUS_HEX[mk.status];
      const sig = `${mk.status}|${mk.selected}|${mk.alarm}|${mk.kind}`;
      if (sig !== entry.sig) {
        entry.sig = sig;
        entry.el.className = `mk${mk.selected ? " sel" : ""}${mk.alarm ? " alarm" : ""}`;
        entry.el.style.setProperty("--c", color);
        entry.el.style.zIndex = mk.selected ? "3" : mk.alarm ? "2" : "1";
        entry.el.setAttribute("aria-label", `${mk.label}, ${mk.status.toLowerCase()}`);
        entry.el.innerHTML = `<span class="mk-ring"></span><span class="mk-icon">${mk.kind === "drone" ? droneSvg(color) : vehicleSvg(color, 0)}</span><span class="mk-tag">${mk.label}</span>`;
        entry.icon = mk.kind === "drone" ? null : (entry.el.querySelector(".mk-icon") as HTMLElement);
        if (entry.icon) entry.icon.style.transform = `rotate(${entry.heading}deg)`;
      }
    }
    markerRefs.current.forEach((entry, id) => {
      if (!seen.has(id)) { entry.m.remove(); markerRefs.current.delete(id); }
    });
    if (!raf.current) raf.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markers]);

  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    if (!ghost) { ghostRef.current?.remove(); ghostRef.current = null; return; }
    if (!ghostRef.current) {
      const el = document.createElement("div");
      el.className = "ghost";
      el.innerHTML = `<span></span><b>Real position</b>`;
      ghostRef.current = new lib.Marker({ element: el, anchor: "center" }).setLngLat([ghost.lon, ghost.lat]).addTo(map);
    }
    ghostRef.current.setLngLat([ghost.lon, ghost.lat]);
  }, [ready, ghost]);

  // fitting a hidden (zero-size) map produces NaN coordinates, so wait until it is visible
  const visible = () => {
    const el = box.current;
    return !!el && el.clientWidth > pad.left + pad.right + 20 && el.clientHeight > pad.top + pad.bottom + 20;
  };
  const pendingFit = useRef(false);
  const userMoved = useRef(false);
  const fitted = useRef(false);
  const lastSize = useRef("");
  const doFit = (animate = true) => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib) return;
    if (!visible()) { pendingFit.current = true; return; }
    pendingFit.current = false;
    const pts: [number, number][] = [];
    routesRef.current.forEach((r) => r.points.forEach(([a, b]) => pts.push([b, a])));
    markersRef.current.forEach((m) => pts.push([m.lon, m.lat]));
    tracksRef.current.forEach((t) => t.frames.forEach((f) => { if (f.lat != null && f.lon != null) pts.push([f.lon, f.lat]); }));
    extentRef.current?.forEach(([a, b]) => pts.push([b, a]));
    if (!pts.length) return;
    const b = new lib.LngLatBounds(pts[0], pts[0]);
    pts.forEach((p) => b.extend(p));
    map.fitBounds(b, { padding: pad, duration: animate && fitted.current ? 700 : 0, maxZoom: 15.5 });
    fitted.current = true;
  };
  const routesRef = useRef(routes); routesRef.current = routes;
  const markersRef = useRef(markers); markersRef.current = markers;
  const tracksRef = useRef(tracks); tracksRef.current = tracks;
  const extentRef = useRef(extent); extentRef.current = extent;

  useEffect(() => {
    if (!ready) return;
    userMoved.current = false;
    doFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready > 0, fitKey]);

  useEffect(() => {
    if (!ready || !box.current) return;
    const map = mapRef.current;
    const touched = (e: any) => { if (e?.originalEvent) userMoved.current = true; };
    map?.on("movestart", touched);
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      const el = box.current;
      if (!el || !visible()) return;
      const size = `${el.clientWidth}x${el.clientHeight}`;
      if (size === lastSize.current) return;
      lastSize.current = size;
      mapRef.current?.resize();
      clearTimeout(t);
      t = setTimeout(() => { if (pendingFit.current || !userMoved.current) doFit(false); }, 150);
    });
    ro.observe(box.current);
    return () => { ro.disconnect(); clearTimeout(t); map?.off("movestart", touched); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready > 0]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus || !visible()) return;
    map.easeTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.getZoom(), 14.2), padding: pad, duration: 700 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready > 0, focus?.key]);

  return (
    <div className="mapbox" data-theme-map={theme}>
      <div ref={box} className="map" role="region" aria-label="Map of tracked platforms" />
      {(note || fallback) && <div className="map-note">{note ?? "Simplified basemap"}</div>}
    </div>
  );
}
