"use server";

import { SessionEvent, type SessionSummary } from "@fitpilot/exercise-contracts";
import { unstable_rethrow } from "next/navigation";
import {
  ApiError,
  completeWorkoutSession,
  deleteWorkoutSession,
  getWorkoutSession,
  grantTrackingConsent,
  listWorkoutSessions,
  postSessionEvents,
  startWorkoutSession,
  withdrawTrackingConsent as withdrawConsent,
} from "@/lib/api";
import {
  TRACKING_CONSENT_VERSION,
  type CompleteSessionInput,
  type EventIngestResult,
  type Profile,
  type StartSessionInput,
  type WorkoutSession,
  type WorkoutSessionPage,
} from "@/lib/api-types";
import type { ActionResult, EventError, Failure } from "./results";

// Server actions are public endpoints: check shapes before they become URLs or request bodies.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/;
const KNOWN_FAILURES: ReadonlySet<string> = new Set<Failure>([
  "session_completed",
  "session_not_found",
  "tracking_consent_required",
  "event_limit_reached",
  "invalid_events",
]);
const invalid = { ok: false, failure: "invalid_request" } as const;

function failureOf(e: unknown): ActionResult<never> {
  unstable_rethrow(e); // redirect("/session-expired") from apiFetch must pass through
  if (e instanceof ApiError) {
    const detail = (e.body as { detail?: { code?: unknown; errors?: unknown } } | null)?.detail;
    const code = typeof detail?.code === "string" ? detail.code : "";
    if (KNOWN_FAILURES.has(code)) {
      const errors = Array.isArray(detail?.errors)
        ? (detail.errors as { index?: unknown; code?: unknown }[])
            .filter((x) => typeof x.index === "number")
            // codes only: the API's messages may echo field names, never values
            .map((x): EventError => ({ index: x.index as number, code: String(x.code ?? "") }))
        : undefined;
      return { ok: false, failure: code as Failure, ...(errors ? { errors } : {}) };
    }
    if (e.status === 422) return invalid;
    if (e.status === 404) return { ok: false, failure: "session_not_found" };
  }
  return { ok: false, failure: "unavailable" };
}

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return failureOf(e);
  }
}

export async function setTrackingConsent(): Promise<ActionResult<Profile>> {
  return run(() => grantTrackingConsent(TRACKING_CONSENT_VERSION));
}

export async function withdrawTrackingConsent(): Promise<ActionResult<Profile>> {
  return run(() => withdrawConsent());
}

export async function startSession(
  idempotencyKey: string,
  input: StartSessionInput = {},
): Promise<ActionResult<WorkoutSession>> {
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return invalid;
  const { training_plan_id, plan_day_index } = input ?? {};
  if ((training_plan_id === undefined) !== (plan_day_index === undefined)) return invalid;
  if (training_plan_id !== undefined && !UUID.test(training_plan_id)) return invalid;
  if (
    plan_day_index !== undefined &&
    !(Number.isInteger(plan_day_index) && plan_day_index >= 0 && plan_day_index <= 30)
  ) {
    return invalid;
  }
  return run(() => startWorkoutSession({ training_plan_id, plan_day_index }, idempotencyKey));
}

/**
 * Validates every event against the shared contract before it leaves the server action, so a
 * smuggled field never reaches the API; failures are reported per index, like the API's 422.
 */
export async function sendEvents(
  sessionId: string,
  events: unknown[],
): Promise<ActionResult<EventIngestResult>> {
  if (!UUID.test(sessionId) || !Array.isArray(events) || events.length === 0) return invalid;
  const errors: EventError[] = [];
  const valid: SessionEvent[] = [];
  events.forEach((raw, index) => {
    const parsed = SessionEvent.safeParse(raw);
    if (!parsed.success) errors.push({ index, code: "contract_violation" });
    else if (parsed.data.session_id !== sessionId) errors.push({ index, code: "session_mismatch" });
    else valid.push(parsed.data);
  });
  if (errors.length) return { ok: false, failure: "invalid_events", errors };
  return run(() => postSessionEvents(sessionId, valid));
}

export async function completeSession(
  sessionId: string,
  idempotencyKey: string,
  input: CompleteSessionInput = {},
): Promise<ActionResult<SessionSummary>> {
  if (!UUID.test(sessionId) || !IDEMPOTENCY_KEY.test(idempotencyKey)) return invalid;
  return run(() => completeWorkoutSession(sessionId, input ?? {}, idempotencyKey));
}

export async function getSession(sessionId: string): Promise<ActionResult<WorkoutSession>> {
  if (!UUID.test(sessionId)) return invalid;
  const res = await run(() => getWorkoutSession(sessionId));
  if (!res.ok) return res;
  return res.data ? { ok: true, data: res.data } : { ok: false, failure: "session_not_found" };
}

export async function listSessions(
  limit = 20,
  offset = 0,
): Promise<ActionResult<WorkoutSessionPage>> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return invalid;
  if (!Number.isInteger(offset) || offset < 0) return invalid;
  return run(() => listWorkoutSessions(limit, offset));
}

export async function deleteSession(sessionId: string): Promise<ActionResult<null>> {
  if (!UUID.test(sessionId)) return invalid;
  const res = await run(() => deleteWorkoutSession(sessionId));
  if (!res.ok) return res;
  return res.data ? { ok: true, data: null } : { ok: false, failure: "session_not_found" };
}
