import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
});

export const IconLive = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4M5 5a10 10 0 0 0 0 14M19 19a10 10 0 0 0 0-14" /></svg>
);
export const IconReplay = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /><path d="M12 8v4l3 2" /></svg>
);
export const IconResults = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 20h16" /><path d="M7 16v-5M12 16V6M17 16v-8" /></svg>
);
export const IconMethod = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 4h10l4 4v12H5z" /><path d="M15 4v4h4M8.5 12h7M8.5 15.5h7" /></svg>
);
export const IconBack = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M14.5 6 8.5 12l6 6" /></svg>
);
export const IconClose = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconPlay = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" /></svg>
);
export const IconPause = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none" /></svg>
);
export const IconKey = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2.5 2.5M14 9l2 2" /></svg>
);
export const IconChevron = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="m9.5 6 6 6-6 6" /></svg>
);
export const IconBell = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></svg>
);

/** Platform glyphs, also used as map markers. Vehicles point along their heading. */
export function VehicleGlyph({ size = 18, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5 19.5 20 12 16.2 4.5 20z" fill={color} stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
export function DroneGlyph({ size = 18, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#fff" strokeWidth="1.6">
        <path d="M6 6l12 12M18 6 6 18" stroke={color} strokeWidth="2.6" />
        {[[6, 6], [18, 6], [6, 18], [18, 18]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="3.2" fill={color} />)}
        <circle cx="12" cy="12" r="3.4" fill={color} />
      </g>
    </svg>
  );
}

export function vehicleSvg(color: string, heading: number) {
  return `<svg width="26" height="26" viewBox="0 0 24 24" style="transform:rotate(${heading}deg)"><path d="M12 2.5 19.5 20 12 16.2 4.5 20z" fill="${color}" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}
export function droneSvg(color: string) {
  return `<svg width="26" height="26" viewBox="0 0 24 24"><g stroke="#fff" stroke-width="1.6"><path d="M6 6l12 12M18 6 6 18" stroke="${color}" stroke-width="2.6"/><circle cx="6" cy="6" r="3.2" fill="${color}"/><circle cx="18" cy="6" r="3.2" fill="${color}"/><circle cx="6" cy="18" r="3.2" fill="${color}"/><circle cx="18" cy="18" r="3.2" fill="${color}"/><circle cx="12" cy="12" r="3.4" fill="${color}"/></g></svg>`;
}

export function Wordmark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="var(--chart)" strokeWidth="1.6" />
      <path d="M16 3.5v4M16 24.5v4M3.5 16h4M24.5 16h4" stroke="var(--chart)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 8.5 21.5 22 16 19 10.5 22z" fill="var(--ink)" />
    </svg>
  );
}
