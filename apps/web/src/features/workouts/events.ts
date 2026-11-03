import { SessionEvent, type SkipReason } from "@fitpilot/exercise-contracts";

/**
 * Builders for the events the workout runner records itself (the camera's events come from the
 * live-coaching recorder). Each result is parsed with the shared `SessionEvent` contract, so a
 * malformed event throws here, in the browser, instead of being rejected by the API later.
 */
interface Context {
  sessionId: string;
  exerciseId: string;
  /** injected so tests are deterministic */
  now?: () => Date;
  newKey?: () => string;
}

const stamp = (c: Context) => ({
  session_id: c.sessionId,
  exercise_id: c.exerciseId,
  occurred_at: (c.now?.() ?? new Date()).toISOString(),
  idempotency_key: c.newKey?.() ?? crypto.randomUUID(),
});

export interface SetDetails {
  setIndex: number;
  /** 1–10; leave out when the member did not rate the set */
  difficulty?: number | null;
  note?: string | null;
}

const optional = (d: SetDetails) => ({
  ...(d.difficulty ? { perceived_difficulty: d.difficulty } : {}),
  ...(d.note?.trim() ? { note: d.note.trim() } : {}),
});

/** A set the member typed in: reps for counted exercises, seconds held for timed ones. */
export function manualSetEvent(
  c: Context,
  d: SetDetails & ({ reps: number } | { durationS: number }),
): SessionEvent {
  return SessionEvent.parse({
    ...stamp(c),
    type: "set_logged",
    set_index: d.setIndex,
    ...("reps" in d ? { reps: d.reps } : { duration_s: d.durationS }),
    ...optional(d),
  });
}

/**
 * The member's rating of a camera-counted set. A second `set_completed` for the same set index
 * replaces the first on the server (it keeps the latest event per set), with the same reps plus
 * the rating. It is camera-derived data, so the outbox drops it without consent.
 */
export function trackedSetRatingEvent(c: Context, d: SetDetails & { reps: number }): SessionEvent {
  return SessionEvent.parse({
    ...stamp(c),
    type: "set_completed",
    set_index: d.setIndex,
    reps: d.reps,
    ...optional(d),
  });
}

export function skipEvent(c: Context, reason?: SkipReason | null): SessionEvent {
  return SessionEvent.parse({
    ...stamp(c),
    type: "exercise_skipped",
    ...(reason ? { reason } : {}),
  });
}
