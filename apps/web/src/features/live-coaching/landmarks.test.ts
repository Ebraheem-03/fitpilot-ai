import { describe, expect, it } from "vitest";
import { isOutOfFrame, toLandmarkFrame } from "./landmarks";
import { LANDMARK_STRIDE, POSE_LANDMARK_COUNT } from "./worker/protocol";

const raw = (x: number, y: number, z = 0) => {
  const a = new Float32Array(POSE_LANDMARK_COUNT * LANDMARK_STRIDE);
  for (let i = 0; i < POSE_LANDMARK_COUNT; i++) a.set([x, y, z, 0.9], i * LANDMARK_STRIDE);
  return a;
};

describe("toLandmarkFrame (aspect-corrected units, M2 calibration finding)", () => {
  it("scales x and z by width/height so angles are true on portrait and landscape video", () => {
    expect(toLandmarkFrame(raw(0.5, 0.5, 0.1), 9 / 16).left_knee).toMatchObject({
      x: 0.5 * (9 / 16),
      y: 0.5,
      z: expect.closeTo(0.1 * (9 / 16)),
    });
    expect(toLandmarkFrame(raw(0.5, 0.5), 16 / 9).left_knee!.x).toBeCloseTo(0.5 * (16 / 9));
  });

  it("checks image bounds in the same units", () => {
    const portrait = 9 / 16;
    expect(isOutOfFrame(toLandmarkFrame(raw(0.9, 0.5), portrait), ["left_knee"], portrait)).toBe(
      false,
    );
    expect(isOutOfFrame(toLandmarkFrame(raw(1.1, 0.5), portrait), ["left_knee"], portrait)).toBe(
      true,
    );
    expect(isOutOfFrame(toLandmarkFrame(raw(0.5, 1.05), portrait), ["left_knee"], portrait)).toBe(
      true,
    );
  });
});
