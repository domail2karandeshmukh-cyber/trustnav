"use client";

import { useEffect, useRef, useState } from "react";
import { hasVoice, speak, speechAvailable, stopSpeech } from "./speech";

const KEY = "trustnav-voice";

/** Whether captions are read aloud; remembered per browser, on by default. */
export function useVoicePref(): [boolean, (v: boolean) => void] {
  const [on, setOnState] = useState(true);
  useEffect(() => { try { const v = localStorage.getItem(KEY); if (v != null) setOnState(v === "1"); } catch { /* storage blocked */ } }, []);
  const setOn = (v: boolean) => { setOnState(v); try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* storage blocked */ } if (!v) stopSpeech(); };
  return [on, setOn];
}

/**
 * Reads `text` aloud whenever it changes, while `enabled`. Speech stops when the
 * caption goes away or the voice is turned off. Returns whether a voice exists.
 */
export function useNarrate(text: string | null | undefined, lang: string, enabled: boolean): boolean {
  const [ok, setOk] = useState(false);
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !text) { last.current = null; stopSpeech(); return; }
    if (text === last.current) return;
    last.current = text;
    const voiced = speechAvailable() && hasVoice(lang);
    setOk(voiced);
    if (voiced) speak(text, lang);
    return () => { /* the next change or disable cancels */ };
  }, [text, lang, enabled]);
  useEffect(() => () => stopSpeech(), []);
  return ok;
}
