"use client";

/**
 * Voice through the browser's own speech synthesis: no server, no audio
 * files, works offline. Which voices exist depends on the device (macOS,
 * Windows, Chrome's online voices), so every call reports whether a voice
 * was found and the caller falls back to timed captions.
 */

const PREFER = ["google", "natural", "neural", "premium", "enhanced", "siri", "online", "microsoft"];

export function speechAvailable() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

let loaded: SpeechSynthesisVoice[] = [];
function voices(): SpeechSynthesisVoice[] {
  if (!speechAvailable()) return [];
  const v = window.speechSynthesis.getVoices();
  if (v.length) loaded = v;
  return loaded;
}
if (speechAvailable()) {
  try { window.speechSynthesis.onvoiceschanged = () => { loaded = window.speechSynthesis.getVoices(); }; } catch { /* ignore */ }
}

const norm = (s: string) => s.toLowerCase().replace("_", "-");

/** Best voice for a BCP 47 code, or for a fallback code, or null. */
export function pickVoice(code: string, fallback?: string): SpeechSynthesisVoice | null {
  const all = voices();
  const find = (c: string) => {
    const base = norm(c).split("-")[0];
    const cands = all.filter((v) => norm(v.lang).split("-")[0] === base);
    if (!cands.length) return null;
    const exact = cands.filter((v) => norm(v.lang) === norm(c));
    const pool = exact.length ? exact : cands;
    const score = (v: SpeechSynthesisVoice) => {
      const n = v.name.toLowerCase();
      let s = PREFER.findIndex((p) => n.includes(p));
      s = s < 0 ? PREFER.length : s;
      if (!v.localService) s -= 0.5; // online voices tend to sound more natural
      return s;
    };
    return pool.slice().sort((a, b) => score(a) - score(b))[0];
  };
  return find(code) ?? (fallback ? find(fallback) : null);
}

export function hasVoice(code: string, fallback?: string) {
  return !!pickVoice(code, fallback);
}

export function stopSpeech() {
  if (speechAvailable()) try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
}

/**
 * Speak one caption. Resolves true when the speech ended, false at once when
 * there is no voice for the language (the caller then times the caption).
 * Rejects never; a cancelled utterance resolves false.
 */
export function speak(text: string, code: string, fallback?: string, rate = 0.98): Promise<boolean> {
  return new Promise((resolve) => {
    const voice = pickVoice(code, fallback);
    if (!voice) { resolve(false); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang || code;
      u.rate = rate;
      u.pitch = 1;
      let done = false;
      const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
      u.onend = () => finish(true);
      u.onerror = (e) => finish(e.error === "interrupted" || e.error === "canceled" ? false : true);
      // Chrome drops long utterances silently if the page is idle; a watchdog keeps the scene moving
      const guard = setTimeout(() => finish(true), Math.min(90000, 4000 + text.length * 90));
      u.onend = () => { clearTimeout(guard); finish(true); };
      window.speechSynthesis.speak(u);
    } catch {
      resolve(false);
    }
  });
}
