import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregate,
  type ClipEvaluation,
  evaluateClip,
  type RepCounter,
  SquatAnalyzer,
} from "../../src";
import { exerciseDirs, loadExerciseFixtures, VISION_FIXTURES } from "./load";

/**
 * FR-05 acceptance: rep counting is evaluated against annotated recordings, not assumed correct.
 * Every exercise folder under data/evaluation-fixtures/vision must have a registered analyzer
 * and a gate.json; its clips must meet the gate.
 */
const ANALYZERS: Record<string, () => RepCounter> = {
  bodyweight_squat: () => new SquatAnalyzer(),
};

function report(title: string, evals: ClipEvaluation[]) {
  console.log(title);
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
  console.log(aggregate(evals));
}

describe.each(exerciseDirs())("vision regression: %s", (exerciseId) => {
  const { gate, clips } = loadExerciseFixtures(join(VISION_FIXTURES, exerciseId), exerciseId);
  const make = ANALYZERS[exerciseId];

  it("has a registered analyzer", () => expect(make).toBeDefined());

  it(`has ≥ ${gate.min_recorded_clips} recorded (non-synthetic) clips`, () => {
    const recorded = clips.filter((c) => c.landmarks.source.kind === "recording").length;
    expect(recorded).toBeGreaterThanOrEqual(gate.min_recorded_clips);
  });

  const gated = clips.filter((c) => c.landmarks.source.model === gate.runtime_model);
  const compared = clips.filter((c) => c.landmarks.source.model !== gate.runtime_model);
  const run = (set: typeof clips) =>
    set.map((c) => evaluateClip(make!(), c.landmarks, c.labels, gate.match_tolerance_ms));

  it("has fixtures from the runtime model, so the gate can't be skipped", () => {
    expect(gated.length).toBeGreaterThan(0);
  });

  it.runIf(make && gated.length > 0)(
    `meets the gate on ${gate.runtime_model} and never counts in untrackable spans`,
    () => {
      const evals = run(gated);
      report(`${exerciseId} · ${gate.runtime_model} (gated)`, evals);
      const summary = aggregate(evals);
      // no vacuous pass: precision/recall are 1 when nothing is labelled (replay.ts)
      expect(summary.truePositives + summary.falseNegatives).toBeGreaterThan(0);
      expect(summary.repsInUntrackable).toBe(0);
      expect(summary.precision).toBeGreaterThanOrEqual(gate.min_precision);
      expect(summary.recall).toBeGreaterThanOrEqual(gate.min_recall);
    },
  );

  it.runIf(make && compared.length > 0)("reports other models for comparison (not gated)", () => {
    report(`${exerciseId} · other models (report only)`, run(compared));
  });
});
