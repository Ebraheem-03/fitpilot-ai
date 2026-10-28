import type { Pose } from "../pose.ts";

export interface PhaseSpan {
  id: string;
  start_s: number;
  end_s: number;
}

/** An authored exercise clip: a pose as a function of a 0–1 progress value, over a timeline. */
export interface ClipDefinition {
  name: string;
  duration_s: number;
  phases: PhaseSpan[];
  depthAt(t: number): number;
  pose(depth: number): Pose;
}
