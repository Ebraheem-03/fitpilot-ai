import type { ExerciseSummary, SessionEvent } from "@fitpilot/exercise-contracts";

/**
 * Post-set summary (FR-06: "provide a post-set summary using recorded session data"), built only
 * from the set's recorded `SessionEvent`s, never from live engine state, so it shows exactly what
 * would be saved. Cue and span entries use the contract's `ExerciseSummary` shapes, which the
 * server computes the same way from stored events (ADR-0011 §3).
 */
export interface SetSummary {
  exercise_id: string;
  set_index: number;
  reps: number;
  /** a `set_completed` was recorded (false while the set is still running) */
  completed: boolean;
  cues: ExerciseSummary["cues"];
  tracking_degraded: ExerciseSummary["tracking_degraded"];
  /** total unreliable time, ms */
  degraded_ms: number;
}

/** Summarises one set's events (`SessionRecorder.setEvents`). Null when nothing was recorded. */
export function summariseSet(events: readonly SessionEvent[]): SetSummary | null {
  const first = events[0];
  if (!first) return null;
  let reps = 0;
  let completed: { set_index: number; reps: number } | null = null;
  let repSet: number | null = null;
  const cues: ExerciseSummary["cues"] = [];
  const spans: ExerciseSummary["tracking_degraded"] = [];

  for (const e of events) {
    switch (e.type) {
      case "rep_completed":
        reps += 1;
        repSet ??= e.set_index;
        break;
      case "feedback_shown":
        cues.push({
          rule_id: e.rule_id,
          ruleset_version: e.ruleset_version,
          message_id: e.message_id,
          shown_at: e.occurred_at,
          measurements: { ...e.measurements },
          response: null,
        });
        break;
      case "feedback_acknowledged":
      case "feedback_dismissed": {
        // answers the latest unanswered showing of the same cue
        const cue = cues.findLast(
          (c) => c.rule_id === e.rule_id && c.message_id === e.message_id && c.response === null,
        );
        if (cue) cue.response = e.type === "feedback_acknowledged" ? "acknowledged" : "dismissed";
        break;
      }
      case "tracking_degraded":
        spans.push({ reason: e.reason, started_at: e.occurred_at, duration_ms: e.duration_ms });
        break;
      case "set_completed":
        completed = { set_index: e.set_index, reps: e.reps };
        break;
      default:
        break; // manual logging and skips belong to the workout runner, not a tracked set
    }
  }

  spans.sort((a, b) => a.started_at.localeCompare(b.started_at));
  return {
    exercise_id: first.exercise_id,
    set_index: completed?.set_index ?? repSet ?? 0,
    reps: completed?.reps ?? reps,
    completed: completed !== null,
    cues,
    tracking_degraded: spans,
    degraded_ms: spans.reduce((sum, s) => sum + s.duration_ms, 0),
  };
}
