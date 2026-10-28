import type { ClipLabels, LandmarkFixture } from "@fitpilot/exercise-contracts";
import { describe, expect, it } from "vitest";
import { aggregate, decodeFrames, evaluateClip, type RepCounter } from "../src";

/** 30 fps clip of `seconds`, every frame with all landmarks visible except where `blank(t)`. */
function fixture(seconds: number, blank: (t: number) => boolean = () => false): LandmarkFixture {
  const names = ["left_hip", "left_knee"] as LandmarkFixture["landmark_names"];
  const frames = [];
  for (let t = 0; t < seconds * 1000; t += 33) {
    frames.push({ t_ms: t, p: blank(t) ? null : [0.5, 0.4, 0, 0.9, 0.5, 0.6, 0, 0.8] });
  }
  return {
    format_version: 1,
    clip_id: "clip",
    exercise_id: "bodyweight_squat",
    source: {
      kind: "synthetic",
      model: "pose_landmarker_lite",
      tasks_vision_version: "1.1.1",
      width: 640,
      height: 480,
      fps: 30,
    },
    landmark_names: names,
    frames,
  };
}

function labels(reps: [number, number][], extra: Partial<ClipLabels> = {}): ClipLabels {
  return {
    format_version: 1,
    clip_id: "clip",
    exercise_id: "bodyweight_squat",
    camera_view: "side",
    supported: true,
    conditions: { lighting: "normal", clothing: "fitted" },
    reps: reps.map(([s, e]) => ({
      start_ms: s,
      bottom_ms: (s + e) / 2,
      end_ms: e,
      full_depth: true,
    })),
    untrackable_ranges_ms: [],
    annotated_by: "test",
    ...extra,
  };
}

/** Completes a rep on the first frame at or after each scripted time. */
function scripted(times: number[]): RepCounter {
  const queue = [...times];
  return {
    step(frame, tMs) {
      const reliable = Object.keys(frame).length > 0;
      const repCompleted = queue.length > 0 && tMs >= queue[0]!;
      if (repCompleted) queue.shift();
      return { repCompleted, tracking: { reliable } };
    },
  };
}

const REPS: [number, number][] = [
  [1000, 3000],
  [4000, 6000],
  [7000, 9000],
];

describe("decodeFrames", () => {
  it("maps packed numbers to named landmarks and null to an empty frame", () => {
    const f = fixture(1, (t) => t >= 33 && t < 66);
    const [first, second] = decodeFrames(f);
    // 640×480: x is rescaled to image-height units (× 4/3), y stays
    expect(first!.frame.left_knee).toEqual({ x: 0.5 * (640 / 480), y: 0.6, z: 0, visibility: 0.8 });
    expect(second!.frame).toEqual({});
  });

  it("corrects for the clip's aspect ratio so angles are true angles (portrait too)", () => {
    const portrait = { ...fixture(1), source: { ...fixture(1).source, width: 360, height: 640 } };
    const knee = decodeFrames(portrait)[0]!.frame.left_knee!;
    expect(knee.x).toBeCloseTo(0.5 * (360 / 640));
  });
});

describe("evaluateClip", () => {
  it("scores a perfect count", () => {
    const e = evaluateClip(scripted([2900, 5900, 8900]), fixture(10), labels(REPS), 300);
    expect(e).toMatchObject({ truePositives: 3, falsePositives: 0, falseNegatives: 0, counted: 3 });
  });

  it("counts a double count as a false positive", () => {
    const e = evaluateClip(scripted([2900, 2950, 5900, 8900]), fixture(10), labels(REPS), 300);
    expect(e).toMatchObject({ truePositives: 3, falsePositives: 1, falseNegatives: 0 });
  });

  it("counts a missed rep as a false negative and reports which one", () => {
    const e = evaluateClip(scripted([2900, 8900]), fixture(10), labels(REPS), 300);
    expect(e).toMatchObject({
      truePositives: 2,
      falsePositives: 0,
      falseNegatives: 1,
      missedLabels: [1],
    });
  });

  it("matches within the tolerance only", () => {
    const late = evaluateClip(scripted([3250]), fixture(10), labels([[1000, 3000]]), 300);
    const tooLate = evaluateClip(scripted([3400]), fixture(10), labels([[1000, 3000]]), 300);
    expect(late.truePositives).toBe(1);
    expect(tooLate).toMatchObject({ truePositives: 0, falsePositives: 1, falseNegatives: 1 });
  });

  it("flags a rep counted inside an untrackable range", () => {
    const l = labels(REPS, { untrackable_ranges_ms: [[5000, 6500]] });
    const e = evaluateClip(scripted([2900, 5900, 8900]), fixture(10), l, 300);
    expect(e.repsInUntrackable).toBe(1);
    expect(e.falsePositives).toBe(1);
  });

  it("treats any count on an unsupported setup as false and doesn't penalise withholding", () => {
    const l = labels(REPS, { supported: false, camera_view: "front" });
    expect(evaluateClip(scripted([]), fixture(10), l, 300)).toMatchObject({
      falsePositives: 0,
      falseNegatives: 0,
    });
    expect(evaluateClip(scripted([2900]), fixture(10), l, 300)).toMatchObject({
      truePositives: 0,
      falsePositives: 1,
    });
  });

  it("reports the share of frames the counter judged unreliable", () => {
    const e = evaluateClip(
      scripted([]),
      fixture(1, (t) => t < 500),
      labels([]),
      300,
    );
    expect(e.unreliableFrameRatio).toBeCloseTo(0.5, 1);
  });
});

describe("aggregate", () => {
  it("pools counts across clips into precision and recall", () => {
    const a = evaluateClip(scripted([2900, 5900, 8900]), fixture(10), labels(REPS), 300);
    const b = evaluateClip(scripted([2900, 2950]), fixture(10), labels(REPS), 300);
    expect(aggregate([a, b])).toMatchObject({
      truePositives: 4,
      falsePositives: 1,
      falseNegatives: 2,
      precision: 0.8,
      recall: 4 / 6,
    });
  });

  it("is vacuously perfect with nothing to count", () => {
    expect(aggregate([])).toMatchObject({ precision: 1, recall: 1 });
  });
});
