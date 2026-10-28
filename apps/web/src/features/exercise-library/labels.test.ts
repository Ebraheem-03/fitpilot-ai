import { EQUIPMENT as CONTRACT_EQUIPMENT } from "@fitpilot/exercise-contracts";
import { describe, expect, it } from "vitest";
import { EQUIPMENT as PROFILE_EQUIPMENT } from "@/lib/api-types";
import { listLabel } from "./labels";

describe("equipment vocabulary", () => {
  it("is the same for exercises (contract) and member profiles (api-types)", () => {
    expect([...CONTRACT_EQUIPMENT]).toEqual([...PROFILE_EQUIPMENT]);
  });
});

describe("listLabel", () => {
  it("joins and capitalises catalogue values", () => {
    expect(listLabel(["quadriceps", "glutes"], "—")).toBe("Quadriceps, glutes");
    expect(listLabel(["front_45"], "—")).toBe("Front 45");
  });

  it("uses the fallback for an empty list", () => {
    expect(listLabel([], "None (bodyweight)")).toBe("None (bodyweight)");
  });
});
