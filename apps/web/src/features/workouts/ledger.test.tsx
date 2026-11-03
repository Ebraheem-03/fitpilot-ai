// @vitest-environment jsdom
// The on-device progress ledger is per member and is removed on complete, delete and sign-out.
import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkoutSessionBrief } from "@/lib/api-types";
import { emptyProgress, progressKey, recordSet } from "./progress";

const deleteSession = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  deleteSession: (...a: unknown[]) => deleteSession(...a),
  startSession: vi.fn(),
}));
const flushBeforeSignOut = vi.fn<(userId: string) => Promise<{ pending: number }>>();
const discardOutbox = vi.fn(async (...args: unknown[]) => void args);
vi.mock("./outbox/browser", () => ({
  flushBeforeSignOut: (u: string) => flushBeforeSignOut(u),
  discardOutbox: (...a: unknown[]) => discardOutbox(...a),
}));
const signOut = vi.fn(async () => {});
vi.mock("../auth/actions", () => ({ signOut: () => signOut() }));

// Newer Node versions define a throwing `localStorage` global that hides jsdom's: use our own.
class MemoryStorage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key = (i: number) => [...this.data.keys()][i] ?? null;
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
  clear = () => this.data.clear();
}
const storage = new MemoryStorage();
vi.stubGlobal("localStorage", storage);

const { useStoredProgress, clearStoredProgress, clearAllStoredProgress } =
  await import("./useStoredProgress");
const { HistoryList } = await import("./HistoryList");
const { SignOutButton } = await import("../auth/SignOutButton");

const S1 = "0b0f7a3e-4b1c-4a55-9d63-8f0c8d1c2a11";
const S2 = "11111111-1111-4111-8111-111111111111";
const manual = { set_index: 0, source: "manual" as const, reps: 10, duration_s: null };
const saved = (userId: string, sessionId: string) =>
  storage.getItem(progressKey(userId, sessionId)) !== null;

beforeEach(() => {
  storage.clear();
  deleteSession.mockReset();
  flushBeforeSignOut.mockReset();
  flushBeforeSignOut.mockResolvedValue({ pending: 0 });
  discardOutbox.mockClear();
  signOut.mockClear();
});
afterEach(cleanup);

describe("progress ledger is per member", () => {
  it("keys include the member, so one member's progress is never read for another", () => {
    expect(progressKey("alice", S1)).not.toBe(progressKey("bob", S1));
    const alice = renderHook(() => useStoredProgress("alice", S1));
    act(() => alice.result.current[1]((p) => recordSet(p, "plank", manual)));
    expect(saved("alice", S1)).toBe(true);
    expect(alice.result.current[0]?.exercises.plank?.sets).toHaveLength(1);

    const bob = renderHook(() => useStoredProgress("bob", S1)); // same session id, other member
    expect(bob.result.current[0]).toEqual(emptyProgress());
    expect(saved("bob", S1)).toBe(false);
  });

  it("an old unscoped entry is not picked up", () => {
    storage.setItem(
      `fitpilot.workout.v1.${S1}`,
      JSON.stringify({ exercises: { plank: { sets: [manual], skipped: false } } }),
    );
    const { result } = renderHook(() => useStoredProgress("alice", S1));
    expect(result.current[0]).toEqual(emptyProgress());
  });
});

