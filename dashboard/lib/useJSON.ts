"use client";

import { useEffect, useState } from "react";

/** A static JSON file from /data, or null while it loads or if it is missing. */
export function useJSON<T>(url: string): T | null {
  const [d, setD] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    fetch(url).then((r) => (r.ok ? r.json() : null)).then((v) => { if (live) setD(v); }).catch(() => { if (live) setD(null); });
    return () => { live = false; };
  }, [url]);
  return d;
}
