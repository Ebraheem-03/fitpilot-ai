import type { SessionEvent } from "@fitpilot/exercise-contracts";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ sendEvents: vi.fn() }));
const { discardOutbox, resumeOutbox, flushBeforeSignOut, getOutbox, resetOutboxForTests } =
  await import("./browser");

const SESSION = "11111111-1111-4111-8111-111111111111";
const event = (key: string): SessionEvent => ({
  type: "set_logged",
  session_id: SESSION,
  exercise_id: "bodyweight_squat",
  occurred_at: "2026-01-01T00:00:00.000Z",
  idempotency_key: key,
  set_index: 0,
  reps: 10,
});

afterEach(() => {
  resetOutboxForTests();
  vi.useRealTimers();
});

describe("one outbox per member on a shared device", () => {
  it("never sends A's queued events while B is signed in, and sends them when A returns", async () => {
    const idb = new IDBFactory(); // the same browser profile for both members
    const sent: { user: string; keys: string[] }[] = [];
    const as = (user: string) => ({
      indexedDB: idb,
      send: async (_sessionId: string, events: unknown[]) => {
        sent.push({ user, keys: (events as SessionEvent[]).map((e) => e.idempotency_key) });
        return { ok: true } as const;
      },
    });

    // A finishes a set with no network left to send it, then signs out.
    await getOutbox("user-a", as("user-a")).enqueue([event("a-set-0000001")]);

    // B signs in on the same browser: app load flushes, and B sees nothing of A's.
    const b = getOutbox("user-b", as("user-b"));
    expect(await b.flush()).toBe("empty");
    expect(await b.pendingCount()).toBe(0);
    expect(await b.quarantined()).toEqual([]);
    expect(sent).toEqual([]);

    // A returns: their events are still there and go out under A.
    const a = getOutbox("user-a", as("user-a"));
    expect(await a.flush()).toBe("sent");
    expect(sent).toEqual([{ user: "user-a", keys: ["a-set-0000001"] }]);
  });

  it("rebuilds the outbox when the member changes and keeps it while they stay", () => {
    const deps = { indexedDB: new IDBFactory() };
    const a1 = getOutbox("user-a", deps);
    expect(getOutbox("user-a", deps)).toBe(a1);
    expect(getOutbox("user-b", deps)).not.toBe(a1);
  });

  it("refuses to run without a member id", () => {
    expect(() => getOutbox("")).toThrow();
  });
});

describe("flushBeforeSignOut", () => {
  it("sends the member's queued events before returning", async () => {
    const send = vi.fn(async () => ({ ok: true }) as const);
    await getOutbox("user-a", { indexedDB: new IDBFactory(), send }).enqueue([
      event("a-set-0000002"),
    ]);
    await flushBeforeSignOut("user-a");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("gives up after the wait when the network hangs, so signing out is never blocked", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); // leave the IndexedDB shim real
    const send = vi.fn(() => new Promise<never>(() => {}));
    await getOutbox("user-a", { indexedDB: new IDBFactory(), send }).enqueue([
      event("a-set-0000003"),
    ]);
    const done = flushBeforeSignOut("user-a", 3000);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(done).resolves.toEqual({ pending: 1 });
  });
});

