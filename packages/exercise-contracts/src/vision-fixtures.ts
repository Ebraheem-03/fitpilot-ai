import { z } from "zod";
import { LANDMARK_NAMES } from "./landmarks";

/**
 * Vision regression fixtures (FR-05, blueprint §14), stored in
 * data/evaluation-fixtures/vision/<exercise_id>/<clip_id>.{landmarks,labels}.json.
 * Derived numbers only: no video, no images, no identity (principle 5). TS-only — the API never
 * reads these, so there is no JSON Schema export.
 */

export const FIXTURE_FORMAT_VERSION = 1;
const ClipId = z.string().regex(/^[a-z0-9_]+$/);
const Ms = z.number().int().nonnegative();
const Range = z.tuple([Ms, Ms]).refine(([a, b]) => b > a, "range end must be after start");

/** Values per landmark in `frames[].p`: x, y (image-normalised), z, visibility. */
export const FIXTURE_LANDMARK_STRIDE = 4;

export const LandmarkFixture = z
  .object({
    format_version: z.literal(FIXTURE_FORMAT_VERSION),
    clip_id: ClipId,
    exercise_id: z.string(),
    source: z.object({
      /** "recording": a consenting person on camera; "synthetic": the generated mannequin */
      kind: z.enum(["recording", "synthetic"]),
      model: z.enum(["pose_landmarker_lite", "pose_landmarker_full"]),
      tasks_vision_version: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fps: z.number().positive(),
    }),
    /** order of the landmarks packed into each frame's `p` */
    landmark_names: z.array(z.enum(LANDMARK_NAMES)).min(1),
    frames: z
      .array(
        z.object({
          t_ms: Ms,
          /** landmark_names.length × 4 numbers, or null when no person was detected */
          p: z.array(z.number()).nullable(),
        }),
      )
      .min(1),
  })
  .superRefine((f, ctx) => {
    const width = f.landmark_names.length * FIXTURE_LANDMARK_STRIDE;
    let prev = -1;
    f.frames.forEach((frame, i) => {
      if (frame.t_ms <= prev) {
        ctx.addIssue({
          code: "custom",
          path: ["frames", i, "t_ms"],
          message: "t_ms must increase",
        });
      }
      prev = frame.t_ms;
      if (frame.p && frame.p.length !== width) {
        ctx.addIssue({
          code: "custom",
          path: ["frames", i, "p"],
          message: `expected ${width} numbers, got ${frame.p.length}`,
        });
      }
    });
  });
export type LandmarkFixture = z.infer<typeof LandmarkFixture>;

export const RepLabel = z
  .object({
    start_ms: Ms,
    bottom_ms: Ms,
    end_ms: Ms,
    full_depth: z.boolean(),
  })
  .refine((r) => r.start_ms < r.bottom_ms && r.bottom_ms < r.end_ms, "start < bottom < end");

export const ClipLabels = z
  .object({
    format_version: z.literal(FIXTURE_FORMAT_VERSION),
    clip_id: ClipId,
    exercise_id: z.string(),
    camera_view: z.enum(["front", "side", "three_quarter"]),
    /** which way the person faces in the image (side view) */
    facing: z.enum(["left", "right", "camera", "away"]).optional(),
    /**
     * false when the setup is outside what the exercise supports (e.g. front view for the squat):
     * the analyzer must withhold — every counted rep is a false positive.
     */
    supported: z.boolean(),
    conditions: z.object({
      lighting: z.enum(["normal", "dim", "backlit"]),
      clothing: z.enum(["fitted", "loose"]),
      distance_m: z.number().positive().optional(),
      notes: z.string().max(200).optional(),
    }),
    reps: z.array(RepLabel),
    /** spans where the person is out of frame/occluded; counting a rep inside one is an error */
    untrackable_ranges_ms: z.array(Range),
    /** initials or a role ("owner"), never a full name */
    annotated_by: z.string().max(40),
  })
  .superRefine((l, ctx) => {
    for (let i = 1; i < l.reps.length; i++) {
      if (l.reps[i]!.start_ms < l.reps[i - 1]!.end_ms) {
        ctx.addIssue({ code: "custom", path: ["reps", i], message: "reps overlap" });
      }
    }
  });
export type ClipLabels = z.infer<typeof ClipLabels>;

/** Per-exercise acceptance gate, versioned next to the fixtures (data/…/<exercise>/gate.json). */
export const VisionGate = z.object({
  min_precision: z.number().min(0).max(1),
  min_recall: z.number().min(0).max(1),
  /** a counted rep matches a label if it completes within [start − tol, end + tol] */
  match_tolerance_ms: Ms,
  /** recorded (non-synthetic) clips required before the gate counts as evidence */
  min_recorded_clips: z.number().int().nonnegative(),
});
export type VisionGate = z.infer<typeof VisionGate>;
