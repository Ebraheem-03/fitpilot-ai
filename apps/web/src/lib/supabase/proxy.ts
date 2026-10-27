import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session cookie on every request. Optimistic redirect only —
// the FastAPI backend is the authorization authority (ADR-0003).
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Nothing may run between createServerClient and getClaims (Supabase SSR guidance).
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims && request.nextUrl.pathname.startsWith("/spike/me")) {
    const url = request.nextUrl.clone();
    url.pathname = "/spike";
    return NextResponse.redirect(url);
  }
  return response;
}
