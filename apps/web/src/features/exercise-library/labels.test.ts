import { describe, expect, it } from "vitest";
import { listLabel } from "./labels";

describe("listLabel", () => {
  it("joins and capitalises catalogue values", () => {
    expect(listLabel(["quadriceps", "glutes"], "—")).toBe("Quadriceps, glutes");
    expect(listLabel(["front_45"], "—")).toBe("Front 45");
  });

  it("uses the fallback for an empty list", () => {
    expect(listLabel([], "None (bodyweight)")).toBe("None (bodyweight)");
  });
});
