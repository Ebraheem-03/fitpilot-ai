import { z } from "zod";
import { LANDMARK_NAMES } from "./landmarks";

export const CameraView = z.enum(["side", "front", "front_45"]);

/** Mirrors the API's `Equipment` (services/api/app/schemas/profile.py); a parity test guards it. */
export const EQUIPMENT = [
  "dumbbells",
  "kettlebell",
  "resistance_band",
  "pull_up_bar",
  "bench",
  "barbell",
  "mat",
] as const;
export const Equipment = z.enum(EQUIPMENT);

/** Capabilities that need the camera analysis (vision) pipeline. */
export const TRACKED_CAPABILITIES = [
  "pose_tracking",
  "rep_counting",
  "phase_detection",
  "rule_based_feedback",
] as const;

/** `demo_3d` = the exercise has a 3D demonstration (`animation`). */
export const Capability = z.enum([...TRACKED_CAPABILITIES, "demo_3d"]);

/** How the exercise is prescribed and logged: counted repetitions or a timed hold. */
export const Prescription = z.enum(["reps", "duration"]);

const isTrackedCapability = (c: string) => (TRACKED_CAPABILITIES as readonly string[]).includes(c);

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
    equipment: z.array(Equipment),
    target_muscles: z.array(z.string()).default([]),
    prescription: Prescription,
    /** required iff the exercise has a tracked capability */
    camera_views: z.array(CameraView).default([]),
    /** required iff `supported_capabilities` includes `demo_3d` (and only then) */
    animation: ExerciseAnimation.nullable().default(null),
    supported_capabilities: z.array(Capability).default([]),
    /** required iff the exercise has a tracked capability */
    required_landmarks: z.array(z.enum(LANDMARK_NAMES)).default([]),
    /** required iff the exercise has a tracked capability */
    ruleset_version: z.number().int().positive().nullable().default(null),
    phases: z.array(z.string()).min(2),
    instructions: z.array(z.string()).min(1),
    technique_considerations: z.array(z.string()).default([]),
  })
  .superRefine((exercise, ctx) => {
    const { animation, phases, instructions, supported_capabilities: capabilities } = exercise;
    const fail = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message, path });

    const demo = capabilities.includes("demo_3d");
    if (demo && !animation) fail("animation is required when demo_3d is supported", ["animation"]);
    if (!demo && animation) fail("animation requires the demo_3d capability", ["animation"]);

    if (capabilities.some(isTrackedCapability)) {
      const why = "is required for a tracked exercise";
      if (exercise.camera_views.length === 0) fail(`camera_views ${why}`, ["camera_views"]);
      if (exercise.required_landmarks.length === 0) {
        fail(`required_landmarks ${why}`, ["required_landmarks"]);
      }
      if (exercise.ruleset_version === null) fail(`ruleset_version ${why}`, ["ruleset_version"]);
    }
    if (!animation) return;
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
export type Equipment = z.infer<typeof Equipment>;
export type Capability = z.infer<typeof Capability>;
export type Prescription = z.infer<typeof Prescription>;

/** An exercise with a 3D demonstration (`demo_3d`): `animation` is guaranteed present. */
export type ExerciseWithDemo = ExerciseContract & { animation: ExerciseAnimation };

export const hasDemo = (exercise: ExerciseContract): exercise is ExerciseWithDemo =>
  exercise.animation !== null;

/** True when the exercise runs the camera analysis pipeline. */
export const isTracked = (exercise: Pick<ExerciseContract, "supported_capabilities">): boolean =>
  exercise.supported_capabilities.some(isTrackedCapability);
