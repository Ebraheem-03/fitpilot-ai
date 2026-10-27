import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

const PROTECTED = /^\/app(\/|$)/;
const AUTH_PAGES = new Set(["/sign-in", "/sign-up"]);

// Refreshes the Supabase session cookie on every request and does optimistic redirects only.
// FastAPI is the authorization authority (ADR-0003); this never decides access to data.
export async function updateSession(request: NextRequest) {
  const { url, key } = supabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // Nothing may run between createServerClient and getClaims (Supabase SSR guidance).
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  if (!signedIn && PROTECTED.test(pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = "/sign-in";
    target.search = `?next=${encodeURIComponent(pathname)}`;
    return redirectKeepingCookies(target, response);
  }
  if (signedIn && AUTH_PAGES.has(pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = "/app";
    target.search = "";
    return redirectKeepingCookies(target, response);
  }
  return response;
}

// A refreshed session must survive the redirect, or the user is signed out on the next hop.
function redirectKeepingCookies(target: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(target);
  from.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}
