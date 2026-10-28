import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { listExercises } from "@/lib/api";
import { ExerciseCard } from "@/features/exercise-library/ExerciseCard";

export const metadata: Metadata = { title: "Exercise library · FitPilot AI" };

async function ExerciseList() {
  await connection();
  const exercises = await listExercises();
  return (
    <ul className="grid gap-4 sm:grid-cols-2" data-testid="exercise-list">
      {exercises.map((exercise) => (
        <li key={exercise.id}>
          <ExerciseCard exercise={exercise} />
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
          Every exercise FitPilot coaches, with step-by-step instructions and a 3D demonstration
          where one exists.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ExerciseList />
      </Suspense>
    </div>
  );
}
