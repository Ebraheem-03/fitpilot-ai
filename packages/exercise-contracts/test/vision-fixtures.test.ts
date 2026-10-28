import { describe, expect, it } from "vitest";
import { ClipLabels, LandmarkFixture, VisionGate } from "../src";

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

describe("ClipLabels cue annotations (M3 S2)", () => {
  const rule = (over: Record<string, unknown> = {}) => ({
    rule_id: "squat.depth.shallow",
    method: "from_rep_labels",
    expected_reps: [1],
    not_expected_reps: [0],
    ...over,
  });
  const withCues = (rules: unknown[]) => ({ ...labels, cue_labels: { rules } });

  it("are optional: labels without them stay valid", () =>
    expect(ClipLabels.safeParse(labels).success).toBe(true));

  it("accept per-rule expected / not-expected rep indices", () =>
    expect(ClipLabels.safeParse(withCues([rule()])).success).toBe(true));

  it("reject a rep index that doesn't exist", () =>
    expect(ClipLabels.safeParse(withCues([rule({ not_expected_reps: [2] })])).success).toBe(false));

  it("reject a rep that is both expected and not expected", () =>
    expect(
      ClipLabels.safeParse(withCues([rule({ expected_reps: [0], not_expected_reps: [0] })]))
        .success,
    ).toBe(false));

  it("reject the same rule annotated twice", () =>
    expect(ClipLabels.safeParse(withCues([rule(), rule()])).success).toBe(false));

  it("reject an unknown annotation method", () =>
    expect(ClipLabels.safeParse(withCues([rule({ method: "guessed" })])).success).toBe(false));

  it("reject cue annotations on an unsupported setup (no cue may appear there at all)", () =>
    expect(ClipLabels.safeParse({ ...withCues([rule()]), supported: false }).success).toBe(false));
});

describe("VisionGate", () => {
  const gate = {
    runtime_model: "pose_landmarker_lite",
    min_precision: 0.95,
    min_recall: 0.9,
    min_refusal_rate: 0.8,
    match_tolerance_ms: 400,
    min_recorded_clips: 10,
    cues: { max_false_positive_rate: 0.05, min_judged_negatives: 50 },
  };

  it("accepts a gate with a cue section", () =>
    expect(VisionGate.safeParse(gate).success).toBe(true));

  it("requires the cue section, so cue scoring can't be skipped by omission", () => {
    const { cues: _cues, ...noCues } = gate;
    expect(VisionGate.safeParse(noCues).success).toBe(false);
  });

  it("requires at least one judged negative, so the cue gate can't pass vacuously", () =>
    expect(
      VisionGate.safeParse({ ...gate, cues: { ...gate.cues, min_judged_negatives: 0 } }).success,
    ).toBe(false));
});
