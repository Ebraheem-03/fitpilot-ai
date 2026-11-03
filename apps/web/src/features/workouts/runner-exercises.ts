import type { ExerciseContract, PlannedExercise } from "@fitpilot/exercise-contracts";
import { canTrackLive } from "../exercise-library/ExerciseGuide";
import type { RunnerExercise } from "./WorkoutRunner";

/**
 * Joins a plan day with the exercise catalogue. The catalogue is the source of truth (rule 2):
 * a planned exercise it no longer has is reported in `missing` and gets no runner entry, so the
 * page can say so instead of guessing a prescription or letting it be logged.
 */
export function resolveRunnerExercises(
  planned: readonly PlannedExercise[],
  catalogue: readonly ExerciseContract[],
): { exercises: RunnerExercise[]; missing: string[] } {
  const byId = new Map(catalogue.map((e) => [e.id, e]));
  const exercises: RunnerExercise[] = [];
  const missing: string[] = [];
  for (const p of planned) {
    const e = byId.get(p.exercise_id);
    if (!e) {
      missing.push(p.exercise_id);
      continue;
    }
    exercises.push({
      id: e.id,
      name: e.name,
      hasDemo: e.animation != null,
      tracked: canTrackLive(e),
      prescription: e.prescription,
      instructions: e.instructions,
      required_landmarks: e.required_landmarks,
      planned: p,
    });
  }
  return { exercises, missing };
}
