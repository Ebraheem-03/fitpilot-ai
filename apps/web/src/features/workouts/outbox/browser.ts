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

let current: { userId: string; outbox: Outbox; volatile: boolean } | null = null;

/**
 * Members whose on-device outbox was just discarded at sign-out. Until their next sign-in, code
 * still mounted on the page (pending-count polling) gets a memory-only outbox instead of
 * re-creating the database that was just deleted.
 */
const discarded = new Set<string>();

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
  const volatile = !idb || discarded.has(userId);
  const outbox = new Outbox({
    store: volatile ? new MemoryStore() : new IndexedDbStore(idb, `fitpilot-outbox-${userId}`),
    send: deps.send ?? sendViaAction,
  });
  current = { userId, outbox, volatile };
  return outbox;
}

/**
 * Sign-out step 1: a best-effort send (waits at most `waitMs`), then drops the quarantined
 * records (rejected by the server, they will never send). Returns how many records are still
 * waiting to be sent, so the caller can ask the member what to do with them.
 */
export async function flushBeforeSignOut(
  userId: string,
  waitMs = 3000,
): Promise<{ pending: number }> {
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
  try {
    await outbox.discardQuarantined();
    return { pending: await outbox.pendingCount() };
  } catch {
    return { pending: 0 }; // an unreadable store can't be offered a choice about
  }
}

/**
 * Sign-out step 2, when the member chooses to discard what was never sent: stops this member's
 * outbox and deletes their on-device database, so nothing of the workout is left on a shared
 * device. Resolves once the database is gone (or the browser has none).
 */
export async function discardOutbox(
  userId: string,
  deps: Pick<OutboxDeps, "indexedDB"> = {},
): Promise<void> {
  discarded.add(userId);
  if (current?.userId === userId) {
    current.outbox.dispose();
    current = null;
  }
  const idb = deps.indexedDB ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!idb) return;
  await new Promise<void>((resolve) => {
    const req = idb.deleteDatabase(`fitpilot-outbox-${userId}`);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

/** A member is signed in again (app shell mounted): their real outbox is used from here on. */
export function resumeOutbox(userId: string): void {
  discarded.delete(userId);
  if (current?.userId === userId && current.volatile) {
    current.outbox.dispose();
    current = null;
  }
}

export function resetOutboxForTests(): void {
  current?.outbox.dispose();
  current = null;
  discarded.clear();
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
