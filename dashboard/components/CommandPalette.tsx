"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  title: string;
  hint?: string;
  group: string;
  keywords?: string;
  run: () => void;
}

function score(q: string, c: Command) {
  const hay = `${c.title} ${c.hint ?? ""} ${c.keywords ?? ""}`.toLowerCase();
  if (!q) return 1;
  if (hay.includes(q)) return 3 + (c.title.toLowerCase().startsWith(q) ? 2 : 0);
  // every word of the query appears somewhere
  const words = q.split(/\s+/).filter(Boolean);
  return words.length > 1 && words.every((w) => hay.includes(w)) ? 2 : 0;
}

export default function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return commands.map((c) => ({ c, s: score(s, c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c).slice(0, 14);
  }, [q, commands]);

  useEffect(() => { if (open) { setQ(""); setIdx(0); setTimeout(() => input.current?.focus(), 10); } }, [open]);
  useEffect(() => { setIdx(0); }, [q]);
  if (!open) return null;

  const run = (c: Command) => { onClose(); c.run(); };
  let lastGroup = "";
  return (
    <div className="pal-back" onMouseDown={onClose} role="presentation">
      <div className="pal" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={input} className="pal-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a vehicle, scenario or page"
          aria-label="Search commands" autoComplete="off" spellCheck={false} autoFocus
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(list.length - 1, i + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter" && list[idx]) run(list[idx]);
            if (e.key === "Escape") onClose();
          }} />
        <ul className="pal-list" role="listbox">
          {list.length === 0 && <li className="pal-empty">Nothing matches &ldquo;{q}&rdquo;.</li>}
          {list.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id}>
                {head && <div className="pal-group">{head}</div>}
                <button role="option" aria-selected={i === idx} className={`pal-item${i === idx ? " on" : ""}`} onMouseEnter={() => setIdx(i)} onClick={() => run(c)}>
                  <span>{c.title}</span>
                  {c.hint && <small>{c.hint}</small>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="pal-foot"><kbd>↑↓</kbd> move <kbd>↵</kbd> open <kbd>esc</kbd> close</div>
      </div>
    </div>
  );
}
