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
  padding?: { top: number; right: number; bottom: number; left: number };
  onMarkerClick?: (id: string) => void;
  note?: string;
}

// Light basemap from CARTO (OpenStreetMap data). If it cannot load, the map
// falls back to plain OpenStreetMap raster tiles so the demo still has streets.
const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const FALLBACK_STYLE: any = {
  version: 8,
  sources: {
    osm: {
      type: "raster", tileSize: 256, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#eef0ec" } },
    { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.85, "raster-contrast": -0.15, "raster-brightness-min": 0.12 } },
  ],
};

const JUMP_M = 400;

function meters(a: [number, number], b: [number, number]) {
  const k = Math.PI / 180;
  const x = (b[1] - a[1]) * k * Math.cos(((a[0] + b[0]) / 2) * k);
  const y = (b[0] - a[0]) * k;
  return Math.hypot(x, y) * 6371000;
}

/** Split a track into same-status segments; abrupt jumps become dashed links. */
function trackFeatures(tracks: MapTrack[]) {
  const feats: any[] = [];
  for (const t of tracks) {
    let seg: [number, number][] = [];
    let st: Status | null = null;
    let prev: [number, number] | null = null;
    const flush = () => {
      if (seg.length > 1 && st) feats.push({ type: "Feature", properties: { color: STATUS_HEX[st], jump: false, faded: !!t.faded }, geometry: { type: "LineString", coordinates: seg } });
    };
    for (const f of t.frames) {
      if (f.lat == null || f.lon == null) { flush(); seg = []; prev = null; continue; }
      const p: [number, number] = [f.lon, f.lat];
      if (prev && meters([prev[1], prev[0]], [p[1], p[0]]) > JUMP_M) {
        flush();
        feats.push({ type: "Feature", properties: { color: STATUS_HEX[f.st], jump: true, faded: !!t.faded }, geometry: { type: "LineString", coordinates: [prev, p] } });
        seg = [p];
      } else if (st && f.st !== st) {
        seg.push(p);
        flush();
        seg = [p];
      } else {
        seg.push(p);
      }
      st = f.st;
      prev = p;
    }
    flush();
  }
  return { type: "FeatureCollection", features: feats };
}

const lineFC = (lines: [number, number][][]) => ({
  type: "FeatureCollection",
  features: lines.filter((l) => l.length > 1).map((l) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: l.map(([a, b]) => [b, a]) } })),
});

