import type { ExerciseContract } from "@fitpilot/exercise-contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { capitalise } from "@/features/plans/labels";
import { canTrackLive } from "@/features/exercise-library/ExerciseGuide";
import { type RunnerExercise, WorkoutRunner } from "@/features/workouts/WorkoutRunner";
import { getMe, getMyProfile, getWorkoutSession, listExercises } from "@/lib/api";
import { hasCurrentTrackingConsent } from "@/lib/api-types";
import { getPlan } from "@/lib/api-plans";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Today's workout · FitPilot AI" };

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p data-testid="workout-unavailable" className="rounded-xl border border-border p-5">
      {children}{" "}
      <Link href="/app/plan" className="font-medium underline">
        Back to your plan
      </Link>
    </p>
  );
}

async function Workout({ params }: Pick<PageProps<"/app/workouts/[sessionId]">, "params">) {
  await connection();
  const { sessionId } = await params;
  if (!UUID.test(sessionId)) notFound();
  const session = await getWorkoutSession(sessionId);
  if (!session) notFound();
  if (session.status === "completed") redirect(`/app/workouts/${sessionId}/summary`);

  if (session.training_plan_id === null || session.plan_day_index === null) {
    return <Notice>This workout isn&apos;t linked to a training plan day.</Notice>;
  }
  const [me, plan, catalogue, profile] = await Promise.all([
    getMe(),
    getPlan(session.training_plan_id),
    listExercises(),
    getMyProfile(),
  ]);
  const day = plan?.plan?.days[session.plan_day_index];
  if (!day) return <Notice>This workout&apos;s plan day is no longer available.</Notice>;

  const byId = new Map<string, ExerciseContract>(catalogue.map((e) => [e.id, e]));
  const exercises: RunnerExercise[] = day.exercises.map((planned) => {
    const e = byId.get(planned.exercise_id);
    return {
      id: planned.exercise_id,
      name: e?.name ?? planned.exercise_id.replaceAll("_", " "),
      hasDemo: e?.animation != null,
      tracked: e ? canTrackLive(e) : false,
      prescription: e?.prescription ?? (planned.reps !== null ? "reps" : "duration"),
      instructions: e?.instructions ?? ["Follow the exercise page for the steps."],
      required_landmarks: e?.required_landmarks ?? [],
      planned,
    };
  });

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today&apos;s workout</h1>
        <p className="mt-1 text-muted" data-testid="workout-day">
          {capitalise(day.day_of_week)} · {day.focus}
        </p>
      </div>
      <WorkoutRunner
        userId={me.id}
        sessionId={sessionId}
        exercises={exercises}
        trackingConsent={hasCurrentTrackingConsent(profile)}
      />
    </>
  );
}

export default function WorkoutPage({ params }: PageProps<"/app/workouts/[sessionId]">) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/app/workouts" className="text-sm font-medium text-muted hover:text-foreground">
        ← Your workouts
      </Link>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Workout params={params} />
      </Suspense>
    </div>
  );
}
