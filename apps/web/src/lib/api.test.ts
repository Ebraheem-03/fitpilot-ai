import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
const getAccessToken = vi.fn<() => Promise<string | null>>();
vi.mock("@/lib/supabase/server", () => ({ getAccessToken }));

const { getMyProfile } = await import("./api");

describe("apiFetch session handling", () => {
  beforeEach(() => {
    vi.stubEnv("API_BASE_URL", "http://api.test");
    redirect.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the bearer token to the server-only API_BASE_URL", async () => {
    getAccessToken.mockResolvedValue("tok");
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getMyProfile()).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/profiles/me");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("goes to /session-expired (not /sign-in, which would loop) when the API says 401", async () => {
    getAccessToken.mockResolvedValue("tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    await expect(getMyProfile()).rejects.toThrow("REDIRECT:/session-expired");
  });

  it("goes to /session-expired when there is no session token", async () => {
    getAccessToken.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn());
    await expect(getMyProfile()).rejects.toThrow("REDIRECT:/session-expired");
  });
});
