"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { type Progress, parseProgress, progressKey, serialiseProgress } from "./progress";

const CHANGED = "fitpilot:workout-progress";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange); // another tab of the same workout
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Reads storage defensively: private modes and blocked storage behave as "no progress". */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Fallback for storage that refuses writes: progress then lives for this page view only. */
const memory = new Map<string, string>();

export function clearStoredProgress(sessionId: string) {
  const key = progressKey(sessionId);
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing stored */
  }
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * The member's progress through a workout, kept on this device (see `progress.ts`). `null` on the
 * server and during hydration, so the first client render matches the server's.
 */
export function useStoredProgress(
  sessionId: string,
): [Progress | null, (update: (p: Progress) => Progress) => void] {
  const key = progressKey(sessionId);
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key) ?? memory.get(key) ?? "",
    () => null,
  );
  const progress = useMemo(() => (raw === null ? null : parseProgress(raw || null)), [raw]);

  const update = useCallback(
    (fn: (p: Progress) => Progress) => {
      const current = parseProgress(read(key) ?? memory.get(key) ?? null);
      const next = serialiseProgress(fn(current));
      try {
        window.localStorage.setItem(key, next);
        memory.delete(key);
      } catch {
        memory.set(key, next); // storage refuses writes: keep it for this page view
      }
      window.dispatchEvent(new Event(CHANGED));
    },
    [key],
  );
  return [progress, update];
}
