import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExerciseContract, type ExerciseWithDemo, hasDemo } from "@fitpilot/exercise-contracts";
import { SQUAT_MOTION } from "./clips/squat";
import type { MotionDefinition } from "./clips/types";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CATALOG_DIR = join(REPO_ROOT, "data/exercise-catalog");
const PUBLIC_DIR = join(REPO_ROOT, "apps/web/public/exercises");

/** Every approved exercise with a 3D demo (`demo_3d`) needs a motion here, or `assets:check` fails (FR-03). */
export const MOTIONS: Record<string, MotionDefinition> = {
  bodyweight_squat: SQUAT_MOTION,
};

export function loadCatalog(dir = CATALOG_DIR): ExerciseWithDemo[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ExerciseContract.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))))
    .filter(hasDemo);
}

/** Where the web app serves an exercise's GLB from (`/exercises/<id>/<asset>`). */
export const assetPath = (exercise: ExerciseWithDemo) =>
  join(PUBLIC_DIR, exercise.id, exercise.animation.asset);
