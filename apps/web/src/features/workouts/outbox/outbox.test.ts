import type { SessionEvent } from "@fitpilot/exercise-contracts";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { Outbox, type SendResult, byteLength, chunkByBytes } from "./outbox";
import { createEventSink } from "./sink";
import { IndexedDbStore, MemoryStore, type OutboxStore } from "./store";

const SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
let n = 0;
const ts = () => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

const rep = (i: number, session = SESSION): SessionEvent => ({
  type: "rep_completed",
  session_id: session,
  exercise_id: "bodyweight_squat",
  occurred_at: ts(),
  idempotency_key: `rep-${session.slice(0, 4)}-${i}-${n++}`,
  set_index: 0,
  rep_index: i,
  duration_ms: 2000,
  tracking_confidence: 0.9,
});
const manual = (session = SESSION): SessionEvent => ({
  type: "set_logged",
  session_id: session,
  exercise_id: "bodyweight_squat",
  occurred_at: ts(),
  idempotency_key: `manual-${n++}-aaaaaaaa`,
  set_index: 0,
  reps: 10,
});

type Sent = { sessionId: string; events: SessionEvent[] };
function harness(
  respond: (call: Sent, i: number) => SendResult | Promise<SendResult> = () => ({ ok: true }),
  store: OutboxStore = new MemoryStore(),
  extra: ConstructorParameters<typeof Outbox>[0] extends infer O ? Partial<O> : never = {},
) {
  const sent: Sent[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const delays: number[] = [];
  const log = vi.fn();
  const outbox = new Outbox({
    store,
    send: async (sessionId, events) => {
      const call = { sessionId, events };
      sent.push(call);
      return respond(call, sent.length - 1);
    },
    schedule: (fn, ms) => {
      const t = { fn, ms };
      delays.push(ms);
      timers.push(t);
      return () => timers.splice(timers.indexOf(t), 1);
    },
    log,
    ...extra,
  });
  return { outbox, store, sent, timers, delays, log };
}

describe("outbox: offline, reload, flush", () => {
  it("events queued while offline survive a reload and are sent exactly once", async () => {
    const idb = new IDBFactory(); // the browser's database outlives the page
    const events = [rep(0), rep(1), manual()];

    const first = harness(() => ({ ok: false, kind: "transient" }), new IndexedDbStore(idb));
    await first.outbox.enqueue(events);
    expect(await first.outbox.flush()).toBe("retry_scheduled");
    expect(first.sent).toHaveLength(1);

    // "Reload": a new Outbox, a new connection to the same database, back online.
    const second = harness(() => ({ ok: true }), new IndexedDbStore(idb));
    expect(await second.outbox.flush()).toBe("sent");
    expect(second.sent.flatMap((s) => s.events.map((e) => e.idempotency_key))).toEqual(
      events.map((e) => e.idempotency_key),
    );
    expect(await second.outbox.flush()).toBe("empty");
    expect(second.sent).toHaveLength(1); // deleted on 200, so never sent again
  });

  it("enqueueing the same event twice stores it once", async () => {
    const h = harness();
    const e = rep(0);
    await h.outbox.enqueue([e]);
    await h.outbox.enqueue([e]);
    await h.outbox.flush();
    expect(h.sent[0]!.events).toHaveLength(1);
  });

  it("keeps sessions apart: one request per session", async () => {
    const h = harness();
    await h.outbox.enqueue([rep(0), rep(0, OTHER), rep(1)]);
    await h.outbox.flush();
    expect(h.sent.map((s) => [s.sessionId, s.events.length])).toEqual([
      [SESSION, 2],
      [OTHER, 1],
    ]);
  });

  it("flush(sessionId) leaves other sessions queued", async () => {
    const h = harness();
    await h.outbox.enqueue([rep(0), rep(0, OTHER)]);
    await h.outbox.flush(SESSION);
    expect(await h.outbox.pendingCount(OTHER)).toBe(1);
  });

  it("retries with growing delays after a network failure, then recovers and stops retrying", async () => {
    const h = harness((_c, i) => (i < 2 ? { ok: false, kind: "transient" } : { ok: true }));
    await h.outbox.enqueue([rep(0)]);
    await h.outbox.flush();
    expect(h.delays).toEqual([1000]);
    h.timers.shift()!.fn(); // the backoff timer fires: fails again, so waits longer
    await h.outbox.flush(); // queued behind it, and succeeds
    expect(h.delays).toEqual([1000, 2000]);
    expect(await h.outbox.pendingCount()).toBe(0);
    expect(h.timers).toHaveLength(0); // success cancels the pending retry
  });

  it("treats a thrown send (network down) as transient", async () => {
    const h = harness(() => {
      throw new Error("fetch failed");
    });
    await h.outbox.enqueue([rep(0)]);
    expect(await h.outbox.flush()).toBe("retry_scheduled");
    expect(await h.outbox.pendingCount()).toBe(1);
  });
});

describe("outbox: camera hold (ADR-0011 §2)", () => {
  it("sends nothing while the camera runs, then flushes when it stops", async () => {
    const h = harness();
    h.outbox.holdWhile(true);
    await h.outbox.enqueue([rep(0), rep(1)]);
    expect(await h.outbox.flush()).toBe("held");
    expect(h.sent).toHaveLength(0);

    h.outbox.holdWhile(false);
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    expect(await h.outbox.pendingCount()).toBe(0);
  });

  it("stops between batches if the camera starts mid-flush", async () => {
    // eslint-disable-next-line prefer-const -- assigned after the harness that closes over it
    let outbox!: Outbox;
    const h = harness(
      () => {
        outbox.holdWhile(true);
        return { ok: true };
      },
      new MemoryStore(),
      { maxBatchEvents: 1 },
    );
    outbox = h.outbox;
    await outbox.enqueue([rep(0), rep(1), rep(2)]);
    expect(await outbox.flush()).toBe("held");
    expect(h.sent).toHaveLength(1);
    expect(await outbox.pendingCount()).toBe(2);
  });
});

describe("outbox: batching", () => {
  it("splits batches so every request body stays under 64 KiB", async () => {
    const h = harness();
    const many = Array.from({ length: 700 }, (_, i) => ({
      ...rep(i),
      idempotency_key: `${"k".repeat(100)}-${i}`,
    }));
    await h.outbox.enqueue(many);
    await h.outbox.flush();
    expect(h.sent.length).toBeGreaterThan(1);
    for (const s of h.sent) {
      expect(byteLength({ events: s.events })).toBeLessThan(64 * 1024);
      expect(s.events.length).toBeLessThanOrEqual(100);
    }
    expect(h.sent.flatMap((s) => s.events)).toHaveLength(700); // nothing lost, in order
  });

  it("respects the byte cap even when events are few but large", () => {
    const big = (i: number): SessionEvent => ({
      ...(manual() as Extract<SessionEvent, { type: "set_logged" }>),
      note: "x".repeat(450) + i,
    });
    const records = Array.from({ length: 30 }, (_, i) => ({
      key: String(i),
      sessionId: SESSION,
      seq: i,
      occurredAt: ts(),
      state: "pending" as const,
      event: big(i),
    }));
    const chunks = chunkByBytes(records, 4096, 100);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(byteLength({ events: c.map((r) => r.event) })).toBeLessThanOrEqual(4096);
    }
  });
});

