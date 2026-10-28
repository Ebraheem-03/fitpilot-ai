import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CUE_RULES } from "@fitpilot/exercise-contracts";
import { describe, expect, it } from "vitest";
import { RULES_BY_EXERCISE } from "../src";

const exercisesDir = join(__dirname, "../src/exercises");

/**
 * Cues are only valid session events when their rule is declared in the contract's CUE_RULES
 * (ADR-0011). This catches a new rule that was added to an analyzer but not to the contract.
 */
describe("every rule id in the analyzers is declared in the contract", () => {
  const sources = readdirSync(exercisesDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => [f, readFileSync(join(exercisesDir, f), "utf8")] as const);

  it.each(sources)("%s", (_file, source) => {
    const ids = [...source.matchAll(/rule_id:\s*"([^"]+)"/g)].map((m) => m[1]!);
    for (const id of ids) expect(Object.keys(CUE_RULES), id).toContain(id);
  });

  it("finds the squat rule (the scan is not vacuous)", () => {
    const squat = sources.find(([f]) => f === "squat.ts")![1];
    expect(squat).toContain('rule_id: "squat.depth.shallow"');
  });
});

/**
 * The rule definitions (message, explanation, measurement labels) and the contract's declaration
 * (exercise + measurement keys) describe the same rules: same ids, same exercise, same keys.
 */
describe("rule definitions match the contract's CUE_RULES exactly", () => {
  const defined = Object.entries(RULES_BY_EXERCISE).flatMap(([exerciseId, rules]) =>
    rules.map((r) => [r.rule_id, exerciseId, Object.keys(r.measurements).sort()] as const),
  );

  it.each(defined)("%s (%s)", (ruleId, exerciseId, keys) => {
    expect(CUE_RULES[ruleId], `${ruleId} missing from the contract`).toBeDefined();
    expect(CUE_RULES[ruleId]!.exercise_id).toBe(exerciseId);
    expect([...CUE_RULES[ruleId]!.measurements].sort()).toEqual(keys);
  });

  it("declares no contract rule that no analyzer defines", () => {
    expect(Object.keys(CUE_RULES).sort()).toEqual(defined.map(([id]) => id).sort());
  });
});
