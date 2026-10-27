import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getMyProfile } from "@/lib/api";
import { GOAL_LABELS } from "@/lib/profile-labels";

async function NextStep() {
  await connection();
  const profile = await getMyProfile();
  if (!profile) {
    return (
      <section className="rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold">Set up your training profile</h2>
        <p className="mt-1 text-muted">
          Tell us your goal and what equipment you have. It takes about a minute.
        </p>
        <Link
          href="/app/onboarding"
          className="mt-4 inline-block rounded-md bg-brand px-4 py-2 font-medium text-brand-foreground hover:bg-brand-hover"
        >
          Start
        </Link>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-border p-6">
      <h2 className="text-lg font-semibold">Your goal: {GOAL_LABELS[profile.primary_goal]}</h2>
      <p className="mt-1 text-muted">Workout plans arrive in a later milestone.</p>
      <Link href="/app/profile" className="mt-4 inline-block font-medium underline">
        View your profile
      </Link>
    </section>
  );
}

export default function AppHome() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to FitPilot</h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <NextStep />
      </Suspense>
    </div>
  );
}
