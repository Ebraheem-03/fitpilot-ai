import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { analyzerFor } from "@/features/live-coaching/analyzers";
import { LiveCoach } from "@/features/live-coaching/LiveCoach";
import { getExercise } from "@/lib/api";

export async function generateMetadata({
  params,
}: PageProps<"/app/exercises/[id]/live">): Promise<Metadata> {
  await connection();
  const exercise = await getExercise((await params).id);
  return { title: `Live tracking · ${exercise?.name ?? "Exercise"} · FitPilot AI` };
}

async function Live({ params }: Pick<PageProps<"/app/exercises/[id]/live">, "params">) {
  await connection();
  const exercise = await getExercise((await params).id);
  if (!exercise) notFound();
  if (!analyzerFor(exercise.id)) {
    return (
      <p className="rounded-xl border border-border p-5">
        Live camera tracking isn&apos;t available for {exercise.name} yet. Follow the{" "}
        <Link href={`/app/exercises/${exercise.id}`} className="underline">
          3D demonstration
        </Link>{" "}
        instead.
      </p>
    );
  }
  return (
    <LiveCoach
      exercise={{
        id: exercise.id,
        name: exercise.name,
        required_landmarks: exercise.required_landmarks,
      }}
    />
  );
}

export default function LivePage({ params }: PageProps<"/app/exercises/[id]/live">) {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <BackLink params={params} />
      </Suspense>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Live params={params} />
      </Suspense>
    </div>
  );
}

async function BackLink({ params }: Pick<PageProps<"/app/exercises/[id]/live">, "params">) {
  const { id } = await params;
  return (
    <Link
      href={`/app/exercises/${id}`}
      className="text-sm font-medium text-muted hover:text-foreground"
    >
      ← Back to the exercise
    </Link>
  );
}
