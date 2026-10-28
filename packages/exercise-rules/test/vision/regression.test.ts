import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aggregate, evaluateClip, type RepCounter, SquatAnalyzer } from "../../src";
import { exerciseDirs, loadExerciseFixtures, VISION_FIXTURES } from "./load";

/**
 * FR-05 acceptance: rep counting is evaluated against annotated recordings, not assumed correct.
 * Every exercise folder under data/evaluation-fixtures/vision must have a registered analyzer
 * and a gate.json; its clips must meet the gate.
 */
const ANALYZERS: Record<string, () => RepCounter> = {
  bodyweight_squat: () => new SquatAnalyzer(),
};

describe.each(exerciseDirs())("vision regression: %s", (exerciseId) => {
  const { gate, clips } = loadExerciseFixtures(join(VISION_FIXTURES, exerciseId), exerciseId);
  const make = ANALYZERS[exerciseId];

  it("has a registered analyzer", () => expect(make).toBeDefined());

  it(`has ≥ ${gate.min_recorded_clips} recorded (non-synthetic) clips`, () => {
    const recorded = clips.filter((c) => c.landmarks.source.kind === "recording").length;
    expect(recorded).toBeGreaterThanOrEqual(gate.min_recorded_clips);
  });

  it.runIf(make && clips.length > 0)("meets the gate and never counts in untrackable spans", () => {
    const evals = clips.map((c) =>
      evaluateClip(make!(), c.landmarks, c.labels, gate.match_tolerance_ms),
    );
    const summary = aggregate(evals);
    console.table(
      evals.map((e) => ({
        clip: e.clip_id,
        labelled: e.labelled,
        counted: e.counted,
        tp: e.truePositives,
        fp: e.falsePositives,
        fn: e.falseNegatives,
        untrackable: e.repsInUntrackable,
        unreliable: `${Math.round(e.unreliableFrameRatio * 100)}%`,
      })),
    );
    console.log(`${exerciseId}:`, summary);
    expect(summary.repsInUntrackable).toBe(0);
    expect(summary.precision).toBeGreaterThanOrEqual(gate.min_precision);
    expect(summary.recall).toBeGreaterThanOrEqual(gate.min_recall);
  });
});
