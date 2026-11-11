"use client";

import { useRef, type ReactNode } from "react";

export interface TabDef { id: string; label: string }

/** A row of tabs: one board, several exhibits. Arrow keys, Home and End move between them. */
export function Tabs({ tabs, value, onChange, label }: { tabs: readonly TabDef[]; value: string; onChange: (id: string) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    onChange(tabs[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" id={`tab-${t.id}`} className="tab" aria-selected={value === t.id}
          aria-controls={`panel-${t.id}`} tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const k = e.key;
            if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "Home" && k !== "End") return;
            e.preventDefault(); e.stopPropagation();
            go(k === "ArrowRight" ? i + 1 : k === "ArrowLeft" ? i - 1 : k === "Home" ? 0 : tabs.length - 1);
          }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** The exhibit under the tabs. Only the open one is rendered. */
export function TabPanel({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className={`tabpanel${className ? ` ${className}` : ""}`}>{children}</div>;
}

/** Before and after, as one reading: what it was, what it is now. */
export function Shift({ from, to, tone = "trusted" }: { from: string; to: string; tone?: string }) {
  return (
    <span className="shift" role="img" aria-label={`from ${from} to ${to}`}>
      <s>{from}</s>
      <svg viewBox="0 0 28 12" width="28" height="12" aria-hidden="true"><path d="M1 6h24M20 1.5 25.5 6 20 10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <b style={{ color: `var(--${tone})` }}>{to}</b>
    </span>
  );
}
