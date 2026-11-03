import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateOutcome } from "@/lib/api-plans";

vi.mock("server-only", () => ({}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Error && e.message.startsWith("REDIRECT")) throw e;
  },
}));
const generatePlan = vi.fn<(key: string) => Promise<GenerateOutcome>>();
vi.mock("@/lib/api-plans", () => ({ generatePlan }));

const { generatePlanAction } = await import("./actions");
const IDLE = { status: "idle" } as const;
const form = (key?: string) => {
  const f = new FormData();
  if (key !== undefined) f.set("idempotency_key", key);
  return f;
};
const resource = (status: "active" | "needs_review") => ({ id: "p1", version: 4, status }) as never;

beforeEach(() => {
  generatePlan.mockReset();
  revalidatePath.mockClear();
});

describe("generatePlanAction", () => {
  it("rejects a missing or malformed idempotency key without calling the API", async () => {
    for (const bad of [undefined, "short", "has spaces in it!!"]) {
      expect(await generatePlanAction(IDLE, form(bad))).toMatchObject({
        status: "error",
        code: "unknown",
      });
    }
    expect(generatePlan).not.toHaveBeenCalled();
  });

  it("passes the key through, refreshes the plan page and reports an active plan", async () => {
    generatePlan.mockResolvedValue({ ok: true, plan: resource("active"), replayed: false });
    const state = await generatePlanAction(IDLE, form("key-12345678"));
    expect(generatePlan).toHaveBeenCalledWith("key-12345678");
    expect(revalidatePath).toHaveBeenCalledWith("/app/plan");
    expect(state).toEqual({
      status: "done",
      planStatus: "active",
      planId: "p1",
      version: 4,
      replayed: false,
    });
  });

  it("reports needs_review as such and flags replays", async () => {
    generatePlan.mockResolvedValue({ ok: true, plan: resource("needs_review"), replayed: true });
    expect(await generatePlanAction(IDLE, form("key-12345678"))).toMatchObject({
      planStatus: "needs_review",
      replayed: true,
    });
  });

  it("returns known failures as data, with the wait, and does not refresh the page", async () => {
    generatePlan.mockResolvedValue({ ok: false, code: "coach_busy", retryAfterS: 30 });
    expect(await generatePlanAction(IDLE, form("key-12345678"))).toEqual({
      status: "error",
      code: "coach_busy",
      retryAfterS: 30,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("turns an unexpected API failure into a generic error, but lets a redirect through", async () => {
    generatePlan.mockRejectedValueOnce(new Error("boom"));
    expect(await generatePlanAction(IDLE, form("key-12345678"))).toMatchObject({
      code: "unknown",
    });
    generatePlan.mockRejectedValueOnce(new Error("REDIRECT:/session-expired"));
    await expect(generatePlanAction(IDLE, form("key-12345678"))).rejects.toThrow("REDIRECT");
  });
});
