import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { GenerateButton } from "@/features/plans/GenerateButton";
import { NeedsReviewNotice } from "@/features/plans/NeedsReviewNotice";
import { PlanVersions } from "@/features/plans/PlanVersions";
import { capitalise } from "@/features/plans/labels";
import { PlanView } from "@/features/plans/PlanView";
import { StartWorkoutButton } from "@/features/workouts/StartWorkoutButton";
import { TodayWorkoutCard } from "@/features/workouts/TodayWorkoutCard";
import { getCurrentPlan, listPlans } from "@/lib/api-plans";
import { listExercises, listWorkoutSessions } from "@/lib/api";
import { buildExerciseIndex } from "../_lib/exercise-index";

export const metadata: Metadata = { title: "Your training plan · FitPilot AI" };

async function PlanContent() {
  await connection();
  const [current, versions, catalogue, recent] = await Promise.all([
    getCurrentPlan(),
    listPlans(),
    listExercises(),
    listWorkoutSessions(50),
  ]);
  // A started, unfinished workout for a day of this plan is resumed rather than started again
  // (newest first, so the latest one wins).
  const resume: Record<number, string> = {};
  for (const session of recent.items) {
    if (session.status !== "started" || session.training_plan_id !== current?.id) continue;
    if (session.plan_day_index !== null) resume[session.plan_day_index] ??= session.id;
  }
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
          <TodayWorkoutCard
            planId={current.id}
            days={current.plan.days.map((d, index) => ({
              index,
              day: d.day_of_week,
              focus: d.focus,
            }))}
            resume={resume}
          />
          <PlanView
            plan={current.plan}
            exercises={buildExerciseIndex(catalogue)}
            dayAction={(day, index) => (
              <StartWorkoutButton
                planId={current.id}
                dayIndex={index}
                label={`Start ${capitalise(day.day_of_week)}'s workout`}
                resumeSessionId={resume[index]}
              />
            )}
          />
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
