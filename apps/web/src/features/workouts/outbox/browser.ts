"use client";
import { sendEvents } from "../actions";
import { Outbox, type SendResult } from "./outbox";
import { IndexedDbStore, MemoryStore } from "./store";

/** Sends through the server action (the token stays server-side). A thrown error is a network failure. */
export async function sendViaAction(sessionId: string, events: unknown[]): Promise<SendResult> {
  const res = await sendEvents(sessionId, events);
  if (res.ok) return { ok: true };
  switch (res.failure) {
    case "unavailable":
      return { ok: false, kind: "transient" };
    case "invalid_events":
      return { ok: false, kind: "invalid_events", errors: res.errors ?? [] };
    case "invalid_request":
      return { ok: false, kind: "invalid_events", errors: [] };
    default:
      return { ok: false, kind: res.failure };
  }
}

export interface OutboxDeps {
  indexedDB?: IDBFactory;
  send?: (sessionId: string, events: unknown[]) => Promise<SendResult>;
}

let current: { userId: string; outbox: Outbox } | null = null;

/**
 * This member's outbox. Every member gets their own database, so on a shared device one member's
 * queued events are never sent with another member's token (or readable by them); the singleton
 * is rebuilt when the signed-in member changes. Falls back to memory where IndexedDB is missing.
 */
export function getOutbox(userId: string, deps: OutboxDeps = {}): Outbox {
  if (!userId) throw new Error("getOutbox needs the signed-in member's id");
  if (current?.userId === userId) return current.outbox;
  current?.outbox.dispose();
  const idb = deps.indexedDB ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  const outbox = new Outbox({
    store: idb ? new IndexedDbStore(idb, `fitpilot-outbox-${userId}`) : new MemoryStore(),
    send: deps.send ?? sendViaAction,
  });
  current = { userId, outbox };
  return outbox;
}

/** Best-effort send before signing out, so the member's last set isn't left on this device. */
export async function flushBeforeSignOut(userId: string, waitMs = 3000): Promise<void> {
  const outbox = getOutbox(userId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  try {
    await Promise.race([outbox.flush().then(() => undefined), giveUp]);
  } catch {
    // signing out matters more than a failed upload; it stays queued under this member
  } finally {
    clearTimeout(timer);
  }
}

export function resetOutboxForTests(): void {
  current?.outbox.dispose();
  current = null;
}

/** Flush triggers that aren't tied to a UI action: app load and reconnect. Returns a cleanup. */
export function installFlushTriggers(
  outbox: Pick<Outbox, "flush">,
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  const flush = () => void outbox.flush();
  target.addEventListener("online", flush);
  flush();
  return () => target.removeEventListener("online", flush);
}
