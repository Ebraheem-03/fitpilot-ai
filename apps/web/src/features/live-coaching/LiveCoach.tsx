"use client";
import type { LandmarkName, SessionEvent } from "@fitpilot/exercise-contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { phaseLabel } from "../exercise-viewer/labels";
import { TrackingConsentStep } from "../workouts/TrackingConsentStep";
import { getOutbox } from "../workouts/outbox/browser";
import { createEventSink } from "../workouts/outbox/sink";
import { analyzerFor } from "./analyzers";
import { CueCard } from "./CueCard";
import { browserDeps } from "./engine/browser";
import { type EngineSnapshot, LiveEngine } from "./engine/engine";
import { initialSession } from "./engine/session";
import { announcement, count, FAILURE_MESSAGES, guidance } from "./labels";
import { type EventSink, SessionRecorder } from "./recording/recorder";
import { type SetSummary, summariseSet } from "./recording/summary";
import { SetSummaryView } from "./SetSummaryView";
import { drawSkeleton } from "./skeleton";

export interface LiveExercise {
  id: string;
  name: string;
  required_landmarks: readonly LandmarkName[];
}

declare global {
  interface Window {
    /** practice-mode events for the e2e (never set in production builds) */
    __fitpilotLiveEvents?: readonly SessionEvent[];
  }
}

export interface LiveCoachProps {
  exercise: LiveExercise;
  /**
   * The workout session these sets belong to (S8). Absent ⇒ practice mode: events are recorded
   * for the post-set summary and stay on this page.
   */
  sessionId?: string;
  /**
   * Receives each batch of recorded events, only with a `sessionId` (S7: the on-device outbox,
   * flushed after the camera stops; ADR-0011). Nothing in this component sends anything.
   */
  sink?: EventSink;
  /** Whether the member has already agreed to save tracking data (ADR-0011 §4). */
  trackingConsent?: boolean;
  /** reps prescribed for the set: shows set progress */
  targetReps?: number;
  /** index of the first set this camera session records (later sets count on from it) */
  setIndex?: number;
  /** a set ended (stop, or the camera failed): its summary and recorded events */
  onSetComplete?: (summary: SetSummary, events: readonly SessionEvent[]) => void;
}

const IDLE: EngineSnapshot = {
  session: initialSession,
  tracking: { status: "searching", issue: "no_person", confidence: 0, fps: null, slow: false },
  reps: 0,
  phase: null,
  landmarks: null,
  delegate: null,
  latencyMs: null,
  cue: null,
  cueProducedAt: null,
  events: [],
};
const MEDICAL_NOTICE =
  "Coaching, not medical advice — stop if anything hurts, and talk to a qualified professional about pain or injury.";
const noop = () => () => {};
const button =
  "rounded-md border border-border px-4 py-2 font-medium hover:bg-surface disabled:opacity-50";
const primary =
  "rounded-md bg-brand px-4 py-2 font-medium text-brand-foreground hover:bg-brand-hover";

/**
 * Live squat tracking and coaching (FR-04, FR-05 rep counting, FR-06 cues): explain → camera
 * permission → preview with skeleton, tracking status, placement guidance, a rep counter that
 * visibly pauses when tracking isn't reliable (principle 3), the one cue the cue selector chose
 * with its measurement and explanation, and a post-set summary from the recorded events.
 * Frames stay in this tab, and nothing here sends events anywhere (ADR-0011).
 */
