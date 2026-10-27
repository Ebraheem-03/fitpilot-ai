import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExerciseContract } from "../src";

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
