import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

// Skips the session refresh only for public static files: images outside /app, the CC0
// exercise models at exactly /exercises/<id>/<asset>.glb (ADR-0009) and the vendored pose
// runtime at exactly /mediapipe/{wasm,models}/<file> (ADR-0010). Everything under /app,
// whatever its extension, goes through the proxy (M1 security review).
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|exercises/[a-z0-9_]+/[a-z0-9_-]+\\.glb$|mediapipe/(?:wasm|models)/[a-z0-9_]+\\.(?:js|wasm|task)$|(?!app/).*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
