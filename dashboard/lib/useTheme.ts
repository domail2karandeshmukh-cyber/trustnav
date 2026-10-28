"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type ThemePref = Theme | "system";
const KEY = "trustnav-theme";

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light by default (chart look); dark for operations rooms. The choice is remembered per browser. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>("system");
  const [system, setSystem] = useState<Theme>("light");

  useEffect(() => {
    try { const v = localStorage.getItem(KEY); if (v === "light" || v === "dark" || v === "system") setPref(v); } catch { /* storage blocked */ }
    setSystem(systemTheme());
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystem(m.matches ? "dark" : "light");
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  const theme: Theme = pref === "system" ? system : pref;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0f1621" : "#ffffff");
  }, [theme]);

  const set = useCallback((p: ThemePref) => {
    setPref(p);
    try { localStorage.setItem(KEY, p); } catch { /* storage blocked */ }
  }, []);
  const toggle = useCallback(() => set(theme === "dark" ? "light" : "dark"), [theme, set]);

  return { theme, pref, set, toggle };
}
