import type { ExerciseAnimation } from "@fitpilot/exercise-contracts";
import { describe, expect, it } from "vitest";
import { bindClip, depthAt, SQUAT_MOTION } from "../src";

const timeline: ExerciseAnimation["phases"] = [
  { phase: "standing", start_s: 0, end_s: 0.5, instruction_indices: [] },
  { phase: "descending", start_s: 0.5, end_s: 2, instruction_indices: [] },
  { phase: "bottom", start_s: 2, end_s: 2.4, instruction_indices: [] },
  { phase: "ascending", start_s: 2.4, end_s: 3.6, instruction_indices: [] },
  { phase: "standing", start_s: 3.6, end_s: 4, instruction_indices: [] },
];
const depth = (t: number) => depthAt(timeline, SQUAT_MOTION.phaseDepth, t);

describe("depthAt", () => {
  it("follows the catalogue phases", () => {
    expect(depth(0.25)).toBe(0);
    expect(depth(1.25)).toBeCloseTo(0.5, 6);
    expect(depth(2.2)).toBe(1);
    expect(depth(3)).toBeCloseTo(0.5, 6);
    expect(depth(3.8)).toBe(0);
  });

  it("is continuous across phase boundaries and loops seamlessly", () => {
    for (const b of [0.5, 2, 2.4, 3.6]) {
      expect(Math.abs(depth(b - 1e-9) - depth(b))).toBeLessThan(1e-6);
    }
    expect(depth(4)).toBe(depth(0));
  });

  it("is monotonic within the descent", () => {
    let last = -1;
    for (let t = 0.5; t < 2; t += 0.05) {
      expect(depth(t)).toBeGreaterThanOrEqual(last);
      last = depth(t);
    }
  });
});

describe("bindClip", () => {
  it("refuses a timeline phase the motion does not define", () => {
    const animation: ExerciseAnimation = {
      asset: "x.glb",
      clip: "x",
      duration_s: 1,
      phases: [{ phase: "hold", start_s: 0, end_s: 1, instruction_indices: [] }],
    };
    expect(() => bindClip(animation, SQUAT_MOTION)).toThrow('motion has no depth for phase "hold"');
  });
});
