"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { ApiError, createProfile, type ProfileInput } from "@/lib/api";

export type OnboardingState = { error: string | null };

// Non-numeric input is passed through as text so the API rejects it (422) instead of JSON
// silently turning NaN into null ("not set").
function optionalInt(value: FormDataEntryValue | null): number | string | null {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isNaN(n) ? text : n;
}

export async function createProfileAction(
  _prev: OnboardingState,
  form: FormData,
): Promise<OnboardingState> {
  // The API validates everything again; this only shapes the form into the request body.
  const input = {
    primary_goal: String(form.get("primary_goal") ?? ""),
    experience_level: String(form.get("experience_level") ?? "beginner"),
    days_per_week: optionalInt(form.get("days_per_week")),
    session_minutes: optionalInt(form.get("session_minutes")),
    equipment: form.getAll("equipment").map(String),
  } as ProfileInput;

  try {
    await createProfile(input);
  } catch (e) {
    unstable_rethrow(e); // let redirect("/session-expired") from apiFetch through
    if (e instanceof ApiError && e.status === 409) redirect("/app/profile");
    if (e instanceof ApiError && e.status === 422) {
      return { error: "Some answers aren't valid. Please check them and try again." };
    }
    return { error: "We couldn't save your profile. Please try again." };
  }
  redirect("/app/profile");
}
