"use client";
import type { LandmarkName } from "@fitpilot/exercise-contracts";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { phaseLabel } from "../exercise-viewer/labels";
import { analyzerFor } from "./analyzers";
import { browserDeps } from "./engine/browser";
import { type EngineSnapshot, LiveEngine } from "./engine/engine";
import { initialSession } from "./engine/session";
import { announcement, FAILURE_MESSAGES, guidance } from "./labels";
import { drawSkeleton } from "./skeleton";

export interface LiveExercise {
  id: string;
  name: string;
  required_landmarks: readonly LandmarkName[];
}

const IDLE: EngineSnapshot = {
  session: initialSession,
  tracking: { status: "searching", issue: "no_person", confidence: 0, fps: null, slow: false },
  reps: 0,
  phase: null,
  landmarks: null,
  delegate: null,
  latencyMs: null,
};
const noop = () => () => {};
const button =
  "rounded-md border border-border px-4 py-2 font-medium hover:bg-surface disabled:opacity-50";
const primary =
  "rounded-md bg-brand px-4 py-2 font-medium text-brand-foreground hover:bg-brand-hover";

/**
 * Live squat tracking (FR-04 + FR-05 rep counting, M2 exit): explain → camera permission →
 * preview with skeleton, tracking status, placement guidance and a rep counter that visibly
 * pauses when tracking isn't reliable (principle 3). Frames stay in this tab.
 */
export function LiveCoach({ exercise }: { exercise: LiveExercise }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const pauseRef = useRef<HTMLButtonElement>(null);
  const stoppedRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<LiveEngine | null>(null);
  // Keyed by value: a new array identity for the same landmarks (router refresh, HMR) must not
  // dispose the engine and switch the camera off mid-session.
  const requiredKey = exercise.required_landmarks.join(",");

  useEffect(() => {
    const video = videoRef.current!;
    const create = analyzerFor(exercise.id)!;
    const required = requiredKey.split(",") as LandmarkName[];
    const e = new LiveEngine(browserDeps(video, create), video, required);
    setEngine(e);
    return () => e.dispose(); // leaving the page always turns the camera off
  }, [exercise.id, requiredKey]);

  const snap = useSyncExternalStore(
    engine?.subscribe ?? noop,
    engine?.getSnapshot ?? (() => IDLE),
    () => IDLE,
  );
  const { session, tracking, reps, phase, landmarks } = snap;
  const live = session.status === "running" || session.status === "paused";
  const cameraOn = live || session.status === "loading";

  // The control the member used disappears when the panel changes: move focus to where the
  // next action is, but never steal it from somewhere they've moved to themselves.
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (session.status === "running") pauseRef.current?.focus();
    else if (session.status === "stopped") stoppedRef.current?.focus();
    else if (session.status === "error") errorRef.current?.focus();
  }, [session.status]);

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

      {(session.status === "idle" || session.status === "requesting") && (
        <div className="flex flex-col gap-3 rounded-xl border border-border p-5">
          <h3 className="font-semibold">Before you start</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>
              Your camera is processed <strong>on this device only</strong>. No video is recorded or
              uploaded.
            </li>
            <li>Stand side-on to the camera, 2–3 m away, with your whole body in the picture.</li>
            <li>Good, even light in front of you helps tracking.</li>
            <li>
              Reps are only counted while tracking is reliable. If it isn&apos;t, we say so and
              pause the count.
            </li>
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={primary}
              disabled={!engine || session.status === "requesting"}
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
            {reps} {reps === 1 ? "rep" : "reps"} counted.
          </p>
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

          <div className="rounded-xl border border-border p-4">
            <p className="text-sm text-muted">Reps</p>
            <p className="text-5xl font-semibold tabular-nums" data-testid="rep-count">
              {reps}
            </p>
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