describe("progress ledger is removed", () => {
  function seed() {
    for (const [u, s] of [
      ["alice", S1],
      ["alice", S2],
      ["bob", S1],
    ] as const) {
      storage.setItem(
        progressKey(u, s),
        JSON.stringify(recordSet(emptyProgress(), "plank", manual)),
      );
    }
  }

  it("for one workout, leaving the member's others and other members' alone", () => {
    seed();
    clearStoredProgress("alice", S1);
    expect(saved("alice", S1)).toBe(false);
    expect(saved("alice", S2)).toBe(true);
    expect(saved("bob", S1)).toBe(true);
  });

  it("for a member's every workout on sign-out, leaving other members' alone", () => {
    seed();
    clearAllStoredProgress("alice");
    expect(saved("alice", S1)).toBe(false);
    expect(saved("alice", S2)).toBe(false);
    expect(saved("bob", S1)).toBe(true);
  });

  it("a hook showing the progress updates when it is cleared", async () => {
    seed();
    const { result } = renderHook(() => useStoredProgress("alice", S1));
    expect(result.current[0]?.exercises.plank).toBeDefined();
    act(() => clearStoredProgress("alice", S1));
    await waitFor(() => expect(result.current[0]).toEqual(emptyProgress()));
  });

  it("when the member deletes a workout from the history", async () => {
    seed();
    deleteSession.mockResolvedValue({ ok: true, data: null });
    const sessions: WorkoutSessionBrief[] = [
      {
        id: S1,
        status: "started",
        training_plan_id: null,
        plan_day_index: null,
        started_at: "2026-10-29T10:00:00.000Z",
        completed_at: null,
        perceived_difficulty: null,
      },
    ];
    render(<HistoryList userId="alice" sessions={sessions} />);
    const item = screen.getByTestId("workout-item");
    await userEvent.click(within(item).getByRole("button", { name: /^Delete/ }));
    await userEvent.click(within(item).getByRole("button", { name: "Delete workout" }));
    await waitFor(() => expect(saved("alice", S1)).toBe(false));
    expect(saved("alice", S2)).toBe(true); // a different workout is untouched
    expect(saved("bob", S1)).toBe(true);
  });

  it("when the member signs out: queued data is sent first, then progress goes", async () => {
    seed();
    const order: string[] = [];
    flushBeforeSignOut.mockImplementation(async () => {
      order.push("flush");
      return { pending: 0 };
    });
    signOut.mockImplementation(async () => void order.push(`signout:${saved("alice", S1)}`));
    render(<SignOutButton userId="alice" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(order).toEqual(["flush", "signout:false"]);
    expect(saved("alice", S2)).toBe(false);
    expect(saved("bob", S1)).toBe(true);
  });

  describe("unsent workout data at sign-out", () => {
    const signOutButton = () => screen.getByRole("button", { name: "Sign out" });

    it("asks nothing when everything was sent", async () => {
      render(<SignOutButton userId="alice" />);
      await userEvent.click(signOutButton());
      await waitFor(() => expect(signOut).toHaveBeenCalled());
      expect(screen.queryByTestId("unsent-choice")).toBeNull();
      expect(discardOutbox).not.toHaveBeenCalled();
    });

    it("offers keep or discard in the page, and signs out only after the choice", async () => {
      seed();
      flushBeforeSignOut.mockResolvedValue({ pending: 3 });
      render(<SignOutButton userId="alice" />);
      await userEvent.click(signOutButton());
      const choice = await screen.findByRole("alertdialog");
      expect(choice.textContent).toContain("3 workout items haven't been sent yet");
      expect(signOut).not.toHaveBeenCalled();
      expect(saved("alice", S1)).toBe(true);

      await userEvent.click(within(choice).getByRole("button", { name: "Keep on this device" }));
      await waitFor(() => expect(signOut).toHaveBeenCalled());
      expect(discardOutbox).not.toHaveBeenCalled();
      expect(saved("alice", S1)).toBe(false); // the screen ledger still goes
    });

    it("discard deletes the member's on-device outbox before signing out", async () => {
      const order: string[] = [];
      flushBeforeSignOut.mockResolvedValue({ pending: 1 });
      discardOutbox.mockImplementation(async () => void order.push("discard"));
      signOut.mockImplementation(async () => void order.push("signout"));
      render(<SignOutButton userId="alice" />);
      await userEvent.click(signOutButton());
      await userEvent.click(await screen.findByRole("button", { name: "Discard" }));
      await waitFor(() => expect(signOut).toHaveBeenCalled());
      expect(discardOutbox).toHaveBeenCalledWith("alice");
      expect(order).toEqual(["discard", "signout"]);
    });

    it("is disabled (and does nothing) while the header is still loading", async () => {
      render(<SignOutButton disabled />);
      expect((signOutButton() as HTMLButtonElement).disabled).toBe(true);
      await userEvent.click(signOutButton());
      expect(signOut).not.toHaveBeenCalled();
    });
  });
});
