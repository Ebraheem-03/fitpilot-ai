import type { ClipLabels, LandmarkFixture } from "@fitpilot/exercise-contracts";
import { describe, expect, it } from "vitest";
import {
  aggregate,
  aggregateCues,
  decodeFrames,
  evaluateClip,
  type FeedbackCue,
  type RepCounter,
} from "../src";

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

const fakeCue = (rule_id: string): FeedbackCue => ({
  rule_id,
  ruleset_version: 1,
  message_id: `${rule_id}_v1`,
  message: "m",
  measurements: { v: 1 },
  priority: 1,
});

/**
 * Completes a rep on the first frame at or after each scripted time, emitting the rule ids in
 * `cuesAt[time]` on that frame. `cueOnly` times emit a cue without completing a rep.
 */
function scripted(
  times: number[],
  cuesAt: Record<number, string[]> = {},
  cueOnly: number[] = [],
): RepCounter {
  const queue = [...times];
  const strays = [...cueOnly];
  return {
    step(frame, tMs) {
      const reliable = Object.keys(frame).length > 0;
      const repCompleted = queue.length > 0 && tMs >= queue[0]!;
      const cues: FeedbackCue[] = [];
      if (repCompleted) cues.push(...(cuesAt[queue.shift()!] ?? []).map(fakeCue));
      if (strays.length > 0 && tMs >= strays[0]!) {
        strays.shift();
        cues.push(fakeCue("r.x"));
      }
      return { repCompleted, tracking: { reliable }, cues };
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

describe("cue scoring (M3 S2)", () => {
  // rule r.x: rep 0 warrants the cue, reps 1 and 2 don't
  const cueLabels = (over: Partial<ClipLabels> = {}) =>
    labels(REPS, {
      cue_labels: {
        rules: [
          { rule_id: "r.x", method: "by_eye", expected_reps: [0], not_expected_reps: [1, 2] },
        ],
      },
      ...over,
    });
  const score = (counter: RepCounter, l = cueLabels()) =>
    evaluateClip(counter, fixture(10), l, 300);

  it("scores a cue on an expected rep as a true positive and silence as a true negative", () => {
    const e = score(scripted([2900, 5900, 8900], { 2900: ["r.x"] }));
    expect(e.cueScores).toEqual([
      expect.objectContaining({
        rule_id: "r.x",
        method: "by_eye",
        expected: 1,
        judgedNegatives: 2,
        truePositives: 1,
        falsePositives: 0,
        falseNegatives: 0,
        stray: 0,
      }),
    ]);
  });

  it("scores a cue on a not-expected rep as a false positive, a missed one as a false negative", () => {
    const e = score(scripted([2900, 5900, 8900], { 5900: ["r.x"] }));
    expect(e.cueScores[0]).toMatchObject({
      truePositives: 0,
      falsePositives: 1,
      falseNegatives: 1,
    });
  });

  it("scores a cue outside every labelled rep as a stray false positive", () => {
    const e = score(scripted([2900, 5900, 8900], { 2900: ["r.x"] }, [3500]));
    expect(e.cueScores[0]).toMatchObject({ truePositives: 1, falsePositives: 1, stray: 1 });
  });

  it("scores a second cue of the same rule on one rep as a stray (one judgement per rep)", () => {
    const e = score(scripted([2900, 5900, 8900], { 2900: ["r.x", "r.x"] }));
    expect(e.cueScores[0]).toMatchObject({ truePositives: 1, falsePositives: 1, stray: 1 });
  });

  it("attributes a cue to the rep whose end it is nearest when tolerance windows overlap", () => {
    const close: [number, number][] = [
      [1000, 3000],
      [3200, 3600],
    ];
    const l = labels(close, {
      cue_labels: {
        rules: [{ rule_id: "r.x", method: "by_eye", expected_reps: [1], not_expected_reps: [0] }],
      },
    });
    // with ±600 ms, 3550 is inside both windows; it ends rep 1 (50 ms), not rep 0 (550 ms)
    const e = evaluateClip(scripted([3550], { 3550: ["r.x"] }), fixture(10), l, 600);
    expect(e.cueScores[0]).toMatchObject({ truePositives: 1, falsePositives: 0 });
  });

  it("doesn't score rules the clip doesn't annotate, or reps left unjudged", () => {
    const l = labels(REPS, {
      cue_labels: {
        rules: [{ rule_id: "r.x", method: "by_eye", expected_reps: [], not_expected_reps: [0] }],
      },
    });
    const e = evaluateClip(
      scripted([2900, 5900], { 2900: ["r.y"], 5900: ["r.x"] }),
      fixture(10),
      l,
      300,
    );
    expect(e.cueScores).toEqual([
      expect.objectContaining({
        rule_id: "r.x",
        judgedNegatives: 1,
        falsePositives: 0,
        unjudged: 1,
      }),
    ]);
    expect(e.cuesEmitted.map((c) => c.cue.rule_id)).toEqual(["r.y", "r.x"]);
  });

  it("counts cues inside untrackable spans", () => {
    const l = cueLabels({ untrackable_ranges_ms: [[5000, 6500]] });
    expect(score(scripted([2900, 5900], { 5900: ["r.x"] }), l).cuesInUntrackable).toBe(1);
  });

  it("aggregates: false-positive rate over chances to be wrong, cues on unsupported clips", () => {
    const good = score(scripted([2900, 5900, 8900], { 2900: ["r.x"] }));
    const wrong = score(scripted([2900, 5900, 8900], { 2900: ["r.x"], 8900: ["r.x"] }));
    const unsupported = evaluateClip(
      scripted([2900], { 2900: ["r.x"] }),
      fixture(10),
      labels(REPS, { supported: false, camera_view: "front" }),
      300,
    );
    const s = aggregateCues([good, wrong, unsupported]);
    expect(s).toMatchObject({
      emitted: 4,
      onUnsupported: 1,
      inUntrackable: 0,
      judgedNegatives: 4,
      truePositives: 2,
      falsePositives: 1,
      falseNegatives: 0,
      falsePositiveRate: 1 / 4,
      recall: 1,
    });
    expect(s.byRule["r.x"]).toMatchObject({ judgedNegatives: 4, falsePositives: 1 });
  });

  it("puts stray cues in the rate's denominator too, so it stays within [0, 1]", () => {
    // all four fall between the labelled reps' windows (REPS ± 300 ms)
    const e = score(scripted([], {}, [100, 3400, 6500, 9600]));
    expect(aggregateCues([e])).toMatchObject({ falsePositives: 4, falsePositiveRate: 4 / 6 });
  });

  it("reports recall as null when no rep warranted a cue (not a vacuous 1)", () => {
    const l = labels(REPS, {
      cue_labels: {
        rules: [{ rule_id: "r.x", method: "by_eye", expected_reps: [], not_expected_reps: [0] }],
      },
    });
    const e = evaluateClip(scripted([2900]), fixture(10), l, 300);
    expect(aggregateCues([e]).recall).toBeNull();
  });
});
