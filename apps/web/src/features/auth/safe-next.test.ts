import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it.each([
    ["/app", "/app"],
    ["/app/profile", "/app/profile"],
    ["/app/profile?tab=goals", "/app/profile?tab=goals"],
  ])("keeps in-app path %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    [null],
    [""],
    ["https://evil.example/app"],
    ["//evil.example/app"],
    ["/\\evil.example"],
    ["/application-but-not-app"],
    ["/app/../admin"],
    ["/sign-in"],
    ["/app\u0000evil"],
    ["javascript:alert(1)"],
  ])("falls back to /app for %s", (raw) => {
    expect(safeNextPath(raw)).toBe("/app");
  });
});
