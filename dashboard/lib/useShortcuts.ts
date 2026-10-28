"use client";

import { useEffect } from "react";

export interface Shortcut {
  /** KeyboardEvent.key, compared case-insensitively; "mod+k" means Cmd on Mac, Ctrl elsewhere */
  keys: string;
  run: (e: KeyboardEvent) => void;
  /** also fire while typing in an input */
  global?: boolean;
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

export function useShortcuts(list: Shortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      for (const s of list) {
        const parts = s.keys.toLowerCase().split("+");
        const wantMod = parts.includes("mod");
        const wantShift = parts.includes("shift");
        const key = parts[parts.length - 1];
        if (wantMod !== mod || wantShift !== e.shiftKey) continue;
        if (e.key.toLowerCase() !== key && !(key === "space" && e.key === " ")) continue;
        if (!s.global && typing(e.target)) continue;
        e.preventDefault();
        s.run(e);
        return;
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [list, enabled]);
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
