import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Error && e.message.startsWith("REDIRECT")) throw e;
  },
}));
class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API responded ${status}`);
  }
}
const api = vi.hoisted(() => ({
  postSessionEvents: vi.fn(),
  startWorkoutSession: vi.fn(),
  completeWorkoutSession: vi.fn(),
  getWorkoutSession: vi.fn(),
  listWorkoutSessions: vi.fn(),
  deleteWorkoutSession: vi.fn(),
  grantTrackingConsent: vi.fn(),
  withdrawTrackingConsent: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ ApiError, ...api }));

const actions = await import("./actions");
const SESSION = "11111111-1111-4111-8111-111111111111";
const event = (over: Record<string, unknown> = {}) => ({
  type: "rep_completed",
  session_id: SESSION,
  exercise_id: "bodyweight_squat",
  occurred_at: "2026-01-01T00:00:00Z",
  idempotency_key: "key-12345678",
  set_index: 0,
  rep_index: 0,
  duration_ms: 2000,
  tracking_confidence: 0.9,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("sendEvents", () => {
  it("forwards contract-valid events and reports success", async () => {
    api.postSessionEvents.mockResolvedValue({ accepted: 1, duplicates: 0 });
    const res = await actions.sendEvents(SESSION, [event()]);
    expect(res).toEqual({ ok: true, data: { accepted: 1, duplicates: 0 } });
    expect(api.postSessionEvents).toHaveBeenCalledWith(SESSION, [event()]);
  });

  it("refuses landmark-shaped smuggling before it reaches the API", async () => {
    const res = await actions.sendEvents(SESSION, [event(), event({ landmarks: [{ x: 1 }] })]);
    expect(res).toEqual({
      ok: false,
      failure: "invalid_events",
      errors: [{ index: 1, code: "contract_violation" }],
    });
    expect(api.postSessionEvents).not.toHaveBeenCalled();
  });

  it("refuses events for a different session than the one addressed", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const res = await actions.sendEvents(SESSION, [event({ session_id: other })]);
    expect(res).toMatchObject({ ok: false, errors: [{ index: 0, code: "session_mismatch" }] });
    expect(api.postSessionEvents).not.toHaveBeenCalled();
  });

  it("does not let a session id escape the URL path", async () => {
    expect(await actions.sendEvents("../users/me", [event()])).toMatchObject({
      failure: "invalid_request",
    });
    expect(api.postSessionEvents).not.toHaveBeenCalled();
  });

  it.each([
    [409, "session_completed", "session_completed"],
    [403, "tracking_consent_required", "tracking_consent_required"],
    [404, "session_not_found", "session_not_found"],
    [409, "event_limit_reached", "event_limit_reached"],
  ])("maps API %s %s", async (status, code, failure) => {
    api.postSessionEvents.mockRejectedValue(new ApiError(status, { detail: { code } }));
    expect(await actions.sendEvents(SESSION, [event()])).toEqual({ ok: false, failure });
  });

  it("maps 422 invalid_events with per-index codes and drops the API's messages", async () => {
    api.postSessionEvents.mockRejectedValue(
      new ApiError(422, {
        detail: {
          code: "invalid_events",
          errors: [{ index: 0, code: "unknown_rule", message: "rule x not found" }],
        },
      }),
    );
    expect(await actions.sendEvents(SESSION, [event()])).toEqual({
      ok: false,
      failure: "invalid_events",
      errors: [{ index: 0, code: "unknown_rule" }],
    });
  });

  it("reports an unreachable API as unavailable, so the outbox retries", async () => {
    api.postSessionEvents.mockRejectedValue(new TypeError("fetch failed"));
    expect(await actions.sendEvents(SESSION, [event()])).toEqual({
      ok: false,
      failure: "unavailable",
    });
    api.postSessionEvents.mockRejectedValue(new ApiError(503, null));
    expect(await actions.sendEvents(SESSION, [event()])).toMatchObject({ failure: "unavailable" });
  });

  it("lets the session-expired redirect through instead of swallowing it", async () => {
    api.postSessionEvents.mockRejectedValue(new Error("REDIRECT:/session-expired"));
    await expect(actions.sendEvents(SESSION, [event()])).rejects.toThrow("REDIRECT");
  });
});

describe("other actions", () => {
  it("startSession checks the idempotency key and the plan pair", async () => {
    expect(await actions.startSession("short")).toMatchObject({ failure: "invalid_request" });
    expect(await actions.startSession("start-12345678", { plan_day_index: 1 })).toMatchObject({
      failure: "invalid_request",
    });
    api.startWorkoutSession.mockResolvedValue({ id: SESSION });
    expect(await actions.startSession("start-12345678")).toEqual({
      ok: true,
      data: { id: SESSION },
    });
    expect(api.startWorkoutSession.mock.calls[0]![1]).toBe("start-12345678");
  });

  it("consent actions call the API with the build's consent version", async () => {
    api.grantTrackingConsent.mockResolvedValue({ tracking_data_consent_version: 1 });
    await actions.setTrackingConsent();
    expect(api.grantTrackingConsent).toHaveBeenCalledWith(1);
    api.withdrawTrackingConsent.mockResolvedValue({ tracking_data_consent_at: null });
    expect(await actions.withdrawTrackingConsent()).toMatchObject({ ok: true });
  });

  it("getSession and deleteSession report a missing session", async () => {
    api.getWorkoutSession.mockResolvedValue(null);
    expect(await actions.getSession(SESSION)).toEqual({ ok: false, failure: "session_not_found" });
    api.deleteWorkoutSession.mockResolvedValue(false);
    expect(await actions.deleteSession(SESSION)).toEqual({
      ok: false,
      failure: "session_not_found",
    });
    api.deleteWorkoutSession.mockResolvedValue(true);
    expect(await actions.deleteSession(SESSION)).toEqual({ ok: true, data: null });
  });

  it("listSessions bounds its paging inputs", async () => {
    expect(await actions.listSessions(500, 0)).toMatchObject({ failure: "invalid_request" });
    expect(await actions.listSessions(10, -1)).toMatchObject({ failure: "invalid_request" });
  });

  it("completeSession validates ids", async () => {
    expect(await actions.completeSession("nope", "complete-12345678")).toMatchObject({
      failure: "invalid_request",
    });
  });
});
