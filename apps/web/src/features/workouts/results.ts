/**
 * Results of the workout server actions. Actions return these instead of throwing so the client
 * keeps the reason (a thrown error is flattened by Next). Shared by actions and outbox; no
 * server-only imports here so client code can use the types and the tracked-type list.
 */
export type Failure =
  | "session_completed"
  | "session_not_found"
  | "tracking_consent_required"
  | "event_limit_reached"
  | "invalid_events"
  | "invalid_request"
  | "unavailable";

export type EventError = { index: number; code: string };

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; failure: Failure; errors?: EventError[] };

/** Event types that need `tracking_data_consent` (they carry camera-derived data). */
export const TRACKED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "rep_completed",
  "feedback_shown",
  "feedback_acknowledged",
  "feedback_dismissed",
  "tracking_degraded",
  "set_completed",
]);
