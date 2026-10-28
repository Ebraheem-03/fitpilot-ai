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

/**
 * What a person expects one feedback rule to do on one clip (FR-05/FR-06: cues are tested against
 * annotated examples). Indices point into `reps`. A rep in neither list is unjudged for the rule;
 * a cue of the rule outside every labelled rep is always wrong (there was no squat to judge).
 */
export const CueRuleLabel = z.object({
  rule_id: z.string().regex(/^[a-z0-9_.]+$/),
  /**
   * How the judgement was made, so the gate's evidence is honest about its source:
   * - `by_eye`: a person judged the movement from the video or frame sheets;
   * - `from_rep_labels`: derived mechanically from a by-eye rep label (e.g. `full_depth`);
   * - `synthetic_ground_truth`: the generated mannequin, whose motion is known by construction.
   */
  method: z.enum(["by_eye", "from_rep_labels", "synthetic_ground_truth"]),
  /** reps on which the cue is warranted */
  expected_reps: z.array(z.number().int().nonnegative()),
  /** reps on which the cue would be wrong */
  not_expected_reps: z.array(z.number().int().nonnegative()),
  notes: z.string().max(300).optional(),
});
export type CueRuleLabel = z.infer<typeof CueRuleLabel>;

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
    /**
     * Optional cue annotations (M3 S2), per rule. Only on supported setups: on an unsupported one
     * no cue may appear at all, which the gate checks without annotations.
     */
    cue_labels: z.object({ rules: z.array(CueRuleLabel).min(1) }).optional(),
  })
  .superRefine((l, ctx) => {
    for (let i = 1; i < l.reps.length; i++) {
      if (l.reps[i]!.start_ms < l.reps[i - 1]!.end_ms) {
        ctx.addIssue({ code: "custom", path: ["reps", i], message: "reps overlap" });
      }
    }
    if (!l.cue_labels) return;
    if (!l.supported) {
      ctx.addIssue({
        code: "custom",
        path: ["cue_labels"],
        message: "cue labels on an unsupported setup: every cue there is wrong by definition",
      });
    }
    const seen = new Set<string>();
    l.cue_labels.rules.forEach((rule, r) => {
      const path = ["cue_labels", "rules", r];
      if (seen.has(rule.rule_id)) {
        ctx.addIssue({ code: "custom", path, message: `${rule.rule_id} annotated twice` });
      }
      seen.add(rule.rule_id);
      const all = [...rule.expected_reps, ...rule.not_expected_reps];
      if (all.some((i) => i >= l.reps.length)) {
        ctx.addIssue({ code: "custom", path, message: "rep index out of range" });
      }
      if (new Set(all).size !== all.length) {
        ctx.addIssue({ code: "custom", path, message: "a rep is listed twice for one rule" });
      }
    });
  });
export type ClipLabels = z.infer<typeof ClipLabels>;

/**
 * Per-exercise acceptance gate, versioned next to the fixtures (data/…/<exercise>/gate.json).
 * Two jobs, judged separately (M2 calibration): counting reps on supported setups, and refusing
 * to count on unsupported ones. One mixed precision number would hide which of them failed.
 */
export const VisionGate = z.object({
  /**
   * Only fixtures from the model the app actually runs (ADR-0010) are held to the gate; fixtures
   * from other models are reported for comparison.
   */
  runtime_model: z.enum(["pose_landmarker_lite", "pose_landmarker_full"]),
  /** counting, on `supported` clips only */
  min_precision: z.number().min(0).max(1),
  min_recall: z.number().min(0).max(1),
  /** refusal: share of `supported: false` clips on which nothing at all is counted */
  min_refusal_rate: z.number().min(0).max(1),
  /** a counted rep matches a label if it completes within [start − tol, end + tol] */
  match_tolerance_ms: Ms,
  /** recorded (non-synthetic) clips required before the gate counts as evidence */
  min_recorded_clips: z.number().int().nonnegative(),
  /**
   * Feedback cues (M3 S2), scored from the analyzer's raw cues (before cooldown hides any) against
   * `cue_labels`. Always enforced besides these numbers: no cue inside `untrackable_ranges_ms`,
   * no cue on an unsupported clip.
   */
  cues: z.object({
    /**
     * false cues ÷ chances to be wrong. A false cue is one on a `not_expected` rep or outside
     * every labelled rep; the chances are the `not_expected` reps plus those stray cues.
     */
    max_false_positive_rate: z.number().min(0).max(1),
    /** `not_expected` rep judgements needed before a low false-positive rate means anything */
    min_judged_negatives: z.number().int().positive(),
  }),
});
export type VisionGate = z.infer<typeof VisionGate>;
