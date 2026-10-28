"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone?: "info" | "critical" | "good";
  action?: { label: string; run: () => void };
  ttl?: number;
}

const Ctx = createContext<{ push: (t: Omit<Toast, "id"> & { id?: string }) => void; dismiss: (id: string) => void }>({ push: () => {}, dismiss: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const dismiss = useCallback((id: string) => {
    setList((l) => l.filter((t) => t.id !== id));
    const t = timers.current.get(id); if (t) { clearTimeout(t); timers.current.delete(id); }
  }, []);
  const push = useCallback((t: Omit<Toast, "id"> & { id?: string }) => {
    const id = t.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setList((l) => [{ ...t, id }, ...l.filter((x) => x.id !== id)].slice(0, 4));
    const old = timers.current.get(id); if (old) clearTimeout(old);
    timers.current.set(id, setTimeout(() => dismiss(id), t.ttl ?? 9000));
  }, [dismiss]);
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite" aria-relevant="additions">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? "info"}`} role="status">
            <div className="toast-body">
              <b>{t.title}</b>
              {t.body && <span>{t.body}</span>}
            </div>
            {t.action && <button className="btn sm" onClick={() => { dismiss(t.id); t.action!.run(); }}>{t.action.label}</button>}
            <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToasts = () => useContext(Ctx);
