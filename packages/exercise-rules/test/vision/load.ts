import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ClipLabels, LandmarkFixture, VisionGate } from "@fitpilot/exercise-contracts";

export const VISION_FIXTURES = join(
  import.meta.dirname,
  "../../../../data/evaluation-fixtures/vision",
);

export interface ExerciseFixtures {
  exerciseId: string;
  gate: VisionGate;
  clips: { landmarks: LandmarkFixture; labels: ClipLabels }[];
}

function parse<T>(schema: { parse(v: unknown): T }, file: string): T {
  try {
    return schema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Loads one exercise's fixtures. Throws (never skips) on a malformed file, a landmarks file
 * without labels or vice versa, or ids that disagree with the file/folder names.
 */
export function loadExerciseFixtures(dir: string, exerciseId: string): ExerciseFixtures {
  const files = readdirSync(dir);
  const gate = parse(VisionGate, join(dir, "gate.json"));
  const ids = (suffix: string) =>
    files.filter((f) => f.endsWith(suffix)).map((f) => f.slice(0, -suffix.length));
  const stray = files.filter(
    (f) =>
      f.endsWith(".json") &&
      f !== "gate.json" &&
      !f.endsWith(".landmarks.json") &&
      !f.endsWith(".labels.json"),
  );
  if (stray.length) throw new Error(`${dir}: unexpected file(s) ${stray.join(", ")}`);
  const landmarkIds = ids(".landmarks.json");
  const labelIds = new Set(ids(".labels.json"));
  for (const id of labelIds) {
    if (!landmarkIds.includes(id))
      throw new Error(`${dir}: ${id}.labels.json has no landmarks file`);
  }
  const clips = landmarkIds.map((id) => {
    if (!labelIds.has(id)) throw new Error(`${dir}: ${id}.landmarks.json has no labels file`);
    const landmarks = parse(LandmarkFixture, join(dir, `${id}.landmarks.json`));
    const labels = parse(ClipLabels, join(dir, `${id}.labels.json`));
    for (const f of [landmarks, labels]) {
      if (f.clip_id !== id || f.exercise_id !== exerciseId) {
        throw new Error(`${dir}/${id}: clip_id/exercise_id must match the file and folder names`);
      }
    }
    return { landmarks, labels };
  });
  return { exerciseId, gate, clips };
}

export function exerciseDirs(): string[] {
  return readdirSync(VISION_FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