export default function MapView({ routes, tracks, markers, truth, ghost, fitKey, extent, focus, padding, onMarkerClick, note }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const libRef = useRef<any>(null);
  const markerRefs = useRef<Map<string, { m: any; el: HTMLDivElement; sig: string }>>(new Map());
  const ghostRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const clickRef = useRef(onMarkerClick);
  clickRef.current = onMarkerClick;
  const pad = padding ?? { top: 40, right: 40, bottom: 40, left: 40 };

  useEffect(() => {
    let cancelled = false;
    let map: any;
    (async () => {
      const lib = (await import("maplibre-gl")).default;
      if (cancelled || !box.current) return;
      libRef.current = lib;
      let fellBack = false;
      map = new lib.Map({
        container: box.current, style: STYLE_URL, center: [-0.555, 47.47], zoom: 12.6,
        attributionControl: { compact: true }, maxPitch: 0, dragRotate: false, pitchWithRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new lib.NavigationControl({ showCompass: false }), "bottom-right");
      const setup = () => {
        if (!map.getSource("routes")) {
          map.addSource("routes", { type: "geojson", data: lineFC([]) });
          map.addSource("truth", { type: "geojson", data: lineFC([]) });
          map.addSource("link", { type: "geojson", data: lineFC([]) });
          map.addSource("tracks", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": "#1f5fbf", "line-width": 2, "line-opacity": 0.45, "line-dasharray": [2.5, 2] } });
          map.addLayer({ id: "truth", type: "line", source: "truth", paint: { "line-color": "#14233b", "line-width": 2, "line-opacity": 0.55, "line-dasharray": [0.6, 1.6] }, layout: { "line-cap": "round" } });
          map.addLayer({ id: "tracks-case", type: "line", source: "tracks", filter: ["==", ["get", "jump"], false],
            paint: { "line-color": "#ffffff", "line-width": 6.5, "line-opacity": ["case", ["get", "faded"], 0.5, 0.95] }, layout: { "line-cap": "round", "line-join": "round" } });
          map.addLayer({ id: "tracks", type: "line", source: "tracks", filter: ["==", ["get", "jump"], false],
            paint: { "line-color": ["get", "color"], "line-width": 3.2, "line-opacity": ["case", ["get", "faded"], 0.45, 1] }, layout: { "line-cap": "round", "line-join": "round" } });
          map.addLayer({ id: "jumps", type: "line", source: "tracks", filter: ["==", ["get", "jump"], true],
            paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [1, 1.5] } });
          map.addLayer({ id: "link", type: "line", source: "link", paint: { "line-color": "#c2185b", "line-width": 1.6, "line-dasharray": [1.5, 1.2] } });
        }
        setReady(true);
      };
      map.on("load", setup);
      map.on("error", (e: any) => {
        if (!fellBack && !map.isStyleLoaded() && String(e?.error?.message ?? "").length) {
          fellBack = true;
          setFallback(true);
          map.setStyle(FALLBACK_STYLE);
          map.once("styledata", setup);
        }
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      markerRefs.current.forEach(({ m }) => m.remove());
      markerRefs.current.clear();
      ghostRef.current?.remove();
      ghostRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getSource("routes")) return;
    map.getSource("routes").setData(lineFC(routes.map((r) => r.points)));
    map.getSource("truth").setData(lineFC(truth ? [truth] : []));
    map.getSource("tracks").setData(trackFeatures(tracks));
    map.getSource("link").setData(lineFC(ghost ? [[ghost.from, [ghost.lat, ghost.lon]]] : []));
  }, [ready, routes, tracks, truth, ghost]);

  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    const seen = new Set<string>();
    for (const mk of markers) {
      seen.add(mk.id);
      let entry = markerRefs.current.get(mk.id);
      if (!entry) {
        const el = document.createElement("div");
        el.setAttribute("role", "button");
        el.tabIndex = 0;
        el.addEventListener("click", (ev) => { ev.stopPropagation(); clickRef.current?.(mk.id); });
        el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); clickRef.current?.(mk.id); } });
        const m = new lib.Marker({ element: el, anchor: "center" }).setLngLat([mk.lon, mk.lat]).addTo(map);
        entry = { m, el, sig: "" };
        markerRefs.current.set(mk.id, entry);
      }
      entry.m.setLngLat([mk.lon, mk.lat]);
      const color = STATUS_HEX[mk.status];
      const heading = Math.round(mk.heading ?? 0);
      const sig = `${mk.status}|${heading}|${mk.selected}|${mk.alarm}|${mk.kind}`;
      if (sig !== entry.sig) {
        entry.sig = sig;
        entry.el.className = `mk${mk.selected ? " sel" : ""}${mk.alarm ? " alarm" : ""}`;
        entry.el.style.setProperty("--c", color);
        entry.el.style.zIndex = mk.selected ? "3" : mk.alarm ? "2" : "1";
        entry.el.setAttribute("aria-label", `${mk.label}, ${mk.status.toLowerCase()}`);
        entry.el.innerHTML = `<span class="mk-ring"></span>${mk.kind === "drone" ? droneSvg(color) : vehicleSvg(color, heading)}<span class="mk-tag">${mk.label}</span>`;
      }
    }
    markerRefs.current.forEach((entry, id) => {
      if (!seen.has(id)) { entry.m.remove(); markerRefs.current.delete(id); }
    });
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
  }, [ready, fitKey]);

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
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus || !visible()) return;
    map.easeTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.getZoom(), 14.2), padding: pad, duration: 700 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focus?.key]);

  return (
    <div className="mapbox">
      <div ref={box} className="map" role="region" aria-label="Map of tracked platforms" />
      {(note || fallback) && <div className="map-note">{note ?? "Simplified basemap"}</div>}
    </div>
  );
}