describe("outbox: server verdicts", () => {
  it("409 session_completed: drops the session's queued events, keeps other sessions", async () => {
    const h = harness((c) =>
      c.sessionId === SESSION ? { ok: false, kind: "session_completed" } : { ok: true },
    );
    await h.outbox.enqueue([rep(0), rep(1), rep(0, OTHER)]);
    await h.outbox.flush();
    expect(await h.outbox.pendingCount()).toBe(0);
    expect(await h.outbox.quarantined()).toEqual([]);
    expect(h.sent.map((s) => s.sessionId)).toEqual([SESSION, OTHER]);
  });

  it("403 tracking_consent_required: drops tracked events, still sends manual ones", async () => {
    const h = harness((c) =>
      c.events.some((e) => e.type === "rep_completed")
        ? { ok: false, kind: "tracking_consent_required" }
        : { ok: true },
    );
    await h.outbox.enqueue([rep(0), manual(), rep(1)]);
    await h.outbox.flush();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.events.map((e) => e.type)).toEqual(["set_logged"]);
    expect(await h.outbox.pendingCount()).toBe(0);
  });

  it("422 invalid_events: quarantines only the failing events, logs without values, sends the rest", async () => {
    const h = harness((c) =>
      c.events.length === 3
        ? { ok: false, kind: "invalid_events", errors: [{ index: 1, code: "unknown_rule" }] }
        : { ok: true },
    );
    const events = [rep(0), manual(), rep(2)];
    await h.outbox.enqueue(events);
    await h.outbox.flush();

    expect(h.sent[1]!.events.map((e) => e.idempotency_key)).toEqual([
      events[0]!.idempotency_key,
      events[2]!.idempotency_key,
    ]);
    const parked = await h.outbox.quarantined();
    expect(parked.map((r) => [r.key, r.reason])).toEqual([
      [events[1]!.idempotency_key, "invalid_events"],
    ]);
    expect(await h.outbox.pendingCount()).toBe(0);
    expect(h.log).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(h.log.mock.calls);
    expect(logged).toContain("unknown_rule");
    expect(logged).not.toContain(events[1]!.idempotency_key);
    expect(logged).not.toContain("10"); // the reps value
  });

  it("422 without indexes parks the whole batch rather than looping", async () => {
    const h = harness(() => ({ ok: false, kind: "invalid_events", errors: [] }));
    await h.outbox.enqueue([rep(0), rep(1)]);
    expect(await h.outbox.flush()).toBe("sent");
    expect(h.sent).toHaveLength(1);
    expect(await h.outbox.quarantined()).toHaveLength(2);
  });

  it("404 session_not_found quarantines the session's events", async () => {
    const h = harness(() => ({ ok: false, kind: "session_not_found" }));
    await h.outbox.enqueue([rep(0), rep(1)]);
    await h.outbox.flush();
    expect(await h.outbox.quarantined()).toHaveLength(2);
    expect(await h.outbox.pendingCount()).toBe(0);
  });
});

describe("event sink (consent)", () => {
  it("without consent, tracked events never reach the outbox; manual logging does", async () => {
    const h = harness();
    const sink = createEventSink({ outbox: h.outbox, hasConsent: () => false });
    sink([rep(0), manual(), { ...manual(), type: "exercise_skipped" } as unknown as SessionEvent]);
    await h.outbox.flush();
    expect(h.sent.flatMap((s) => s.events.map((e) => e.type))).toEqual([
      "set_logged",
      "exercise_skipped",
    ]);
  });

  it("with consent, every event is queued, and no request happens until flush", async () => {
    const h = harness();
    const sink = createEventSink({ outbox: h.outbox, hasConsent: () => true });
    sink([rep(0), manual()]);
    expect(h.sent).toHaveLength(0);
    await vi.waitFor(async () => expect(await h.outbox.pendingCount()).toBe(2));
  });

  it("reads consent when events arrive, so withdrawing takes effect immediately", async () => {
    let consent = true;
    const h = harness();
    const sink = createEventSink({ outbox: h.outbox, hasConsent: () => consent });
    consent = false;
    sink([rep(0)]);
    await h.outbox.flush();
    expect(h.sent).toHaveLength(0);
  });
});
