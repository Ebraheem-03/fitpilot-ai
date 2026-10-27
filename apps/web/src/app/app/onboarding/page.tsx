import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OnboardingForm } from "@/features/onboarding/OnboardingForm";
import { getMyProfile } from "@/lib/api";

export const metadata: Metadata = { title: "Set up your profile · FitPilot AI" };

async function Onboarding() {
  await connection();
  if (await getMyProfile()) redirect("/app/profile");
  return <OnboardingForm />;
}

export default function OnboardingPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Set up your training profile</h1>
        <p className="mt-1 text-muted">You can change these answers later.</p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Onboarding />
      </Suspense>
    </div>
  );
}
