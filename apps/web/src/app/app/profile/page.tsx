import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getMyProfile } from "@/lib/api";
import { EQUIPMENT_LABELS, EXPERIENCE_LABELS, GOAL_LABELS } from "@/lib/profile-labels";

export const metadata: Metadata = { title: "Your profile · FitPilot AI" };

async function ProfileDetails() {
  await connection();
  const profile = await getMyProfile();
  if (!profile) redirect("/app/onboarding");

  const rows: [string, string][] = [
    ["Main goal", GOAL_LABELS[profile.primary_goal]],
    ["Experience", EXPERIENCE_LABELS[profile.experience_level]],
    ["Days per week", profile.days_per_week?.toString() ?? "Not set"],
    ["Minutes per session", profile.session_minutes?.toString() ?? "Not set"],
    [
      "Equipment",
      profile.equipment.length
        ? profile.equipment.map((e) => EQUIPMENT_LABELS[e]).join(", ")
        : "Bodyweight only",
    ],
  ];
  return (
    <dl data-testid="profile" className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted">{term}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ProfilePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ProfileDetails />
      </Suspense>
    </div>
  );
}
