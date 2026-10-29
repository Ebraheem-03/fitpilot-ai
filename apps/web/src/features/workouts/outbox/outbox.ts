import type { SessionEvent } from "@fitpilot/exercise-contracts";
import { type EventError, TRACKED_EVENT_TYPES } from "../results";
import type { OutboxRecord, OutboxStore } from "./store";

/** What one send attempt came back with (the action's answer, or "transient" on a thrown error). */
export type SendResult =
  | { ok: true }
  | { ok: false; kind: "transient" }
  | { ok: false; kind: "session_completed" }
  | { ok: false; kind: "session_not_found" }
  | { ok: false; kind: "tracking_consent_required" }
  | { ok: false; kind: "event_limit_reached" }
  | { ok: false; kind: "invalid_events"; errors: EventError[] };

export interface OutboxOptions {
  store: OutboxStore;
  send: (sessionId: string, events: SessionEvent[]) => Promise<SendResult>;
  /** Run `fn` after `ms`; returns a canceller. Injected so tests never wait. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Client-side log. Codes, counts and types only, never event values. */
  log?: (message: string, detail: Record<string, unknown>) => void;
  /** Server limit is 64 KiB per body; stay well under (ADR-0011 §3). */
  maxBatchBytes?: number;
  maxBatchEvents?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

export type FlushOutcome = "empty" | "sent" | "held" | "retry_scheduled";

const encoder = new TextEncoder();
export const byteLength = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
const ENVELOPE_BYTES = byteLength({ events: [] });

/** Splits records (already ordered) into batches under both caps. A lone big record goes alone. */
export function chunkByBytes(
  records: OutboxRecord[],
  maxBytes: number,
  maxEvents: number,
): OutboxRecord[][] {
  const chunks: OutboxRecord[][] = [];
  let cur: OutboxRecord[] = [];
  let size = ENVELOPE_BYTES;
  for (const r of records) {
    const n = byteLength(r.event) + 1; // + comma
    if (cur.length && (cur.length >= maxEvents || size + n > maxBytes)) {
      chunks.push(cur);
      cur = [];
      size = ENVELOPE_BYTES;
    }
    cur.push(r);
    size += n;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * On-device outbox (ADR-0011 §2): derived session events wait here and are sent only when no
 * camera session is running. Events are keyed by idempotency_key, grouped per session, deleted
 * once the server confirms them, and re-sent after a reload or reconnect.
 */
export class Outbox {
  private readonly o: Required<Omit<OutboxOptions, "store" | "send">> &
    Pick<OutboxOptions, "store" | "send">;
  private held = false;
  private seq = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private failures = 0;
  private cancelRetry: (() => void) | null = null;

  constructor(options: OutboxOptions) {
    this.o = {
      schedule: (fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
      log: (m, d) => console.warn(m, d),
      maxBatchBytes: 48 * 1024,
      maxBatchEvents: 100,
      backoffBaseMs: 1_000,
      backoffMaxMs: 60_000,
      ...options,
    };
    this.seq = Date.now() * 1000;
  }

  async enqueue(events: SessionEvent[]): Promise<void> {
    if (!events.length) return;
    await this.o.store.put(
      events.map((event) => ({
        key: event.idempotency_key,
        sessionId: event.session_id,
        seq: this.seq++,
        occurredAt: event.occurred_at,
        event,
        state: "pending" as const,
      })),
    );
  }

  /**
   * True while a camera session runs: nothing is sent. Releasing the hold (camera stopped) flushes,
   * which is the "set ended" trigger.
   */
  holdWhile(cameraRunning: boolean): void {
    const wasHeld = this.held;
    this.held = cameraRunning;
    if (wasHeld && !cameraRunning) void this.flush();
  }

  get isHeld(): boolean {
    return this.held;
  }

  pendingCount(sessionId?: string): Promise<number> {
    return this.o.store.pending(sessionId).then((r) => r.length);
  }

  quarantined(): Promise<OutboxRecord[]> {
    return this.o.store.quarantined();
  }

  /** Sends what is queued (one session, or all). Flushes are serialised; re-reading makes repeats harmless. */
  flush(sessionId?: string): Promise<FlushOutcome> {
    const run = this.chain.then(() => this.doFlush(sessionId));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async doFlush(sessionId?: string): Promise<FlushOutcome> {
    if (this.held) return "held";
    const all = await this.o.store.pending(sessionId);
    if (!all.length) return "empty";
    const sessions = [...new Set(all.map((r) => r.sessionId))];
    for (const id of sessions) {
      for (;;) {
        if (this.held) return "held";
        const [chunk] = chunkByBytes(
          await this.o.store.pending(id),
          this.o.maxBatchBytes,
          this.o.maxBatchEvents,
        );
        if (!chunk) break;
        const outcome = await this.sendChunk(id, chunk);
        if (outcome === "transient") {
          this.scheduleRetry();
          return "retry_scheduled";
        }
      }
    }
    this.failures = 0;
    this.cancelRetry?.();
    this.cancelRetry = null;
    return "sent";
  }

  private async sendChunk(sessionId: string, chunk: OutboxRecord[]): Promise<"done" | "transient"> {
    const store = this.o.store;
    const keys = chunk.map((r) => r.key);
    let result: SendResult;
    try {
      result = await this.o.send(
        sessionId,
        chunk.map((r) => r.event),
      );
    } catch {
      return "transient";
    }
    if (result.ok) {
      await store.remove(keys);
      return "done";
    }
    switch (result.kind) {
      case "transient":
        return "transient";
      case "session_completed": {
        // The session is closed: nothing more can be added to it. Drop what's left.
        const left = (await store.pending(sessionId)).map((r) => r.key);
        this.o.log("outbox: session already completed, dropping events", { count: left.length });
        await store.remove(left);
        return "done";
      }
      case "tracking_consent_required": {
        // Consent was withdrawn (or never recorded): tracked events can't be saved. Manual
        // set_logged / exercise_skipped carry no camera data, so they stay queued.
        const left = await store.pending(sessionId);
        const tracked = left.filter((r) => TRACKED_EVENT_TYPES.has(r.event.type));
        this.o.log("outbox: no tracking consent, dropping tracked events", {
          dropped: tracked.length,
        });
        if (!tracked.length) {
          await store.quarantine(keys, "tracking_consent_required"); // can't happen; never loop
        } else {
          await store.remove(tracked.map((r) => r.key));
        }
        return "done";
      }
      case "invalid_events": {
        const bad = new Set(result.errors.map((e) => e.index));
        const failing = chunk.filter((_, i) => bad.has(i));
        const quarantine = failing.length ? failing : chunk; // no usable indexes: park the batch
        this.o.log("outbox: quarantined events the server rejected", {
          count: quarantine.length,
          types: [...new Set(quarantine.map((r) => r.event.type))],
          codes: [...new Set(result.errors.map((e) => e.code))],
        });
        await store.quarantine(
          quarantine.map((r) => r.key),
          "invalid_events",
        );
        return "done";
      }
      case "session_not_found":
      case "event_limit_reached": {
        const left = (await store.pending(sessionId)).map((r) => r.key);
        this.o.log(`outbox: ${result.kind}, quarantined events`, { count: left.length });
        await store.quarantine(left, result.kind);
        return "done";
      }
    }
  }

  private scheduleRetry(): void {
    if (this.cancelRetry) return;
    const delay = Math.min(this.o.backoffMaxMs, this.o.backoffBaseMs * 2 ** this.failures);
    this.failures++;
    this.cancelRetry = this.o.schedule(() => {
      this.cancelRetry = null;
      void this.flush();
    }, delay);
  }
}
