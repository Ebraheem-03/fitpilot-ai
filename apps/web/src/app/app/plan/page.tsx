import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { GenerateButton } from "@/features/plans/GenerateButton";
import { NeedsReviewNotice } from "@/features/plans/NeedsReviewNotice";
import { PlanVersions } from "@/features/plans/PlanVersions";
import { PlanView } from "@/features/plans/PlanView";
import { getCurrentPlan, listPlans } from "@/lib/api-plans";
import { listExercises } from "@/lib/api";
import { buildExerciseIndex } from "../_lib/exercise-index";

export const metadata: Metadata = { title: "Your training plan · FitPilot AI" };

async function PlanContent() {
  await connection();
  const [current, versions, catalogue] = await Promise.all([
    getCurrentPlan(),
    listPlans(),
    listExercises(),
  ]);
  // A newer draft that failed the checks does not replace the current plan; say so.
  const review = versions[0]?.status === "needs_review" ? versions[0] : null;

  return (
    <>
      {review && <NeedsReviewNotice issues={review.validation_issues} />}
      {current?.plan ? (
        <section aria-labelledby="current-heading" className="flex flex-col gap-4">
          <h2 id="current-heading" className="text-lg font-semibold">
            Current plan{" "}
            <span className="font-normal text-muted" data-testid="plan-version-label">
              · version {current.version}
            </span>
          </h2>
          <PlanView plan={current.plan} exercises={buildExerciseIndex(catalogue)} />
        </section>
      ) : (
        !review && (
          <p data-testid="no-plan" className="rounded-xl border border-dashed border-border p-5">
            You don&apos;t have a plan yet. Generate one from your profile: it uses only the
            exercises in our approved library and the equipment you have.
          </p>
        )
      )}
      <GenerateButton hasPlan={current !== null} />
      <PlanVersions plans={versions} />
    </>
  );
}

export default function PlanPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your training plan</h1>
        <p className="mt-1 text-muted">
          A weekly plan built from your profile. Every exercise comes from the approved library.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <PlanContent />
      </Suspense>
    </div>
  );
}
