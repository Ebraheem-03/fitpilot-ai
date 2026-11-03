"use client";
import { useMemo } from "react";
import { LiveCoach, type LiveCoachProps, type SetOutbox } from "../live-coaching/LiveCoach";
import { getOutbox } from "./outbox/browser";
import { createEventSink } from "./outbox/sink";
import { TrackingConsentStep } from "./TrackingConsentStep";

/**
 * Wires `LiveCoach` to this member's on-device outbox and the tracking-consent step (ADR-0011).
 * The workouts feature owns both; `LiveCoach` only sees the `SetOutbox` port, so live-coaching
 * never imports workouts.
 */
export function LiveSessionCoach({
  userId,
  ...props
}: Omit<LiveCoachProps, "outbox" | "renderConsent"> & { userId?: string }) {
  const { sessionId } = props;
  // Stable identity: a new port would restart the engine (and switch the camera off).
  const outbox = useMemo<SetOutbox | undefined>(() => {
    if (sessionId === undefined || userId === undefined) return undefined;
    const real = getOutbox(userId);
    return {
      enqueue: (events, consented) =>
        createEventSink({ outbox: real, hasConsent: () => consented })(events),
      holdWhile: (hold) => real.holdWhile(hold),
      idle: () => real.idle(),
      flush: (id) => real.flush(id),
    };
  }, [sessionId, userId]);
  return (
    <LiveCoach
      {...props}
      outbox={outbox}
      renderConsent={(onDecision) => <TrackingConsentStep onDecision={onDecision} />}
    />
  );
}
