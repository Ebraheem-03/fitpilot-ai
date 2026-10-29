import { z } from "zod";
import { cueRuleViolation } from "./cue-rules";
import { Prescription } from "./exercise";

/**
 * Events the browser sends to POST /api/v1/workout-sessions/{id}/events (FR-07).
 * Never per-frame data and never raw video (principle 5, ADR-0011): every record is closed
 * (`strictObject`), every id and key is pattern-constrained, and feedback measurements are checked
 * against the rule's declared keys (`cue-rules.ts`). Every feedback event carries the rule id +
 * version + the measurements that triggered it (FR-06 traceability).
 */

const ID = /^[a-z0-9_]+$/;
const ExerciseId = z.string().regex(ID).max(64);
const RuleId = z
  .string()
  .regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/)
  .max(64);
const MessageId = z.string().regex(ID).max(64);
const MeasurementKey = z.string().regex(ID).max(48);
/** Only the measurements a rule declares; the cap is a second line of defence against smuggling. */
export const MAX_MEASUREMENTS_PER_CUE = 16;
const Measurements = z
  .record(MeasurementKey, z.number())
  .refine((m) => Object.keys(m).length <= MAX_MEASUREMENTS_PER_CUE, {
    message: `at most ${MAX_MEASUREMENTS_PER_CUE} measurements per cue`,
  });
const Confidence = z.number().min(0).max(1);
const Difficulty = z.number().int().min(1).max(10);
const Timestamp = z.string().datetime();
/** Member-typed free text. Never logged (ADR-0011 §6). */
export const MAX_NOTE_LENGTH = 500;
const Note = z.string().trim().min(1).max(MAX_NOTE_LENGTH);
const SetIndex = z.number().int().min(0).max(50);

/** Hard cap for one ingestion request (ADR-0011 §3). */
export const MAX_EVENTS_PER_BATCH = 500;

const base = {
  session_id: z.string().uuid(),
  exercise_id: ExerciseId,
  occurred_at: Timestamp,
  /** client-generated, makes event ingestion idempotent on retry */
  idempotency_key: z.string().min(8).max(128),
};

export const RepCompletedEvent = z.strictObject({
  ...base,
  type: z.literal("rep_completed"),
  set_index: SetIndex,
  rep_index: z.number().int().min(0).max(500),
  duration_ms: z.number().int().positive().max(60_000),
  tracking_confidence: Confidence,
});

export const FeedbackShownEvent = z
  .strictObject({
    ...base,
    type: z.literal("feedback_shown"),
    rule_id: RuleId,
    ruleset_version: z.number().int().positive(),
    message_id: MessageId,
    measurements: Measurements,
    tracking_confidence: Confidence,
  })
  .superRefine((event, ctx) => {
    const violation = cueRuleViolation(
      event.rule_id,
      event.exercise_id,
      Object.keys(event.measurements),
      event.ruleset_version,
    );
    if (violation) ctx.addIssue({ code: "custom", message: violation, path: ["measurements"] });
  });

/** The member acknowledged ("got it") or dismissed a cue they were shown (FR-06). */
const feedbackResponse = {
  ...base,
  rule_id: RuleId,
  message_id: MessageId,
};
export const FeedbackAcknowledgedEvent = z.strictObject({
  ...feedbackResponse,
  type: z.literal("feedback_acknowledged"),
});
export const FeedbackDismissedEvent = z.strictObject({
  ...feedbackResponse,
  type: z.literal("feedback_dismissed"),
});

export const TRACKING_DEGRADED_REASONS = [
  "low_visibility",
  "out_of_frame",
  "low_light",
  "unsupported_view",
  "no_person",
  "slow_device",
] as const;
export const TrackingDegradedReason = z.enum(TRACKING_DEGRADED_REASONS);

/** A span of unreliable tracking: starts at `occurred_at`, lasts `duration_ms`. */
export const TrackingDegradedEvent = z.strictObject({
  ...base,
  type: z.literal("tracking_degraded"),
  reason: TrackingDegradedReason,
  duration_ms: z.number().int().nonnegative().max(3_600_000),
});

export const SetCompletedEvent = z.strictObject({
  ...base,
  type: z.literal("set_completed"),
  set_index: SetIndex,
  reps: z.number().int().nonnegative().max(1000),
  perceived_difficulty: Difficulty.optional(),
  note: Note.optional(),
});

/**
 * A set the member typed in themselves (untracked exercises, or tracking switched off). Reps for
 * rep-based exercises, `duration_s` for timed ones — exactly one of the two.
 */
