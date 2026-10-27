import "server-only";
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

/** Server-side call to FastAPI with the caller's Supabase access token (ADR-0003). */
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  if (!token) throw new ApiError(401, null);
  return fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
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