export function LiveCoach({
  exercise,
  sessionId,
  sink,
  trackingConsent = false,
  targetReps,
  setIndex = 0,
  onSetComplete,
}: LiveCoachProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const pauseRef = useRef<HTMLButtonElement>(null);
  const stoppedRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const cueHadFocus = useRef(false);
  const [engine, setEngine] = useState<LiveEngine | null>(null);
  // Callbacks by ref: a new function identity on a parent re-render must not restart the camera.
  const sinkRef = useRef(sink);
  const onSetCompleteRef = useRef(onSetComplete);
  useEffect(() => {
    sinkRef.current = sink;
    onSetCompleteRef.current = onSetComplete;
  });
  // Keyed by value: a new array identity for the same landmarks (router refresh, HMR) must not
  // dispose the engine and switch the camera off mid-session.
  const [consent, setConsent] = useState<"granted" | "declined" | "unknown">(
    trackingConsent ? "granted" : "unknown",
  );
  const consentRef = useRef(consent);
  useEffect(() => {
    consentRef.current = consent;
  }, [consent]);
  const consentPending = sessionId !== undefined && consent === "unknown";
  const requiredKey = exercise.required_landmarks.join(",");

  useEffect(() => {
    const video = videoRef.current!;
    const create = analyzerFor(exercise.id)!;
    const required = requiredKey.split(",") as LandmarkName[];
    const recorder = new SessionRecorder({
      exerciseId: exercise.id,
      sessionId,
      sink: (events) => {
        sinkRef.current?.(events);
        // With a session, events wait in the on-device outbox (ADR-0011): enqueue only; the
        // outbox is held while the camera runs and flushes after it stops. Without consent the
        // tracked events are dropped here.
        if (sessionId !== undefined) outboxSink(events);
      },
      firstSetIndex: setIndex,
    });
    const outboxSink = createEventSink({
      outbox: getOutbox(),
      hasConsent: () => consentRef.current === "granted",
    });
    const e = new LiveEngine(browserDeps(video, create), video, required, { recorder });
    setEngine(e);
    return () => {
      e.dispose(); // leaving the page always turns the camera off
      delete window.__fitpilotLiveEvents;
    };
  }, [exercise.id, requiredKey, sessionId, setIndex]);

  const snap = useSyncExternalStore(
    engine?.subscribe ?? noop,
    engine?.getSnapshot ?? (() => IDLE),
    () => IDLE,
  );
  const { session, tracking, reps, phase, landmarks, events } = snap;
  const live = session.status === "running" || session.status === "paused";
  const cameraOn = live || session.status === "loading";
  const ended = session.status === "stopped" || session.status === "error";
  const summary = useMemo(() => (ended ? summariseSet(events) : null), [ended, events]);
  const reportedSet = useRef<string | null>(null);

  // A set ended: hand its summary and events to the workout runner (S8), once.
  useEffect(() => {
    const last = events.at(-1);
    if (!summary || last?.type !== "set_completed") return;
    if (reportedSet.current === last.idempotency_key) return;
    reportedSet.current = last.idempotency_key;
    onSetCompleteRef.current?.(summary, events);
    // The set is over and the camera is off (stop, or it failed): send what it recorded. The
    // outbox is still held for a render at most; releasing it flushes too, and repeats are no-ops.
    if (sessionId !== undefined) void getOutbox().flush(sessionId);
  }, [summary, events, sessionId]);

  // e2e only (tests/e2e/live-cues.spec.ts): the current set's practice-mode events, readable by
  // the test in the page. Never in a production build, never for a real session.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || sessionId !== undefined) return;
    window.__fitpilotLiveEvents = events;
  }, [events, sessionId]);

  const acknowledge = useCallback(() => engine?.acknowledgeCue(), [engine]);
  const dismiss = useCallback(() => engine?.dismissCue(), [engine]);
  const now = useCallback(() => engine?.now() ?? performance.now(), [engine]);

  // Nothing is sent while the camera is on; when it stops (or the page is left) the outbox flushes
  // the set (ADR-0011 §2).
  useEffect(() => {
    if (!sessionId) return;
    getOutbox().holdWhile(cameraOn);
  }, [sessionId, cameraOn]);
  useEffect(() => {
    if (!sessionId) return;
    return () => getOutbox().holdWhile(false);
  }, [sessionId]);

  // The control the member used disappears when the panel changes: move focus to where the
  // next action is, but never steal it from somewhere they've moved to themselves.
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (session.status === "running") pauseRef.current?.focus();
    else if (session.status === "stopped") stoppedRef.current?.focus();
    else if (session.status === "error") errorRef.current?.focus();
  }, [session.status]);

  // The cue's buttons vanish when it's answered, expires or is withdrawn. If focus was on them,
  // put it on the session controls; a cue appearing never takes focus.
  const cueKey = snap.cue?.shown_at_ms ?? null;
  useEffect(() => {
    if (!cueHadFocus.current) return;
    const active = document.activeElement;
    if (active && active !== document.body) return; // still on the card, or moved on by them
    cueHadFocus.current = false;
    pauseRef.current?.focus();
  }, [cueKey]);

  useEffect(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const [w, h] = [video.videoWidth || 640, video.videoHeight || 480];
    if (canvas.width !== w) canvas.width = w; // resizing reallocates: only when it changes
    if (canvas.height !== h) canvas.height = h;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (landmarks && live) drawSkeleton(ctx, landmarks, { minVisibility: 0.6, mirrored: true });
  }, [landmarks, live]);

  const hint = guidance(tracking, landmarks, exercise.required_landmarks);
  const reliable = tracking.status === "tracking";
  const percent = Math.round(tracking.confidence * 100);
  // the engine already withdraws cues when unreliable; never render one regardless
  const cue = session.status === "running" && reliable ? snap.cue : null;

  return (
    <section
      aria-labelledby="live-heading"
      data-testid="live-coach"
      data-session={session.status}
      data-tracking={live ? tracking.status : "off"}
      data-latency-ms={snap.latencyMs ?? undefined}
      data-fps={tracking.fps ?? undefined}
      className="flex flex-col gap-4"
    >
      <h2 id="live-heading" className="text-lg font-semibold">
        Track your {exercise.name.toLowerCase()} with the camera
      </h2>
      <p aria-live="polite" className="sr-only" data-testid="live-announcement">
        {announcement(session, tracking, reps)}
      </p>
      <p role="note" data-testid="medical-notice" className="text-sm text-muted">
        {MEDICAL_NOTICE}
      </p>

      {(session.status === "idle" || session.status === "requesting") && (
        <div className="flex flex-col gap-3 rounded-xl border border-border p-5">
          <h3 className="font-semibold">Before you start</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>
              Your video and body points <strong>never leave this device</strong>. Workout data
              derived from them (rep counts and cue measurements) is saved only if you agree, and
              only after the camera stops.
            </li>
            <li>Stand side-on to the camera, 2–3 m away, with your whole body in the picture.</li>
            <li>Good, even light in front of you helps tracking.</li>
            <li>
              Reps are only counted while tracking is reliable. If it isn&apos;t, we say so and
              pause the count.
            </li>
            <li>
              Cues come from measured rules, show the measurement behind them, and only appear while
              tracking is reliable.
            </li>
          </ul>
          {consentPending && (
            <TrackingConsentStep onDecision={(save) => setConsent(save ? "granted" : "declined")} />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={primary}
              disabled={!engine || session.status === "requesting" || consentPending}
              onClick={() => void engine?.start()}
            >
              {session.status === "requesting" ? "Waiting for permission…" : "Start camera"}
            </button>
            <Link href={`/app/exercises/${exercise.id}`} className="text-sm font-medium underline">
              No camera? Follow the 3D demonstration instead
            </Link>
          </div>
        </div>
      )}

      {session.status === "error" && (
        <div
          role="alert"
          ref={errorRef}
          tabIndex={-1}
          className="flex flex-col gap-2 rounded-xl border border-danger p-5"
        >
          <p className="font-semibold">{FAILURE_MESSAGES[session.reason].title}</p>
          <p className="text-sm">{FAILURE_MESSAGES[session.reason].detail}</p>
          {reps > 0 && <p className="text-sm">{reps} reps were counted before it stopped.</p>}
          {summary && <SetSummaryView summary={summary} targetReps={targetReps} />}
          <div className="flex flex-wrap items-center gap-3">
            {session.retryable && (
              <button type="button" className={primary} onClick={() => void engine?.start()}>
                Try again
              </button>
            )}
            <Link href={`/app/exercises/${exercise.id}`} className="text-sm font-medium underline">
              Use the 3D demonstration instead
            </Link>
          </div>
        </div>
      )}

      {session.status === "stopped" && (
        <div className="flex flex-col gap-2 rounded-xl border border-border p-5">
          <p className="font-semibold" ref={stoppedRef} tabIndex={-1}>
            Camera off.
          </p>
          <p className="text-sm" data-testid="final-reps">
            {count(summary?.reps ?? reps)} counted.
          </p>
          {summary && <SetSummaryView summary={summary} targetReps={targetReps} />}
          {sessionId && (
            <p className="text-sm text-muted" data-testid="save-state">
              {consent === "granted"
                ? "Your set is being saved to your account."
                : "Not saved: you chose to track only on this device."}
            </p>
          )}
          <div>
            <button type="button" className={primary} onClick={() => void engine?.start()}>
              Start again
            </button>
          </div>
        </div>
      )}

      <div className={cameraOn ? "flex flex-col gap-4 lg:flex-row" : "hidden"}>
        <div className="relative w-full overflow-hidden rounded-xl border border-border bg-black lg:max-w-2xl">
          {/* live camera preview: no audio, nothing to caption */}
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Your camera preview"
            className="block w-full -scale-x-100"
          />
          <canvas
            ref={overlayRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
          {session.status === "loading" && (
            <p className="absolute inset-0 flex items-center justify-center bg-black/60 p-4 text-center text-white">
              Preparing tracking… the first time, this downloads the tracking model and can take a
              little while.
            </p>
          )}
          {session.status === "paused" && (
            <p className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
              Paused — camera on, nothing is being analysed.
            </p>
          )}
        </div>

        <div className="flex min-w-64 flex-col gap-4">
          <div
            data-testid="tracking-status"
            data-status={tracking.status}
            data-issue={tracking.issue ?? ""}
            className={`rounded-xl border p-4 ${hint.tone === "ok" ? "border-brand" : "border-border"}`}
          >
            <p className="font-semibold">{session.status === "running" ? hint.title : "—"}</p>
            {session.status === "running" && <p className="text-sm">{hint.detail}</p>}
            <label className="mt-3 flex flex-col gap-1 text-sm">
              Tracking confidence {live && tracking.status !== "searching" ? `${percent}%` : "—"}
              <meter
                min={0}
                max={100}
                low={60}
                optimum={100}
                value={live ? percent : 0}
                aria-valuetext={
                  live && tracking.status !== "searching" ? `${percent} percent` : "not tracking"
                }
                className="w-full"
              />
            </label>
            {tracking.slow && session.status === "running" && tracking.issue !== "slow_device" && (
              <p className="mt-2 text-sm">
                This device is processing slowly ({tracking.fps} fps); tracking may be less steady.
              </p>
            )}
          </div>

          <div aria-live="polite" data-testid="cue-region">
            {cue && (
              <CueCard
                key={cue.shown_at_ms}
                cue={cue}
                producedAt={snap.cueProducedAt}
                now={now}
                onAcknowledge={acknowledge}
                onDismiss={dismiss}
                onFocusChange={(inside) => (cueHadFocus.current = inside)}
              />
            )}
          </div>

          <div className="rounded-xl border border-border p-4">
            <p className="text-sm text-muted">Reps</p>
            <p className="text-5xl font-semibold tabular-nums" data-testid="rep-count">
              {reps}
            </p>
            {targetReps !== undefined && targetReps > 0 && (
              <div className="mt-1 flex flex-col gap-1 text-sm">
                <p data-testid="set-progress">
                  {reps >= targetReps
                    ? `Target reached: ${reps} of ${targetReps} reps. Stop when you're ready.`
                    : `${reps} of ${targetReps} reps this set`}
                </p>
                <progress
                  max={targetReps}
                  value={Math.min(reps, targetReps)}
                  aria-label="Set progress"
                  className="w-full"
                />
              </div>
            )}
            <p className="text-sm" data-testid="rep-state">
              {session.status !== "running"
                ? ""
                : reliable
                  ? `Counting${phase ? ` · ${phaseLabel(phase)}` : ""}`
                  : "Reps paused — tracking not reliable"}
            </p>
          </div>

          <div role="group" aria-label="Camera session" className="flex flex-wrap gap-2">
            {session.status === "paused" ? (
              <button type="button" className={button} onClick={() => engine?.resume()}>
                Resume
              </button>
            ) : (
              <button
                type="button"
                ref={pauseRef}
                className={button}
                disabled={session.status !== "running"}
                onClick={() => engine?.pause()}
              >
                Pause
              </button>
            )}
            <button type="button" className={button} onClick={() => engine?.stop()}>
              Stop camera
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
