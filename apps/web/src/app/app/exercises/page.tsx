import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { listExercises } from "@/lib/api";
import { listLabel } from "@/features/exercise-library/labels";

export const metadata: Metadata = { title: "Exercise library · FitPilot AI" };

async function ExerciseList() {
  await connection();
  const exercises = await listExercises();
  return (
    <ul className="grid gap-4 sm:grid-cols-2" data-testid="exercise-list">
      {exercises.map((exercise) => (
        <li key={exercise.id}>
          <Link
            href={`/app/exercises/${exercise.id}`}
            className="flex h-full flex-col gap-2 rounded-xl border border-border p-5 hover:border-brand"
          >
            <span className="text-lg font-semibold">{exercise.name}</span>
            <span className="text-sm text-muted">
              Works: {listLabel(exercise.target_muscles, "—")}
            </span>
            <span className="text-sm text-muted">
              Equipment: {listLabel(exercise.equipment, "None (bodyweight)")}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function ExercisesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Exercise library</h1>
        <p className="mt-1 text-muted">
          Every exercise FitPilot coaches, with a 3D demonstration and step-by-step instructions.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ExerciseList />
      </Suspense>
    </div>
  );
}
