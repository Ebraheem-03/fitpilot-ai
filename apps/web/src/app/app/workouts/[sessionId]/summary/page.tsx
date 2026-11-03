import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SummaryView } from "@/features/workouts/SummaryView";
import { getWorkoutSession, listExercises } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Workout summary · FitPilot AI" };

async function Summary({ params }: Pick<PageProps<"/app/workouts/[sessionId]/summary">, "params">) {
  await connection();
  const { sessionId } = await params;
  if (!UUID.test(sessionId)) notFound();
  const [session, catalogue] = await Promise.all([getWorkoutSession(sessionId), listExercises()]);
  if (!session) notFound();
  // Not finished yet: the summary doesn't exist; go back to the workout.
  if (session.status !== "completed" || !session.summary) redirect(`/app/workouts/${sessionId}`);
  const names = Object.fromEntries(catalogue.map((e) => [e.id, e.name]));
  return <SummaryView summary={session.summary} names={names} />;
}

export default function SummaryPage({ params }: PageProps<"/app/workouts/[sessionId]/summary">) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/app/workouts" className="text-sm font-medium text-muted hover:text-foreground">
        ← Your workouts
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Workout summary</h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Summary params={params} />
      </Suspense>
    </div>
  );
}
