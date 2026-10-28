import type { ExerciseAnimation } from "@fitpilot/exercise-contracts";
import type { ClipDefinition, MotionDefinition } from "./clips/types";

const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** Depth at time t: eased from the phase's start depth to its end depth over the phase span. */
export function depthAt(
  timeline: ExerciseAnimation["phases"],
  phaseDepth: MotionDefinition["phaseDepth"],
  t: number,
): number {
  const span =
    timeline.find((s) => t >= s.start_s && t < s.end_s) ??
    (t < (timeline[0]?.start_s ?? 0) ? timeline[0] : timeline.at(-1));
  if (!span) throw new Error("empty timeline");
  const depth = phaseDepth[span.phase];
  if (!depth) throw new Error(`motion has no depth for phase "${span.phase}"`);
  const [from, to] = depth;
  const progress = Math.min(Math.max((t - span.start_s) / (span.end_s - span.start_s), 0), 1);
  return from + (to - from) * smoothstep(progress);
}

export function bindClip(animation: ExerciseAnimation, motion: MotionDefinition): ClipDefinition {
  for (const span of animation.phases) {
    if (!motion.phaseDepth[span.phase]) {
      throw new Error(`motion has no depth for phase "${span.phase}"`);
    }
  }
  return {
    name: animation.clip,
    duration_s: animation.duration_s,
    depthAt: (t) => depthAt(animation.phases, motion.phaseDepth, t),
    pose: motion.pose,
  };
}
