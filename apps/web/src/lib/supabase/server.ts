import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

export async function createClient() {
  const { url, key } = supabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component; proxy.ts refreshes the session cookie instead.
        }
      },
    },
  });
}

/** The caller's access token, forwarded to FastAPI as a bearer token (ADR-0003). */
export async function getAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return null;
  // getClaims() verified the session above; getSession() only supplies the raw token.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
