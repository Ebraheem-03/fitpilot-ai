import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getAccessToken: async () => "tok" }));

const { generatePlan, getCurrentPlan, getPlan } = await import("./api-plans");

const PLAN_ID = "0b0f7a3e-4b1c-4a55-9d63-8f0c8d1c2a11";
const resource = (status: "active" | "needs_review") => ({
  id: PLAN_ID,
  version: 1,
  status,
  prompt_version: "plan-v1",
  model: "fake",
  created_at: "2026-10-29T10:00:00+00:00",
  validation_issues: status === "needs_review" ? [{ code: "catalogue", message: "x" }] : [],
  plan:
    status === "needs_review"
      ? null
      : {
          rationale: "r",
          days: [
            {
              day_of_week: "monday",
              focus: "f",
              exercises: [
                {
                  exercise_id: "bodyweight_squat",
                  sets: 3,
                  reps: 10,
                  duration_s: null,
                  rest_s: 60,
                  progression: "p",
                },
              ],
            },
          ],
        },
});
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("plan API client", () => {
  beforeEach(() => vi.stubEnv("API_BASE_URL", "http://api.test"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the Idempotency-Key and maps 201/202/200", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(201, resource("active")))
      .mockResolvedValueOnce(reply(202, resource("needs_review")))
      .mockResolvedValueOnce(reply(200, resource("active")));
    vi.stubGlobal("fetch", fetchMock);

    const created = await generatePlan("key-12345678");
    expect(created).toMatchObject({ ok: true, replayed: false });
    expect(await generatePlan("key-12345678")).toMatchObject({
      ok: true,
      plan: { status: "needs_review", plan: null },
    });
    expect(await generatePlan("key-12345678")).toMatchObject({ ok: true, replayed: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/training-plans/generate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-12345678");
  });

  it.each([
    [409, "profile_required", {}, null],
    [409, "generation_in_progress", { "Retry-After": "5" }, 5],
    [503, "coach_busy", { "Retry-After": "37" }, 37],
    [503, "coach_busy", {}, null],
    [503, "ai_unavailable", {}, null],
  ])("%i %s becomes data with the Retry-After", async (status, code, headers, retry) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(status, { detail: { code } }, headers)));
    expect(await generatePlan("key-12345678")).toEqual({ ok: false, code, retryAfterS: retry });
  });

  it("throws for failures it does not know, instead of inventing a message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(500, { detail: "boom" })));
    await expect(generatePlan("key-12345678")).rejects.toMatchObject({ status: 500 });
  });

  it("returns null for no current plan, and never calls the API for a malformed id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(404, { detail: { code: "plan_not_found" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getCurrentPlan()).toBeNull();
    expect(await getPlan("../etc/passwd")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getPlan(PLAN_ID)).toBeNull();
  });

  it("rejects a response that breaks the contract", async () => {
    const broken = { ...resource("active"), plan: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, broken)));
    await expect(getCurrentPlan()).rejects.toThrow();
  });
});
