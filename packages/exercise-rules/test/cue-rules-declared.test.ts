import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CUE_RULES } from "@fitpilot/exercise-contracts";
import { describe, expect, it } from "vitest";

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
