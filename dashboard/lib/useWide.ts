"use client";

import { useEffect, useState } from "react";

/** True on screens wide enough for the side panel + map layout. */
export function useWide(query = "(min-width: 900px)") {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return wide;
}
