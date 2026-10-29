import type { SessionEvent } from "@fitpilot/exercise-contracts";
import { TRACKED_EVENT_TYPES } from "../results";

/**
 * The function the session recorder emits into. It is called while the camera runs, so it only
 * enqueues on the device (the outbox is held until the camera stops). Without the member's
 * consent, camera-derived (tracked) events are dropped here, before they are even stored;
 * manual logging (`set_logged`, `exercise_skipped`) always goes through (ADR-0011 §4).
 */
export function createEventSink(opts: {
  outbox: { enqueue: (events: SessionEvent[]) => Promise<void> };
  hasConsent: () => boolean;
}): (events: readonly SessionEvent[]) => void {
  return (events) => {
    const allowed = opts.hasConsent()
      ? [...events]
      : events.filter((e) => !TRACKED_EVENT_TYPES.has(e.type));
    if (allowed.length) void opts.outbox.enqueue(allowed);
  };
}
