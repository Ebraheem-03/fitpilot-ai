import type { SessionEvent } from "@fitpilot/exercise-contracts";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ sendEvents: vi.fn() }));
const { flushBeforeSignOut, getOutbox, resetOutboxForTests } = await import("./browser");

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
    await expect(done).resolves.toBeUndefined();
  });
});
