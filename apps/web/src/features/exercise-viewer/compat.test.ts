import type { ExerciseAnimation } from "@fitpilot/exercise-contracts";
import { describe, expect, it } from "vitest";
import { assetUrl, incompatibility } from "./compat";

const animation: ExerciseAnimation = {
  asset: "squat.glb",
  clip: "squat",
  duration_s: 4,
  phases: [{ phase: "standing", start_s: 0, end_s: 4, instruction_indices: [] }],
};

describe("incompatibility", () => {
  it("accepts a rigged model with the catalogue's clip", () => {
    expect(
      incompatibility({ skinned: true, clips: [{ name: "squat", duration: 4.01 }] }, animation),
    ).toBeNull();
  });

  it("rejects a model without a rigged mesh", () => {
    expect(
      incompatibility({ skinned: false, clips: [{ name: "squat", duration: 4 }] }, animation),
    ).toBe("the model has no rigged mesh");
  });

  it("rejects a model missing the clip", () => {
    expect(
      incompatibility({ skinned: true, clips: [{ name: "Idle", duration: 4 }] }, animation),
    ).toBe('clip "squat" is missing');
  });

  it("rejects a clip whose duration disagrees with the phase timeline", () => {
    expect(
      incompatibility({ skinned: true, clips: [{ name: "squat", duration: 3 }] }, animation),
    ).toBe("clip lasts 3.00 s but the exercise expects 4 s");
  });
});

describe("assetUrl", () => {
  it("serves GLBs from /exercises/<id>/", () => {
    expect(assetUrl("bodyweight_squat", animation)).toBe("/exercises/bodyweight_squat/squat.glb");
  });
});