describe("sign-out on a shared device", () => {
  const dbNames = async (idb: IDBFactory) => (await idb.databases()).map((d) => d.name);

  it("reports nothing pending once everything is sent", async () => {
    const send = vi.fn(async () => ({ ok: true }) as const);
    getOutbox("user-a", { indexedDB: new IDBFactory(), send });
    await expect(flushBeforeSignOut("user-a")).resolves.toEqual({ pending: 0 });
  });

  it("keep: what could not be sent stays under the member, quarantined records are gone", async () => {
    const idb = new IDBFactory();
    let reject = true;
    const send = vi.fn(async (_id: string, events: unknown[]) => {
      if (!reject) return { ok: true } as const;
      const keys = (events as SessionEvent[]).map((e) => e.idempotency_key);
      return keys.some((k) => k.startsWith("bad"))
        ? ({ ok: false, kind: "session_not_found" } as const)
        : ({ ok: false, kind: "transient" } as const);
    });
    const a = getOutbox("user-a", { indexedDB: idb, send });
    await a.enqueue([event("bad-set-0000001")]);
    await a.flush();
    expect((await a.quarantined()).length).toBe(1);
    await a.enqueue([event("good-set-000001")]);

    const res = await flushBeforeSignOut("user-a", 50);
    expect(res).toEqual({ pending: 1 });
    expect(await a.quarantined()).toEqual([]);
    expect(await dbNames(idb)).toContain("fitpilot-outbox-user-a");

    // next sign-in: the kept record is still there and goes out under the same member
    reject = false;
    resetOutboxForTests();
    expect(await getOutbox("user-a", { indexedDB: idb, send }).flush()).toBe("sent");
  });

  it("discard: no fitpilot-outbox database is left, and a later sign-in starts empty", async () => {
    const idb = new IDBFactory();
    const send = vi.fn(async () => ({ ok: false, kind: "transient" }) as const);
    const a = getOutbox("user-a", { indexedDB: idb, send });
    await a.enqueue([event("a-set-0000009")]);
    expect(await dbNames(idb)).toContain("fitpilot-outbox-user-a");

    await discardOutbox("user-a", { indexedDB: idb });

    expect((await dbNames(idb)).filter((n) => n?.startsWith("fitpilot-outbox-"))).toEqual([]);
    expect(await getOutbox("user-a", { indexedDB: idb, send }).pendingCount()).toBe(0);
  });

  it("discard: code still mounted on the page cannot re-create the deleted database", async () => {
    const idb = new IDBFactory();
    const send = vi.fn(async () => ({ ok: false, kind: "transient" }) as const);
    await getOutbox("user-a", { indexedDB: idb, send }).enqueue([event("a-set-0000010")]);
    await discardOutbox("user-a", { indexedDB: idb });

    await getOutbox("user-a", { indexedDB: idb, send }).pendingCount(); // e.g. the runner's poll
    expect((await dbNames(idb)).filter((n) => n?.startsWith("fitpilot-outbox-"))).toEqual([]);

    // signing in again brings the real, persistent outbox back
    resumeOutbox("user-a");
    await getOutbox("user-a", { indexedDB: idb, send }).enqueue([event("a-set-0000011")]);
    expect(await dbNames(idb)).toContain("fitpilot-outbox-user-a");
  });

  it("events enqueued after a discard but before the app shell resumes are kept, then persisted and sent", async () => {
    const idb = new IDBFactory();
    const sent: string[] = [];
    const deps = {
      indexedDB: idb,
      send: async (_id: string, events: unknown[]) => {
        sent.push(...(events as SessionEvent[]).map((e) => e.idempotency_key));
        return { ok: true } as const;
      },
    };
    await getOutbox("user-a", deps).enqueue([event("a-set-0000020")]);
    await discardOutbox("user-a", { indexedDB: idb });

    // same member signs back in and a page (the coach) enqueues before OutboxBoot's resume runs
    await getOutbox("user-a", deps).enqueue([event("a-set-0000021")]);
    await resumeOutbox("user-a", deps);

    const real = getOutbox("user-a", deps);
    expect(await real.pendingCount()).toBe(1);
    expect(await dbNames(idb)).toContain("fitpilot-outbox-user-a"); // persisted, not memory-only
    expect(await real.flush()).toBe("sent");
    expect(sent).toEqual(["a-set-0000021"]);
  });

  it("an upload still in flight at discard cannot re-create the deleted database", async () => {
    const idb = new IDBFactory();
    let finish: (r: { ok: true }) => void = () => {};
    const send = vi.fn(() => new Promise<{ ok: true }>((r) => (finish = r)));
    const a = getOutbox("user-a", { indexedDB: idb, send });
    await a.enqueue([event("a-set-0000030")]);
    const flushing = a.flush();
    await flushBeforeSignOut("user-a", 20); // gives up while the request is on the wire
    await discardOutbox("user-a", { indexedDB: idb });

    finish({ ok: true }); // the server answers: the outbox would now remove the record
    await expect(flushing).resolves.toBe("disposed");
    expect((await dbNames(idb)).filter((n) => n?.startsWith("fitpilot-outbox-"))).toEqual([]);
  });

  it("an unreadable store still gets the keep/discard choice", async () => {
    const idb = new IDBFactory();
    const a = getOutbox("user-a", { indexedDB: idb, send: vi.fn() });
    vi.spyOn(a, "pendingCount").mockRejectedValue(new Error("store unreadable"));
    const res = await flushBeforeSignOut("user-a", 20);
    expect(res.pending).toBeGreaterThan(0);
    expect(res.unreadable).toBe(true);
  });
});
