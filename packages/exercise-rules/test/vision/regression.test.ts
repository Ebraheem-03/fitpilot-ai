import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregate,
  aggregateCues,
  type ClipEvaluation,
  CueSelector,
  type CueRule,
  decodeFrames,
  evaluateClip,
  explainCue,
  isTraceable,
  type RepCounter,
  RULES_BY_EXERCISE,
  SQUAT_RULESET,
  SquatAnalyzer,
} from "../../src";
import { exerciseDirs, loadExerciseFixtures, VISION_FIXTURES } from "./load";

/**
 * FR-05/FR-06 acceptance: rep counting and feedback cues are evaluated against annotated
 * recordings, not assumed correct. Every exercise folder under data/evaluation-fixtures/vision
 * must have a registered analyzer, declared rules and a gate.json; its clips must meet the gate.
 */
const ANALYZERS: Record<string, () => RepCounter> = {
  bodyweight_squat: () => new SquatAnalyzer(),
};
const CATALOG = join(VISION_FIXTURES, "../../exercise-catalog");

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
      cues: e.cuesEmitted.map((c) => c.cue.rule_id).join(" ") || "-",
    })),
  );
  console.log(aggregate(evals));
}

describe.each(exerciseDirs())("vision regression: %s", (exerciseId) => {
  const { gate, clips } = loadExerciseFixtures(join(VISION_FIXTURES, exerciseId), exerciseId);
  const make = ANALYZERS[exerciseId];
  const rules: readonly CueRule[] = RULES_BY_EXERCISE[exerciseId] ?? [];

  it("has a registered analyzer", () => expect(make).toBeDefined());

  it(`has ≥ ${gate.min_recorded_clips} recorded (non-synthetic) clips`, () => {
    // distinct videos, counted once: the same clip extracted with two models is one recording
    const recorded = clips.filter(
      (c) =>
        c.landmarks.source.kind === "recording" && c.landmarks.source.model === gate.runtime_model,
    ).length;
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
    `counts reps on supported clips (${gate.runtime_model}) and never in untrackable spans`,
    () => {
      const evals = run(gated.filter((c) => c.labels.supported));
      report(`${exerciseId} · ${gate.runtime_model} · supported (counting gate)`, evals);
      const summary = aggregate(evals);
      // no vacuous pass: precision/recall are 1 when nothing is labelled (replay.ts)
      expect(summary.truePositives + summary.falseNegatives).toBeGreaterThan(0);
      expect(summary.repsInUntrackable).toBe(0);
      expect(summary.precision).toBeGreaterThanOrEqual(gate.min_precision);
      expect(summary.recall).toBeGreaterThanOrEqual(gate.min_recall);
    },
  );

  it.runIf(make && gated.length > 0)(
    `refuses to count on unsupported setups (≥ ${gate.min_refusal_rate * 100}% of clips count nothing)`,
    () => {
      const evals = run(gated.filter((c) => !c.labels.supported));
      report(`${exerciseId} · ${gate.runtime_model} · unsupported (refusal gate)`, evals);
      expect(evals.length).toBeGreaterThan(0);
      const refused = evals.filter((e) => e.counted === 0).length / evals.length;
      console.log(`refusal rate ${(refused * 100).toFixed(0)}% (${evals.length} clips)`);
      expect(refused).toBeGreaterThanOrEqual(gate.min_refusal_rate);
    },
  );

  describe("cues (FR-06)", () => {
    it("declares its feedback rules", () => expect(rules.length).toBeGreaterThan(0));

    it.runIf(make && gated.length > 0)(
      "emits no cue inside an untrackable span or on an unsupported setup",
      () => {
        // no vacuous pass: there must be untrackable spans and unsupported clips to test against
        expect(gated.some((c) => c.labels.untrackable_ranges_ms.length > 0)).toBe(true);
        expect(gated.some((c) => !c.labels.supported)).toBe(true);
        const s = aggregateCues(run(gated));
        expect(s.inUntrackable).toBe(0);
        expect(s.onUnsupported).toBe(0);
      },
    );

    it.runIf(make && gated.length > 0)(
      `keeps the cue false-positive rate ≤ ${gate.cues.max_false_positive_rate} on ≥ ${gate.cues.min_judged_negatives} judged reps`,
      () => {
        const evals = run(gated.filter((c) => c.labels.supported));
        const s = aggregateCues(evals);
        console.log(`${exerciseId} · ${gate.runtime_model} · cue gate`);
        console.table(
          Object.entries(s.byRule).map(([rule, t]) => ({
            rule,
            negatives: t.judgedNegatives,
            fp: t.falsePositives,
            stray: t.stray,
            "fp rate": t.falsePositiveRate,
            tp: t.truePositives,
            fn: t.falseNegatives,
            recall: t.recall ?? "n/a (no positive labels)",
          })),
        );
        expect(s.judgedNegatives).toBeGreaterThanOrEqual(gate.cues.min_judged_negatives);
        // every declared rule has been judged somewhere: none ships unevaluated
        for (const rule of rules) {
          expect(s.byRule[rule.rule_id]?.judgedNegatives ?? 0, rule.rule_id).toBeGreaterThan(0);
        }
        expect(s.falsePositiveRate).toBeLessThanOrEqual(gate.cues.max_false_positive_rate);
      },
    );

    it.runIf(make)(
      "every emitted cue is traceable: declared rule, current ruleset, its measurements, explained",
      () => {
        const catalog = JSON.parse(readFileSync(join(CATALOG, `${exerciseId}.json`), "utf8"));
        // every clip and both models: the full model does emit cues here (report-only set)
        for (const e of run(clips)) {
          for (const { cue } of e.cuesEmitted) {
            const rule = rules.find((r) => r.rule_id === cue.rule_id);
            expect(rule, `${e.clip_id}: undeclared rule ${cue.rule_id}`).toBeDefined();
            expect(isTraceable(cue)).toBe(true);
            expect(cue.ruleset_version).toBe(catalog.ruleset_version);
            expect(cue.message_id).toBe(rule!.message_id);
            expect(Object.keys(cue.measurements).sort()).toEqual(
              Object.keys(rule!.measurements).sort(),
            );
            expect(explainCue(cue.message_id)).toBeDefined();
          }
        }
      },
    );

    it.runIf(make && gated.length > 0)(
      "never shows a cue on a frame the analyzer judged unreliable (analyzer + selector replay)",
      () => {
        let reliableFrames = 0;
        let unreliableFrames = 0;
        for (const c of gated) {
          const analyzer = make!();
          const selector = new CueSelector();
          for (const { tMs, frame } of decodeFrames(c.landmarks)) {
            const r = analyzer.step(frame, tMs);
            const d = selector.step(r, tMs);
            if (r.tracking.reliable) reliableFrames += 1;
            else {
              unreliableFrames += 1;
              expect(d.active, `${c.labels.clip_id} @ ${tMs}`).toBeNull();
            }
          }
        }
        expect(reliableFrames).toBeGreaterThan(0);
        expect(unreliableFrames).toBeGreaterThan(0);
      },
    );
  });

  it.runIf(exerciseId === "bodyweight_squat" && gated.length > 0)(
    "would fail an over-eager ruleset (the cue gate has teeth)",
    () => {
      // a cue on every rep: "sit deeper" at any depth, "chest up" at any forward lean
      const eager = { ...SQUAT_RULESET, shallowDepthKneeAngle: 0, maxTrunkLeanDeg: 0 };
      const evals = gated
        .filter((c) => c.labels.supported)
        .map((c) =>
          evaluateClip(new SquatAnalyzer(eager), c.landmarks, c.labels, gate.match_tolerance_ms),
        );
      expect(aggregateCues(evals).falsePositiveRate).toBeGreaterThan(
        gate.cues.max_false_positive_rate,
      );
    },
  );

  it.runIf(make && compared.length > 0)("reports other models for comparison (not gated)", () => {
    const evals = run(compared);
    report(`${exerciseId} · other models (report only)`, evals);
    const s = aggregateCues(evals.filter((e) => e.supported));
    console.log("cue gate (report only):", { ...s, byRule: undefined }, s.byRule);
  });
});
