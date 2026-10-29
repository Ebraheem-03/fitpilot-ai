import { z } from "zod";

/**
 * Weekly training plan (FR-02, blueprint §6). `TrainingPlan` is exactly what the LLM is asked to
 * produce (ADR-0006: strict JSON schema, so every field is required and the "absent" spelling is
 * `null`). Shape from the M3 S0 spike (docs/evaluation/llm-spike-2026-10-28.md).
 *
 * The contract checks what a plan must satisfy on its own: bounds, exactly one of reps or
 * duration, distinct days, no exercise twice in a day. What depends on the catalogue and the
 * member (catalogue ids, reps vs duration per exercise, equipment, days per week, session length)
 * is the API's domain validation (`services/api/app/services/plans/validation.py`), which runs
 * before anything is saved or shown.
 */

export const DAYS_OF_WEEK = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export const DayOfWeek = z.enum(DAYS_OF_WEEK);

/** Bounds the generator must stay inside (shared with the prompt and the API mirror). */
export const PLAN_LIMITS = {
  sets: { min: 1, max: 6 },
  reps: { min: 1, max: 30 },
  duration_s: { min: 10, max: 180 },
  rest_s: { min: 15, max: 240 },
  exercisesPerDay: { min: 1, max: 8 },
  progressionLength: 200,
  focusLength: 80,
  rationaleLength: 600,
} as const;

const ExerciseId = z
  .string()
  .regex(/^[a-z0-9_]+$/)
  .max(64);
const between = (limits: { min: number; max: number }) =>
  z.number().int().min(limits.min).max(limits.max);

export const PlannedExercise = z
  .strictObject({
    /** a catalogue id; the API checks it against `data/exercise-catalog` */
    exercise_id: ExerciseId,
    sets: between(PLAN_LIMITS.sets),
    /** set for rep-based exercises, null for timed ones */
    reps: between(PLAN_LIMITS.reps).nullable(),
    /** set for timed exercises (seconds per set), null for rep-based ones */
    duration_s: between(PLAN_LIMITS.duration_s).nullable(),
    rest_s: between(PLAN_LIMITS.rest_s),
    /** one sentence on how to progress week to week */
    progression: z.string().min(1).max(PLAN_LIMITS.progressionLength),
  })
  .superRefine((exercise, ctx) => {
    if ((exercise.reps === null) === (exercise.duration_s === null)) {
      ctx.addIssue({
        code: "custom",
        message: "a planned exercise needs exactly one of reps or duration_s",
        path: ["reps"],
      });
    }
  });

export const TrainingDay = z
  .strictObject({
    day_of_week: DayOfWeek,
    focus: z.string().min(1).max(PLAN_LIMITS.focusLength),
    exercises: z
      .array(PlannedExercise)
      .min(PLAN_LIMITS.exercisesPerDay.min)
      .max(PLAN_LIMITS.exercisesPerDay.max),
  })
  .superRefine((day, ctx) => {
    const ids = day.exercises.map((e) => e.exercise_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: `${day.day_of_week}: an exercise appears more than once`,
        path: ["exercises"],
      });
    }
  });

export const TrainingPlan = z
  .strictObject({
    days: z.array(TrainingDay).min(1).max(7),
    /** at most 3 sentences on how the plan fits the goal; no medical claims */
    rationale: z.string().min(1).max(PLAN_LIMITS.rationaleLength),
  })
  .superRefine((plan, ctx) => {
    const days = plan.days.map((d) => d.day_of_week);
    if (new Set(days).size !== days.length) {
      ctx.addIssue({
        code: "custom",
        message: "day_of_week values must be distinct",
        path: ["days"],
      });
    }
  });

// --- The stored plan as the API returns it (GET /api/v1/training-plans/…) ----------------------

/**
 * `active`: the member's current plan (at most one per member). `superseded`: an earlier active
 * plan, kept as history (FR-02). `needs_review`: the generator could not produce a valid plan
 * after one repair; nothing is shown to the member until a trainer checks it (ADR-0004
 * amendment, M3 S4).
 */
export const PlanStatus = z.enum(["active", "needs_review", "superseded"]);

export const PLAN_ISSUE_CODES = [
  /** the provider could not produce output in the plan format (e.g. truncated, schema error) */
  "generation_failed",
  /** the output did not parse as a TrainingPlan (types, bounds, missing fields) */
  "schema",
  "reps_or_duration",
  "days_distinct",
  "duplicate_exercise",
  /** exercise_id is not in the approved catalogue */
  "catalogue",
  /** the exercise needs equipment the member does not have */
  "equipment",
  /** number of days differs from days_per_week */
  "days_count",
  /** reps vs duration does not match the catalogue's `prescription` */
  "prescription",
  /** estimated session length exceeds session_minutes */
  "session_length",
] as const;
export const PlanIssueCode = z.enum(PLAN_ISSUE_CODES);

/** Why a generated plan was rejected. Messages come from the validator, never from the model. */
export const PlanValidationIssue = z.strictObject({
  code: PlanIssueCode,
  message: z.string().min(1).max(500),
});

export const MAX_PLAN_ISSUES = 50;

export const TrainingPlanResource = z
  .strictObject({
    id: z.string().uuid(),
    /** 1, 2, 3… per member, one per generation (including `needs_review` ones) */
    version: z.number().int().positive(),
    status: PlanStatus,
    /** the prompt that produced it, e.g. "plan-v1" (FR-13) */
    prompt_version: z.string().min(1).max(64),
    model: z.string().min(1).max(128),
    created_at: z.string().datetime({ offset: true }),
    /** empty unless `needs_review` */
    validation_issues: z.array(PlanValidationIssue).max(MAX_PLAN_ISSUES),
    /** null exactly when `needs_review`: a rejected draft is never shown to the member */
    plan: TrainingPlan.nullable(),
  })
  .superRefine((resource, ctx) => {
    const review = resource.status === "needs_review";
    if (review !== (resource.plan === null)) {
      ctx.addIssue({
        code: "custom",
        message: "plan must be null exactly when status is needs_review",
        path: ["plan"],
      });
    }
    if (review !== resource.validation_issues.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "validation_issues must be non-empty exactly when status is needs_review",
        path: ["validation_issues"],
      });
    }
  });

export type DayOfWeek = z.infer<typeof DayOfWeek>;
export type PlannedExercise = z.infer<typeof PlannedExercise>;
export type TrainingDay = z.infer<typeof TrainingDay>;
export type TrainingPlan = z.infer<typeof TrainingPlan>;
export type PlanStatus = z.infer<typeof PlanStatus>;
export type PlanIssueCode = z.infer<typeof PlanIssueCode>;
export type PlanValidationIssue = z.infer<typeof PlanValidationIssue>;
export type TrainingPlanResource = z.infer<typeof TrainingPlanResource>;
