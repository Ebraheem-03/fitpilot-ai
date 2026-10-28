import { afterEach, describe, expect, it, vi } from "vitest";
import DevLayout from "./layout";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

describe("dev tools layout", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("404s in production builds", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEV_TOOLS", "");
    expect(() => DevLayout({ children: null } as never)).toThrow("NEXT_NOT_FOUND");
  });

  it("can be enabled in a production build for on-device measurement", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEV_TOOLS", "1");
    expect(() => DevLayout({ children: null } as never)).not.toThrow();
  });

  it("renders in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => DevLayout({ children: null } as never)).not.toThrow();
  });
});
