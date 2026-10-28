import type { ExerciseAnimation } from "@fitpilot/exercise-contracts";
import type { ViewerFailure } from "./playback";

/** A load failure the viewer can explain to the user (FR-03: handle missing/incompatible assets). */
export class ViewerError extends Error {
  constructor(
    readonly reason: ViewerFailure,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = "ViewerError";
  }
}

/** Same tolerance as `assets:check` (ADR-0009). */
export const DURATION_TOLERANCE_S = 0.05;

/**
 * Checks a parsed GLB against the catalogue's animation contract. Returns the reason it cannot
 * drive the demo, or null when it is usable.
 */
export function incompatibility(
  model: { clips: { name: string; duration: number }[]; skinned: boolean },
  animation: ExerciseAnimation,
): string | null {
  if (!model.skinned) return "the model has no rigged mesh";
  const clip = model.clips.find((c) => c.name === animation.clip);
  if (!clip) return `clip "${animation.clip}" is missing`;
  if (Math.abs(clip.duration - animation.duration_s) > DURATION_TOLERANCE_S) {
    return `clip lasts ${clip.duration.toFixed(2)} s but the exercise expects ${animation.duration_s} s`;
  }
  return null;
}

export const assetUrl = (exerciseId: string, animation: ExerciseAnimation) =>
  `/exercises/${exerciseId}/${animation.asset}`;
