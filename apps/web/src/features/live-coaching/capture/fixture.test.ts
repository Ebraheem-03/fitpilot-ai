import {
  ClipLabels,
  LANDMARK_NAMES,
  LandmarkFixture,
  MEDIAPIPE_POSE_INDEX,
} from "@fitpilot/exercise-contracts";
import { describe, expect, it } from "vitest";
import { LANDMARK_STRIDE, POSE_LANDMARK_COUNT } from "../worker/protocol";
import { buildLandmarkFixture, mannequinLabels, packLandmarks } from "./fixture";

function raw(fill: (i: number) => number) {
  const a = new Float32Array(POSE_LANDMARK_COUNT * LANDMARK_STRIDE);
  for (let i = 0; i < a.length; i++) a[i] = fill(i);
  return a;
}

describe("packLandmarks", () => {
  it("keeps only the named landmarks, in LANDMARK_NAMES order, rounded to 4 dp", () => {
    const p = packLandmarks(raw((i) => i + 0.123456))!;
    expect(p).toHaveLength(LANDMARK_NAMES.length * 4);
    const knee = MEDIAPIPE_POSE_INDEX.left_knee * 4;
    const at = LANDMARK_NAMES.indexOf("left_knee") * 4;
    expect(p.slice(at, at + 4)).toEqual([
      knee + 0.1235,
      knee + 1.1235,
      knee + 2.1235,
      knee + 3.1235,
    ]);
  });

  it("passes through no-person frames", () => expect(packLandmarks(null)).toBeNull());
});

describe("buildLandmarkFixture", () => {
  it("produces a schema-valid fixture", () => {
    const f = buildLandmarkFixture({
      clipId: "squat_side_001",
      exerciseId: "bodyweight_squat",
      kind: "recording",
      model: "lite",
      width: 640,
      height: 480,
      fps: 30,
      frames: [
        { tMs: 0, landmarks: raw(() => 0.5) },
        { tMs: 33, landmarks: null },
      ],
    });
    expect(LandmarkFixture.safeParse(f).success).toBe(true);
    expect(f.source.model).toBe("pose_landmarker_lite");
  });
});

describe("mannequinLabels", () => {
  const animation = {
    asset: "squat.glb",
    clip: "squat",
    duration_s: 4,
    phases: [
      { phase: "standing", start_s: 0, end_s: 0.5, instruction_indices: [] },
      { phase: "descending", start_s: 0.5, end_s: 2, instruction_indices: [] },
      { phase: "bottom", start_s: 2, end_s: 2.4, instruction_indices: [] },
      { phase: "ascending", start_s: 2.4, end_s: 3.6, instruction_indices: [] },
      { phase: "standing", start_s: 3.6, end_s: 4, instruction_indices: [] },
    ],
  };

  it("derives one rep per loop from the clip's phase timeline", () => {
    const l = mannequinLabels({
      clipId: "mannequin",
      exerciseId: "bodyweight_squat",
      animation,
      loops: 3,
      blankLoops: [],
    });
    expect(ClipLabels.safeParse(l).success).toBe(true);
    expect(l.reps).toEqual([
      { start_ms: 500, bottom_ms: 2200, end_ms: 3600, full_depth: true },
      { start_ms: 4500, bottom_ms: 6200, end_ms: 7600, full_depth: true },
      { start_ms: 8500, bottom_ms: 10200, end_ms: 11600, full_depth: true },
    ]);
  });

  it("turns blank loops into untrackable spans with no rep", () => {
    const l = mannequinLabels({
      clipId: "m",
      exerciseId: "bodyweight_squat",
      animation,
      loops: 3,
      blankLoops: [1],
    });
    expect(l.reps.map((r) => r.start_ms)).toEqual([500, 8500]);
    expect(l.untrackable_ranges_ms).toEqual([[4000, 8000]]);
  });
});