export const SetLoggedEvent = z
  .strictObject({
    ...base,
    type: z.literal("set_logged"),
    set_index: SetIndex,
    reps: z.number().int().positive().max(1000).optional(),
    duration_s: z.number().int().positive().max(3600).optional(),
    perceived_difficulty: Difficulty.optional(),
    note: Note.optional(),
  })
  .superRefine((event, ctx) => {
    if ((event.reps === undefined) === (event.duration_s === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "set_logged needs exactly one of reps or duration_s",
        path: ["reps"],
      });
    }
  });

export const SKIP_REASONS = [
  "no_equipment",
  "too_difficult",
  "discomfort",
  "no_time",
  "other",
] as const;
export const SkipReason = z.enum(SKIP_REASONS);

export const ExerciseSkippedEvent = z.strictObject({
  ...base,
  type: z.literal("exercise_skipped"),
  reason: SkipReason.optional(),
});

export const SessionEvent = z.discriminatedUnion("type", [
  RepCompletedEvent,
  FeedbackShownEvent,
  FeedbackAcknowledgedEvent,
  FeedbackDismissedEvent,
  TrackingDegradedEvent,
  SetCompletedEvent,
  SetLoggedEvent,
  ExerciseSkippedEvent,
]);

/** One ingestion request: all events belong to one session, at most `MAX_EVENTS_PER_BATCH`. */
export const SessionEventBatch = z
  .strictObject({
    events: z.array(SessionEvent).min(1).max(MAX_EVENTS_PER_BATCH),
  })
  .superRefine((batch, ctx) => {
    const first = batch.events[0]?.session_id;
    batch.events.forEach((event, i) => {
      if (event.session_id !== first) {
        ctx.addIssue({
          code: "custom",
          message: "all events in a batch must belong to one session",
          path: ["events", i, "session_id"],
        });
      }
    });
  });

// --- SessionSummary: computed server-side from stored events only (ADR-0011 §3) -----------------

export const CueResponse = z.enum(["acknowledged", "dismissed"]);

/** One recorded set. `source` says whether the camera counted it or the member typed it. */
export const SummarySet = z.strictObject({
  set_index: SetIndex,
  source: z.enum(["tracked", "manual"]),
  reps: z.number().int().nonnegative().nullable(),
  duration_s: z.number().int().nonnegative().nullable(),
  perceived_difficulty: Difficulty.nullable(),
});

/** A cue the member was shown, with the rule and measurements behind it (FR-06). */
export const SummaryCue = z.strictObject({
  rule_id: RuleId,
  ruleset_version: z.number().int().positive(),
  message_id: MessageId,
  shown_at: Timestamp,
  measurements: Measurements,
  response: CueResponse.nullable(),
});

export const SummaryTrackingSpan = z.strictObject({
  reason: TrackingDegradedReason,
  started_at: Timestamp,
  duration_ms: z.number().int().nonnegative(),
});

export const ExerciseSummary = z.strictObject({
  exercise_id: ExerciseId,
  status: z.enum(["completed", "skipped"]),
  skip_reason: SkipReason.nullable(),
  prescription: Prescription,
  /** true when at least one set was counted by the camera */
  tracked: z.boolean(),
  sets: z.array(SummarySet).max(51),
  total_reps: z.number().int().nonnegative(),
  total_duration_s: z.number().int().nonnegative(),
  cues: z.array(SummaryCue).max(200),
  tracking_degraded: z.array(SummaryTrackingSpan).max(100),
  /** the rating on the exercise's last set that carried one */
  perceived_difficulty: Difficulty.nullable(),
  /** the note on the exercise's last set that carried one */
  note: Note.nullable(),
});

export const SessionSummary = z.strictObject({
  session_id: z.string().uuid(),
  started_at: Timestamp.nullable(),
  completed_at: Timestamp.nullable(),
  exercises: z.array(ExerciseSummary).max(50),
  /** reported when the member completes the session (FR-07) */
  perceived_difficulty: Difficulty.nullable(),
  note: Note.nullable(),
});

export type SessionEvent = z.infer<typeof SessionEvent>;
export type SessionEventBatch = z.infer<typeof SessionEventBatch>;
export type SessionSummary = z.infer<typeof SessionSummary>;
export type ExerciseSummary = z.infer<typeof ExerciseSummary>;
export type SkipReason = z.infer<typeof SkipReason>;
export type TrackingDegradedReason = z.infer<typeof TrackingDegradedReason>;
