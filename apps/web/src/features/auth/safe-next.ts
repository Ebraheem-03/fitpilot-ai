const FALLBACK = "/app";

/** Only same-origin in-app paths are allowed as post-sign-in destinations (no open redirects). */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return FALLBACK;
  if (!raw.startsWith("/app")) return FALLBACK;
  if (raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return FALLBACK;
  try {
    const url = new URL(raw, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return FALLBACK;
    if (!/^\/app(\/|$)/.test(url.pathname)) return FALLBACK;
    return url.pathname + url.search;
  } catch {
    return FALLBACK;
  }
}
