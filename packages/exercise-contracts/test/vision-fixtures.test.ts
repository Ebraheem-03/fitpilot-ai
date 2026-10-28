import { describe, expect, it } from "vitest";
import { ClipLabels, LandmarkFixture } from "../src";

const labels = {
  format_version: 1,
  clip_id: "squat_side_001",
  exercise_id: "bodyweight_squat",
  camera_view: "side",
  facing: "left",
  supported: true,
  conditions: { lighting: "normal", clothing: "fitted", distance_m: 2.5 },
  reps: [
    { start_ms: 1200, bottom_ms: 1900, end_ms: 2700, full_depth: true },
    { start_ms: 3000, bottom_ms: 3600, end_ms: 4300, full_depth: false },
  ],
  untrackable_ranges_ms: [[5000, 6000]],
  annotated_by: "owner",
};

describe("ClipLabels", () => {
  it("accepts the documented example", () =>
    expect(ClipLabels.safeParse(labels).success).toBe(true));

  it("rejects a rep whose bottom is not between start and end", () => {
    const bad = {
      ...labels,
      reps: [{ start_ms: 1000, bottom_ms: 900, end_ms: 2000, full_depth: true }],
    };
    expect(ClipLabels.safeParse(bad).success).toBe(false);
  });

  it("rejects overlapping reps", () => {
    const bad = { ...labels, reps: [labels.reps[0], { ...labels.reps[1], start_ms: 2600 }] };
    expect(ClipLabels.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty or reversed untrackable range", () => {
    expect(ClipLabels.safeParse({ ...labels, untrackable_ranges_ms: [[6000, 5000]] }).success).toBe(
      false,
    );
  });
});

describe("LandmarkFixture", () => {
  const base = {
    format_version: 1,
    clip_id: "c",
    exercise_id: "bodyweight_squat",
    source: {
      kind: "recording",
      model: "pose_landmarker_lite",
      tasks_vision_version: "1.1.1",
      width: 640,
      height: 480,
      fps: 30,
    },
    landmark_names: ["left_hip", "left_knee"],
    frames: [
      { t_ms: 0, p: [0, 0, 0, 1, 0, 0, 0, 1] },
      { t_ms: 33, p: null },
    ],
  };

  it("accepts packed frames and null (no person) frames", () =>
    expect(LandmarkFixture.safeParse(base).success).toBe(true));

  it("rejects non-increasing timestamps", () => {
    const bad = { ...base, frames: [base.frames[0], { t_ms: 0, p: null }] };
    expect(LandmarkFixture.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown landmark names (no face mesh or extra points)", () => {
    expect(
      LandmarkFixture.safeParse({ ...base, landmark_names: ["left_eye", "left_knee"] }).success,
    ).toBe(false);
  });
});
