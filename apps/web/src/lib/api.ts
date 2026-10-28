import "server-only";
import { ExerciseContract } from "@fitpilot/exercise-contracts";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAccessToken } from "@/lib/supabase/server";

import type { Me, Profile, ProfileInput } from "@/lib/api-types";

export type { Me, Profile, ProfileInput, Role } from "@/lib/api-types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API responded ${status}`);
  }
}

// Where bearer tokens are sent: server-only and read at runtime, never a build-time public var.
function apiBaseUrl(): string {
  const url = process.env.API_BASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV !== "production") return "http://localhost:8000";
  throw new Error("API_BASE_URL must be set (see .env.example)");
}

/**
 * Server-side call to FastAPI with the caller's Supabase access token (ADR-0003).
 * If the API rejects a session that Supabase still considers valid (e.g. misconfigured issuer,
 * deleted user), go to /session-expired rather than /sign-in: the proxy would bounce a
 * still-signed-in user from /sign-in back to /app, looping forever.
 */
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  if (!token) redirect("/session-expired");
  const res = await fetch(`${apiBaseUrl()}/api/v1${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401) redirect("/session-expired");
  return res;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

export async function getMe(): Promise<Me> {
  return json<Me>(await apiFetch("/users/me"));
}

export async function getMyProfile(): Promise<Profile | null> {
  const res = await apiFetch("/profiles/me");
  if (res.status === 404) return null;
  return json<Profile>(res);
}

export async function createProfile(input: ProfileInput): Promise<Profile> {
  return json<Profile>(
    await apiFetch("/profiles", { method: "POST", body: JSON.stringify(input) }),
  );
}

/** Approved catalogue (principle 2). Parsed with the shared zod contract, never trusted blindly. */
export async function listExercises(): Promise<ExerciseContract[]> {
  return ExerciseContract.array().parse(await json<unknown>(await apiFetch("/exercises")));
}

const EXERCISE_ID = /^[a-z0-9_]+$/;

/** One exercise, or null when it is not in the catalogue. Deduplicated per request. */
export const getExercise = cache(async (id: string): Promise<ExerciseContract | null> => {
  if (!EXERCISE_ID.test(id)) return null;
  const res = await apiFetch(`/exercises/${id}`);
  if (res.status === 404) return null;
  return ExerciseContract.parse(await json<unknown>(res));
});
