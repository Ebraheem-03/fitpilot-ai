"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { generatePlan as apiGeneratePlan } from "@/lib/api-plans";
import type { GenerateState } from "./generate-state";

const KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Generate (or regenerate) the member's plan. The browser makes one idempotency key per intent
 * (`GenerateButton`) and sends it as `idempotency_key`; a retry of the same click replays the
 * stored plan instead of generating a second one. The server never invents a plan on failure.
 */
export async function generatePlanAction(
  _prev: GenerateState,
  form: FormData,
): Promise<GenerateState> {
  const key = String(form.get("idempotency_key") ?? "");
  if (!KEY.test(key)) return { status: "error", code: "unknown", retryAfterS: null };

  try {
    const outcome = await apiGeneratePlan(key);
    if (!outcome.ok) {
      return { status: "error", code: outcome.code, retryAfterS: outcome.retryAfterS };
    }
    revalidatePath("/app/plan");
    const { plan } = outcome;
    return {
      status: "done",
      planStatus: plan.status === "needs_review" ? "needs_review" : "active",
      planId: plan.id,
      version: plan.version,
      replayed: outcome.replayed,
    };
  } catch (e) {
    unstable_rethrow(e); // redirect("/session-expired") from apiFetch
    return { status: "error", code: "unknown", retryAfterS: null };
  }
}
