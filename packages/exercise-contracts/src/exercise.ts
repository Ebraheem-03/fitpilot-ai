import { z } from "zod";
import { LANDMARK_NAMES } from "./landmarks";

export const CameraView = z.enum(["side", "front", "front_45"]);

export const Capability = z.enum([
  "pose_tracking",
  "rep_counting",
  "phase_detection",
  "rule_based_feedback",
]);

/** One span of the demonstration clip; spans tile the clip with no gaps or overlaps (FR-03). */
export const AnimationPhase = z.object({
  phase: z.string().min(1),
  start_s: z.number().nonnegative(),
  end_s: z.number().positive(),
  /** indices into `instructions` shown while this phase plays */
  instruction_indices: z.array(z.number().int().nonnegative()),
});

/** The 3D demonstration (ADR-0009). `asset` is served from `/exercises/<id>/<asset>`. */
export const ExerciseAnimation = z.object({
  asset: z.string().regex(/^[a-z0-9_-]+\.glb$/),
  clip: z.string().min(1),
  duration_s: z.number().positive(),
  phases: z.array(AnimationPhase).min(1),
});

/** Timeline boundaries match when they are within this many seconds (float JSON round-trips). */
const TIME_EPSILON = 1e-6;

/** Blueprint §13 exercise contract. The exercise catalogue is the source of truth (principle 2). */
export const ExerciseContract = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
    version: z.number().int().positive(),
    equipment: z.array(z.string()),
    target_muscles: z.array(z.string()).default([]),
    camera_views: z.array(CameraView).min(1),
    animation: ExerciseAnimation,
    supported_capabilities: z.array(Capability).min(1),
    required_landmarks: z.array(z.enum(LANDMARK_NAMES)).min(1),
    ruleset_version: z.number().int().positive(),
    phases: z.array(z.string()).min(2),
    instructions: z.array(z.string()).min(1),
    technique_considerations: z.array(z.string()).default([]),
  })
  .superRefine((exercise, ctx) => {
    const { animation, phases, instructions } = exercise;
    const fail = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message, path });
    const timeline = animation.phases;
    const near = (a: number, b: number) => Math.abs(a - b) <= TIME_EPSILON;

    if (!near(timeline[0]?.start_s ?? 0, 0)) {
      fail("animation.phases must start at 0", ["animation", "phases", 0, "start_s"]);
    }
    timeline.forEach((span, i) => {
      if (span.end_s <= span.start_s) {
        fail(`animation.phases[${i}] must have end_s > start_s`, ["animation", "phases", i]);
      }
      const prev = timeline[i - 1];
      if (prev && !near(span.start_s, prev.end_s)) {
        fail(`animation.phases[${i}] must start where phases[${i - 1}] ends`, [
          "animation",
          "phases",
          i,
          "start_s",
        ]);
      }
      if (!phases.includes(span.phase)) {
        fail(`animation.phases[${i}].phase "${span.phase}" is not in phases`, [
          "animation",
          "phases",
          i,
          "phase",
        ]);
      }
      span.instruction_indices.forEach((index, j) => {
        if (index >= instructions.length) {
          fail(`animation.phases[${i}].instruction_indices[${j}] is out of range`, [
            "animation",
            "phases",
            i,
            "instruction_indices",
            j,
          ]);
        }
      });
    });
    if (!near(timeline.at(-1)?.end_s ?? 0, animation.duration_s)) {
      fail("animation.phases must end at duration_s", ["animation", "duration_s"]);
    }
    for (const phase of phases) {
      if (!timeline.some((span) => span.phase === phase)) {
        fail(`phase "${phase}" never appears in animation.phases`, ["phases"]);
      }
    }
  });

export type ExerciseAnimation = z.infer<typeof ExerciseAnimation>;
export type AnimationPhase = z.infer<typeof AnimationPhase>;
export type ExerciseContract = z.infer<typeof ExerciseContract>;
export type CameraView = z.infer<typeof CameraView>;
