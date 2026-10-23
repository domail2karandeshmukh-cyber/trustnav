"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Frame, Status } from "@/lib/types";
import { STATUS_HEX } from "@/lib/format";

export interface MapRoute { id: string; points: [number, number][] }
export interface MapTrack { id: string; frames: Frame[] }
export interface MapMarker {
  id: string; label: string; lat: number; lon: number; status: Status;
  kind: "vehicle" | "drone"; alarm?: boolean; selected?: boolean;
}

interface Props {
  routes: MapRoute[];
  tracks: MapTrack[];
  markers: MapMarker[];
  truth?: [number, number][];
  fitKey: string;
  onMarkerClick?: (id: string) => void;
  note?: string;
}

// Dark basemap from CARTO (OpenStreetMap data). If it cannot load, the map
// falls back to plain OpenStreetMap raster tiles so the demo still has streets.
const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const FALLBACK_STYLE: any = {
  version: 8,
  sources: {
    osm: {
      type: "raster", tileSize: 256, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0a1120" } },
    { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.9, "raster-brightness-max": 0.45, "raster-contrast": 0.1 } },
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
      if (seg.length > 1 && st) feats.push({ type: "Feature", properties: { color: STATUS_HEX[st], jump: false }, geometry: { type: "LineString", coordinates: seg } });
    };
    for (const f of t.frames) {
      if (f.lat == null || f.lon == null) { flush(); seg = []; prev = null; continue; }
      const p: [number, number] = [f.lon, f.lat];
      if (prev && meters([prev[1], prev[0]], [p[1], p[0]]) > JUMP_M) {
        flush();
        feats.push({ type: "Feature", properties: { color: STATUS_HEX[f.st], jump: true }, geometry: { type: "LineString", coordinates: [prev, p] } });
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

export default function MapView({ routes, tracks, markers, truth, fitKey, onMarkerClick, note }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const libRef = useRef<any>(null);
  const markerRefs = useRef<Map<string, { m: any; el: HTMLDivElement }>>(new Map());
  const [ready, setReady] = useState(false);
  const [basemapNote, setBasemapNote] = useState<string | null>(null);
  const clickRef = useRef(onMarkerClick);
  clickRef.current = onMarkerClick;

  // create the map once
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
        attributionControl: { compact: true }, cooperativeGestures: false, maxPitch: 0,
      });
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      const setup = () => {
        if (!map.getSource("routes")) {
          map.addSource("routes", { type: "geojson", data: lineFC([]) });
          map.addSource("truth", { type: "geojson", data: lineFC([]) });
          map.addSource("tracks", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": "#6f86b3", "line-width": 2, "line-opacity": 0.75, "line-dasharray": [2, 2] } });
          map.addLayer({ id: "truth", type: "line", source: "truth", paint: { "line-color": "#e8edf7", "line-width": 1.5, "line-opacity": 0.7, "line-dasharray": [1, 2] } });
          map.addLayer({ id: "tracks-glow", type: "line", source: "tracks", filter: ["==", ["get", "jump"], false],
            paint: { "line-color": ["get", "color"], "line-width": 7, "line-opacity": 0.18, "line-blur": 3 }, layout: { "line-cap": "round", "line-join": "round" } });
          map.addLayer({ id: "tracks", type: "line", source: "tracks", filter: ["==", ["get", "jump"], false],
            paint: { "line-color": ["get", "color"], "line-width": 3 }, layout: { "line-cap": "round", "line-join": "round" } });
          map.addLayer({ id: "jumps", type: "line", source: "tracks", filter: ["==", ["get", "jump"], true],
            paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [1, 1.5] } });
        }
        setReady(true);
      };
      map.on("load", setup);
      map.on("error", (e: any) => {
        // style or tiles unreachable before the first load: switch to plain OSM tiles once
        if (!fellBack && !map.isStyleLoaded() && String(e?.error?.message ?? "").length) {
          fellBack = true;
          setBasemapNote("Fallback basemap");
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
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // data layers
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getSource("routes")) return;
    map.getSource("routes").setData(lineFC(routes.map((r) => r.points)));
    map.getSource("truth").setData(lineFC(truth ? [truth] : []));
    map.getSource("tracks").setData(trackFeatures(tracks));
  }, [ready, routes, tracks, truth]);

  // markers
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
        el.addEventListener("click", (ev) => { ev.stopPropagation(); clickRef.current?.(mk.id); });
        const m = new lib.Marker({ element: el, anchor: "left", offset: [-7, 0] }).setLngLat([mk.lon, mk.lat]).addTo(map);
        entry = { m, el };
        markerRefs.current.set(mk.id, entry);
      }
      entry.m.setLngLat([mk.lon, mk.lat]);
      entry.el.className = `marker ${mk.kind === "drone" ? "drone" : ""} ${mk.selected ? "sel" : ""} ${mk.alarm ? "alarm" : ""}`;
      entry.el.style.color = STATUS_HEX[mk.status];
      entry.el.setAttribute("aria-label", `${mk.label}, ${mk.status.toLowerCase()}`);
      entry.el.innerHTML = `<i></i><b>${mk.label}</b>`;
    }
    markerRefs.current.forEach((entry, id) => {
      if (!seen.has(id)) { entry.m.remove(); markerRefs.current.delete(id); }
    });
  }, [ready, markers]);

  // fit to the scene when it changes identity (new scenario, new run)
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    const pts: [number, number][] = [];
    routes.forEach((r) => r.points.forEach(([a, b]) => pts.push([b, a])));
    markers.forEach((m) => pts.push([m.lon, m.lat]));
    if (!pts.length) return;
    const b = new lib.LngLatBounds(pts[0], pts[0]);
    pts.forEach((p) => b.extend(p));
    map.fitBounds(b, { padding: 48, duration: 600, maxZoom: 15.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey]);

  return (
    <div className="mapbox">
      <div ref={box} className="map" role="region" aria-label="Map of tracked devices" />
      {(note || basemapNote) && <div className="map-note">{[note, basemapNote].filter(Boolean).join(" · ")}</div>}
    </div>
  );
}
