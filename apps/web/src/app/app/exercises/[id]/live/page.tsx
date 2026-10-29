import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { analyzerFor } from "@/features/live-coaching/analyzers";
import { LiveCoach } from "@/features/live-coaching/LiveCoach";
import { getExercise, getMyProfile, getWorkoutSession } from "@/lib/api";
import { TRACKING_CONSENT_VERSION } from "@/lib/api-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: PageProps<"/app/exercises/[id]/live">): Promise<Metadata> {
  await connection();
  const exercise = await getExercise((await params).id);
  return { title: `Live tracking · ${exercise?.name ?? "Exercise"} · FitPilot AI` };
}

async function Live({
  params,
  searchParams,
}: Pick<PageProps<"/app/exercises/[id]/live">, "params" | "searchParams">) {
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
  // `?session=<id>` ties this set to a started workout; without it this is practice mode and
  // nothing is saved (ADR-0011). An unknown or someone else's id is a 404, not practice mode.
  const raw = (await searchParams).session;
  const sessionId = typeof raw === "string" ? raw : undefined;
  let consent = false;
  if (sessionId !== undefined) {
    if (!UUID.test(sessionId) || !(await getWorkoutSession(sessionId))) notFound();
    const profile = await getMyProfile();
    consent =
      profile?.tracking_data_consent_at != null &&
      (profile.tracking_data_consent_version ?? 0) >= TRACKING_CONSENT_VERSION;
  }
  return (
    <LiveCoach
      sessionId={sessionId}
      trackingConsent={consent}
      exercise={{
        id: exercise.id,
        name: exercise.name,
        required_landmarks: exercise.required_landmarks,
      }}
    />
  );
}

export default function LivePage({ params, searchParams }: PageProps<"/app/exercises/[id]/live">) {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <BackLink params={params} />
      </Suspense>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Live params={params} searchParams={searchParams} />
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
