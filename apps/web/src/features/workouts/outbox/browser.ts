"use client";
import { sendEvents } from "../actions";
import { Outbox, type SendResult } from "./outbox";
import { IndexedDbStore, MemoryStore } from "./store";

let instance: Outbox | null = null;

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

/** The tab's one outbox. Falls back to memory where IndexedDB is unavailable (private modes). */
export function getOutbox(): Outbox {
  instance ??= new Outbox({
    store: typeof indexedDB === "undefined" ? new MemoryStore() : new IndexedDbStore(indexedDB),
    send: sendViaAction,
  });
  return instance;
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
