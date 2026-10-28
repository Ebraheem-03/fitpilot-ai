import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CUE_RULES, ExerciseContract, isTracked } from "../src";

const catalogDir = join(__dirname, "../../../data/exercise-catalog");

describe("exercise catalogue", () => {
  const files = readdirSync(catalogDir).filter((f) => f.endsWith(".json"));

  it("is not empty", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s satisfies the ExerciseContract", (file) => {
    const raw = JSON.parse(readFileSync(join(catalogDir, file), "utf8"));
    const parsed = ExerciseContract.safeParse(raw);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(file).toBe(`${raw.id}.json`);
  });
});

describe("exercise catalogue content", () => {
  const catalogue = readdirSync(catalogDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ExerciseContract.parse(JSON.parse(readFileSync(join(catalogDir, f), "utf8"))));
  const byId = (id: string) => catalogue.find((e) => e.id === id);

  it("contains the starter set", () => {
    for (const id of [
      "bodyweight_squat",
      "dumbbell_biceps_curl",
      "push_up",
      "glute_bridge",
      "plank",
      "reverse_lunge",
      "dumbbell_row",
    ]) {
      expect(byId(id), id).toBeDefined();
    }
  });

  it("prescribes the plank by duration and everything else we ship by reps", () => {
    expect(byId("plank")?.prescription).toBe("duration");
    expect(catalogue.filter((e) => e.id !== "plank").every((e) => e.prescription === "reps")).toBe(
      true,
    );
  });

  it("only the squat has a demo and tracking so far", () => {
    expect(catalogue.filter((e) => isTracked(e)).map((e) => e.id)).toEqual(["bodyweight_squat"]);
    expect(catalogue.filter((e) => e.animation).map((e) => e.id)).toEqual(["bodyweight_squat"]);
  });

  it("every declared cue rule belongs to a tracked catalogue exercise", () => {
    for (const [ruleId, rule] of Object.entries(CUE_RULES)) {
      const exercise = byId(rule.exercise_id);
      expect(exercise && isTracked(exercise), ruleId).toBe(true);
    }
  });
});
