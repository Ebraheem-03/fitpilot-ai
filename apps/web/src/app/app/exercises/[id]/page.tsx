import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { listLabel } from "@/features/exercise-library/labels";
import { ExerciseDemo } from "@/features/exercise-viewer/ExerciseDemo";
import { getExercise } from "@/lib/api";

export async function generateMetadata({
  params,
}: PageProps<"/app/exercises/[id]">): Promise<Metadata> {
  await connection();
  // getExercise is wrapped in React cache(): metadata and page share one API call per request.
  const exercise = await getExercise((await params).id);
  return { title: `${exercise?.name ?? "Exercise"} · FitPilot AI` };
}

async function ExerciseDetail({ params }: Pick<PageProps<"/app/exercises/[id]">, "params">) {
  await connection();
  const exercise = await getExercise((await params).id);
  if (!exercise) notFound();

  const facts: [string, string][] = [
    ["Works", listLabel(exercise.target_muscles, "—")],
    ["Equipment", listLabel(exercise.equipment, "None (bodyweight)")],
    ["Best camera angle for tracking", listLabel(exercise.camera_views, "—")],
  ];
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{exercise.name}</h1>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-muted">{term}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      <ExerciseDemo exercise={exercise} />
      {exercise.technique_considerations.length > 0 && (
        <section className="rounded-xl border border-border p-5">
          <h2 className="font-semibold">Technique notes</h2>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {exercise.technique_considerations.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

export default function ExercisePage({ params }: PageProps<"/app/exercises/[id]">) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/app/exercises" className="text-sm font-medium text-muted hover:text-foreground">
        ← Exercise library
      </Link>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ExerciseDetail params={params} />
      </Suspense>
    </div>
  );
}
