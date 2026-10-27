import type { LandmarkName } from "@fitpilot/exercise-contracts";
import type { Landmark } from "./geometry";

export type LandmarkFrame = Partial<Record<LandmarkName, Landmark>>;

export interface TrackingQuality {
  reliable: boolean;
  /** min visibility across required landmarks, 0 if any missing */
  confidence: number;
  missing: LandmarkName[];
}

/**
 * Principle 3 / FR-04: when tracking is unreliable the system must say so rather than analyse.
 * Thresholds are starting points; calibrate against annotated fixtures (blueprint §14).
 */
export function assessTracking(
  frame: LandmarkFrame,
  required: readonly LandmarkName[],
  minVisibility = 0.6,
): TrackingQuality {
  const missing: LandmarkName[] = [];
  let confidence = 1;
  for (const name of required) {
    const lm = frame[name];
    if (!lm || lm.visibility < minVisibility) missing.push(name);
    confidence = Math.min(confidence, lm?.visibility ?? 0);
  }
  return { reliable: missing.length === 0, confidence, missing };
}
