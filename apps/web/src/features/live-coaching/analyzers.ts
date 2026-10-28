import { SquatAnalyzer } from "@fitpilot/exercise-rules";
import type { Analyzer } from "./engine/engine";

/** Exercises with live tracking. Curl and push-up arrive in M4 (FR-05). */
const ANALYZERS: Record<string, () => Analyzer> = {
  bodyweight_squat: () => new SquatAnalyzer(),
};

export const analyzerFor = (exerciseId: string): (() => Analyzer) | undefined =>
  ANALYZERS[exerciseId];
