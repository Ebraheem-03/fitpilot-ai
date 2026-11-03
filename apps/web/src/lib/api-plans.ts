import "server-only";
import { TrainingPlanResource } from "@fitpilot/exercise-contracts";
import type { GenerateErrorCode } from "@/features/plans/generate-state";
import { ApiError, apiFetch, json } from "@/lib/api";

/** Server-side calls for /training-plans (FR-02). Every response is parsed with the shared zod contract. */

const PlanList = TrainingPlanResource.array();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPlanId = (id: string) => UUID.test(id);

/** The member's active plan, or null when none was generated yet (404 plan_not_found). */
export async function getCurrentPlan(): Promise<TrainingPlanResource | null> {
  const res = await apiFetch("/training-plans/current");
  if (res.status === 404) return null;
  return TrainingPlanResource.parse(await json<unknown>(res));
}

/** Every version, newest first (includes `needs_review` and `superseded`). */
export async function listPlans(limit = 20): Promise<TrainingPlanResource[]> {
  return PlanList.parse(await json<unknown>(await apiFetch(`/training-plans?limit=${limit}`)));
}

/** One of the caller's plans, or null (another member's plan is also a 404). */
export async function getPlan(id: string): Promise<TrainingPlanResource | null> {
  if (!isPlanId(id)) return null;
  const res = await apiFetch(`/training-plans/${id}`);
  if (res.status === 404) return null;
  return TrainingPlanResource.parse(await json<unknown>(res));
}

export type GenerateOutcome =
  | { ok: true; plan: TrainingPlanResource; replayed: boolean }
  | { ok: false; code: GenerateErrorCode; retryAfterS: number | null };

const KNOWN: readonly Exclude<GenerateErrorCode, "unknown">[] = [
  "profile_required",
  "generation_in_progress",
  "coach_busy",
  "ai_unavailable",
];

/**
 * 201 active, 202 needs_review, 200 replay of the same key. Known failures come back as data so
 * the UI can say exactly what happened; a plan is never fabricated on failure.
 */
export async function generatePlan(idempotencyKey: string): Promise<GenerateOutcome> {
  const res = await apiFetch("/training-plans/generate", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (res.ok) {
    return {
      ok: true,
      plan: TrainingPlanResource.parse(await res.json()),
      replayed: res.status === 200,
    };
  }
  const body = (await res.json().catch(() => null)) as { detail?: { code?: string } } | null;
  const code = KNOWN.find((c) => c === body?.detail?.code);
  if (!code) throw new ApiError(res.status, body);
  const retry = Number(res.headers.get("Retry-After"));
  return {
    ok: false,
    code,
    retryAfterS: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null,
  };
}
