import type { ExerciseContract } from "@fitpilot/exercise-contracts";
import { canTrackLive } from "@/features/exercise-library/ExerciseGuide";
import type { ExerciseIndex, ExerciseInfo } from "@/features/plans/PlanView";

/**
 * Route-level glue: features don't import each other, so the pages that combine the catalogue,
 * the plan and the live-tracking build compose them here. "Tracked" needs the catalogue's say-so
 * AND an analyzer in this build (same rule as the exercise library).
 */
export function buildExerciseIndex(catalogue: ExerciseContract[]): ExerciseIndex {
  return new Map<string, ExerciseInfo>(
    catalogue.map((e) => [
      e.id,
      { id: e.id, name: e.name, hasDemo: e.animation !== null, tracked: canTrackLive(e) },
    ]),
  );
}
