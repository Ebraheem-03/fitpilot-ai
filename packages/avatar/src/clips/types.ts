import type { Pose } from "../pose";

/**
 * How an exercise moves, independent of timing. The catalogue's `animation.phases` decides
 * when each phase happens; `phaseDepth` says where the movement is at the start and end of each
 * phase (0 = start position, 1 = end of range), eased in between.
 */
export interface MotionDefinition {
  pose(depth: number): Pose;
  phaseDepth: Record<string, readonly [from: number, to: number]>;
}

/** A motion bound to one catalogue timeline, ready to be sampled into a glTF animation. */
export interface ClipDefinition {
  name: string;
  duration_s: number;
  depthAt(t: number): number;
  pose(depth: number): Pose;
}
