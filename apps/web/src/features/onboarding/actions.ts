"use server";

import { redirect } from "next/navigation";
import { ApiError, createProfile, type ProfileInput } from "@/lib/api";

export type OnboardingState = { error: string | null };

function optionalInt(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
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
    if (e instanceof ApiError && e.status === 409) redirect("/app/profile");
    if (e instanceof ApiError && e.status === 422) {
      return { error: "Some answers aren't valid. Please check them and try again." };
    }
    if (e instanceof ApiError && e.status === 401) redirect("/sign-in");
    return { error: "We couldn't save your profile. Please try again." };
  }
  redirect("/app/profile");
}
