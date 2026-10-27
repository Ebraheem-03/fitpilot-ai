import { z } from "zod";

/**
 * Events the browser sends to POST /api/v1/workout-sessions/{id}/events (FR-07).
 * Never per-frame data and never raw video (principle 5). Every feedback event must carry the
 * rule id + version + the measurements that triggered it (FR-06 traceability).
 */
const base = {
  session_id: z.string().uuid(),
  exercise_id: z.string(),
  occurred_at: z.string().datetime(),
  /** client-generated, makes event ingestion idempotent on retry */
  idempotency_key: z.string().min(8),
};

export const RepCompletedEvent = z.object({
  ...base,
  type: z.literal("rep_completed"),
  set_index: z.number().int().nonnegative(),
  rep_index: z.number().int().nonnegative(),
  duration_ms: z.number().int().positive(),
  tracking_confidence: z.number().min(0).max(1),
});

export const FeedbackShownEvent = z.object({
  ...base,
  type: z.literal("feedback_shown"),
  rule_id: z.string(),
  ruleset_version: z.number().int().positive(),
  message_id: z.string(),
  measurements: z.record(z.string(), z.number()),
  tracking_confidence: z.number().min(0).max(1),
});

export const TrackingDegradedEvent = z.object({
  ...base,
  type: z.literal("tracking_degraded"),
  reason: z.enum(["low_visibility", "out_of_frame", "low_light", "unsupported_view", "no_person"]),
  duration_ms: z.number().int().nonnegative(),
});

export const SetCompletedEvent = z.object({
  ...base,
  type: z.literal("set_completed"),
  set_index: z.number().int().nonnegative(),
  reps: z.number().int().nonnegative(),
  perceived_difficulty: z.number().int().min(1).max(10).optional(),
});

export const SessionEvent = z.discriminatedUnion("type", [
  RepCompletedEvent,
  FeedbackShownEvent,
  TrackingDegradedEvent,
  SetCompletedEvent,
]);

export type SessionEvent = z.infer<typeof SessionEvent>;
