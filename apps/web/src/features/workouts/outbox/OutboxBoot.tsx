"use client";
import { useEffect } from "react";
import { getOutbox, installFlushTriggers, resumeOutbox } from "./browser";

/**
 * Mounted once in the member shell: sends what is left from an earlier visit, and on reconnect.
 * Only this member's own outbox (a different member on the same device has a different one).
 */
export function OutboxBoot({ userId }: { userId: string }) {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    // signed in again after a discard at sign-out: adopt anything a page queued meanwhile first
    void resumeOutbox(userId)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) cleanup = installFlushTriggers(getOutbox(userId));
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [userId]);
  return null;
}
