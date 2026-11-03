"use client";
import { useEffect } from "react";
import { getOutbox, installFlushTriggers } from "./browser";

/**
 * Mounted once in the member shell: sends what is left from an earlier visit, and on reconnect.
 * Only this member's own outbox (a different member on the same device has a different one).
 */
export function OutboxBoot({ userId }: { userId: string }) {
  useEffect(() => installFlushTriggers(getOutbox(userId)), [userId]);
  return null;
}
