"use client";

import type {
  LandmarkName,
  PlannedExercise,
  SessionEvent,
  SkipReason,
} from "@fitpilot/exercise-contracts";
import { SKIP_REASONS } from "@fitpilot/exercise-contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LiveCoach } from "../live-coaching/LiveCoach";
import type { SetSummary } from "../live-coaching/recording/summary";
import { completeSession } from "./actions";
import { manualSetEvent, skipEvent, trackedSetRatingEvent } from "./events";
import { MEDICAL_NOTE, SKIP_LABELS, targetLabel } from "./labels";
import { getOutbox } from "./outbox/browser";
import {
  counts,
  currentStep,
  exerciseState,
  nextSetIndex,
  progressOf,
  recordSet,
  skipExercise,
  type Progress,
  type SetRecord,
  type Step,
} from "./progress";
import { RestTimer } from "./RestTimer";
import { SetForm, type SetFormValues } from "./SetForm";
import { clearStoredProgress, useStoredProgress } from "./useStoredProgress";

/** One exercise of today's workout: the plan's prescription plus what the catalogue says about it. */
export interface RunnerExercise {
  id: string;
  name: string;
  hasDemo: boolean;
  /** catalogue says camera-tracked and this build has an analyzer */
  tracked: boolean;
  prescription: "reps" | "duration";
  instructions: string[];
  required_landmarks: readonly LandmarkName[];
  planned: PlannedExercise;
}

export interface WorkoutRunnerProps {
  /** the signed-in member: each member has their own on-device outbox */
  userId: string;
  sessionId: string;
  exercises: RunnerExercise[];
  /** the member already agreed to save tracking data (ADR-0011 §4) */
  trackingConsent: boolean;
}

type Consent = "granted" | "declined" | "unknown";

const secondary = "rounded-md border border-border px-4 py-2 font-medium hover:bg-surface";
const card = "flex flex-col gap-4 rounded-xl border border-border p-5";

/** Items waiting on this device to be sent (ADR-0011 §2). Polled: the outbox flushes on its own. */
function usePendingCount(userId: string, sessionId: string): number {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let live = true;
    const read = () =>
      getOutbox(userId)
        .pendingCount(sessionId)
        .then((n) => live && setPending(n))
        .catch(() => undefined);
    void read();
    const id = setInterval(read, 2000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [userId, sessionId]);
  return pending;
}

/**
 * Today's workout (FR-07): the current exercise and set, its target, the rest between sets, the
 * instructions and a link to the demo. Camera-tracked exercises (the squat) are counted live by
 * `LiveCoach`; everything else is logged by hand, and any exercise can be skipped. The member
 * can rate each set and the workout, then complete it. Everything is recorded as `SessionEvent`s
 * in the on-device outbox, which sends them in the background and before completing.
 */
export function WorkoutRunner({
  userId,
  sessionId,
  exercises,
  trackingConsent,
}: WorkoutRunnerProps) {
  const router = useRouter();
  const [progress, updateProgress] = useStoredProgress(sessionId);
  const [consent, setConsent] = useState<Consent>(trackingConsent ? "granted" : "unknown");
  const [chosen, setChosen] = useState<{ key: string; mode: "camera" | "manual" } | null>(null);
  const [counted, setCounted] = useState<{ key: string; summary: SetSummary } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [rest, setRest] = useState<{ id: number; seconds: number; next: string } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState<SkipReason | "">("");
  const pending = usePendingCount(userId, sessionId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const planned = exercises.map((e) => e.planned);

  const step: Step | null = progress ? currentStep(progress, planned) : null;
  const resting = rest !== null;
  const stepKey = step ? `${step.exerciseIndex}:${step.setNumber}` : "done";
  const current = step ? exercises[step.exerciseIndex]! : null;

  // Move focus to the new step's heading when the step changes (not on first render).
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepKey, finishing, resting]);

  if (progress === null) return <p className="text-muted">Loading your workout…</p>;

  const summary = counts(progress, planned);
  const ctx = (exerciseId: string) => ({ sessionId, exerciseId });

  async function record(
    exercise: RunnerExercise,
    events: SessionEvent[],
    set: SetRecord | null,
    afterSet: Step | null,
  ) {
    if (events.length) await getOutbox(userId).enqueue(events);
    void getOutbox(userId).flush(sessionId); // sets are sent as they end; failures retry on their own
    updateProgress((p) => (set ? recordSet(p, exercise.id, set) : skipExercise(p, exercise.id)));
    setChosen(null);
    setCounted(null);
    setAttempt(0);
    setSkipReason("");
    // Rest only between the sets of one exercise.
    const left = afterSet !== null && set !== null && afterSet.setNumber <= exercise.planned.sets;
    setRest(
      left
        ? {
            id: Date.now(),
            seconds: exercise.planned.rest_s,
            next: `${exercise.name}, set ${afterSet.setNumber} of ${exercise.planned.sets}`,
          }
        : null,
    );
  }

  async function saveSet(exercise: RunnerExercise, step: Step, values: SetFormValues) {
    setBusy(true);
    setError(null);
    try {
      const details = { difficulty: values.difficulty, note: values.note };
      const byCamera =
        counted?.key === `${step.exerciseIndex}:${step.setNumber}` && values.amount === null;
      let events: SessionEvent[];
      let set: SetRecord;
      if (byCamera) {
        // Camera-counted and consented: the recorder already queued the set; only a rating or
        // note needs one more event (the server keeps the latest per set).
        const { summary: s } = counted!;
        events =
          values.difficulty || values.note.trim()
            ? [
                trackedSetRatingEvent(ctx(exercise.id), {
                  setIndex: s.set_index,
                  reps: s.reps,
                  ...details,
                }),
              ]
            : [];
        set = { set_index: s.set_index, source: "tracked", reps: s.reps, duration_s: null };
      } else {
        const setIndex = nextSetIndex(progress!, exercise.id);
        const amount = values.amount ?? 0;
        events = [
          manualSetEvent(
            ctx(exercise.id),
            exercise.prescription === "reps"
              ? { setIndex, reps: amount, ...details }
              : { setIndex, durationS: amount, ...details },
          ),
        ];
        set = {
          set_index: setIndex,
          source: "manual",
          reps: exercise.prescription === "reps" ? amount : null,
          duration_s: exercise.prescription === "duration" ? amount : null,
        };
      }
      const after: Step | null = {
        exerciseIndex: step.exerciseIndex,
        setNumber: step.setNumber + 1,
      };
      await record(exercise, events, set, after);
    } catch {
      setError("We couldn't save this set on this device. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function skip(exercise: RunnerExercise) {
    setBusy(true);
    setError(null);
    try {
      await record(exercise, [skipEvent(ctx(exercise.id), skipReason || null)], null, null);
    } catch {
      setError("We couldn't record that on this device. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function complete(values: SetFormValues) {
    setBusy(true);
    setError(null);
    try {
      const outbox = getOutbox(userId);
      await outbox.flush(sessionId).catch(() => undefined);
      // Events sent after completion are rejected, so completing now would lose what is waiting.
      if ((await outbox.pendingCount(sessionId)) > 0) {
        setError(
          "Some of your sets haven't been sent yet. Check your connection and try again. Nothing is lost.",
        );
        return;
      }
      const res = await completeSession(sessionId, `complete:${sessionId}`, {
        ...(values.difficulty ? { perceived_difficulty: values.difficulty } : {}),
        ...(values.note.trim() ? { note: values.note.trim() } : {}),
      });
      if (res.ok || res.failure === "session_completed") {
        clearStoredProgress(sessionId);
        router.push(`/app/workouts/${sessionId}/summary`);
        return;
      }
      setError(
        res.failure === "session_not_found"
          ? "This workout could not be found. It may have been deleted."
          : "We couldn't complete the workout. Please try again.",
      );
    } catch {
      setError("We couldn't complete the workout. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const showFinish = finishing || step === null;

  return (
    <div
      className="flex flex-col gap-6"
      data-testid="workout-runner"
      data-session-id={sessionId}
      data-current-exercise={current?.id ?? ""}
      data-set-number={step?.setNumber ?? ""}
      data-phase={showFinish ? "finish" : rest ? "rest" : "set"}
    >
      <p role="status" className="sr-only">
        {showFinish
          ? "Finish your workout"
          : rest
            ? "Resting"
            : current && step
              ? `${current.name}, set ${step.setNumber} of ${current.planned.sets}`
              : ""}
      </p>

      <Overview
        exercises={exercises}
        progress={progress}
        currentIndex={showFinish ? -1 : step!.exerciseIndex}
        pending={pending}
        done={summary.done}
        skipped={summary.skipped}
      />

      {showFinish ? (
        <FinishPanel
          headingRef={headingRef}
          allDone={step === null}
          unfinished={exercises.length - summary.done - summary.skipped}
          busy={busy}
          error={error}
          onBack={step ? () => setFinishing(false) : undefined}
          onComplete={(v) => void complete(v)}
        />
      ) : rest ? (
        <RestTimer
          key={rest.id}
          seconds={rest.seconds}
          nextLabel={rest.next}
          onDone={() => setRest(null)}
        />
      ) : (
        current &&
        step && (
          <section
            aria-labelledby="exercise-heading"
            data-testid="current-step"
            data-exercise-id={current.id}
            data-set-number={step.setNumber}
            className={card}
          >
            <div>
              <p className="text-sm text-muted">
                Exercise {step.exerciseIndex + 1} of {exercises.length}
              </p>
              <h2
                id="exercise-heading"
                ref={headingRef}
                tabIndex={-1}
                className="text-xl font-semibold outline-offset-4"
              >
                {current.name}
              </h2>
              <p className="mt-1 font-medium" data-testid="runner-set-progress">
                Set {step.setNumber} of {current.planned.sets} · {targetLabel(current.planned)}
              </p>
              <p className="text-sm text-muted">Rest {current.planned.rest_s} s between sets</p>
            </div>

            <div>
              <h3 className="text-sm font-semibold">How to do it</h3>
              <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-sm">
                {current.instructions.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ol>
              <Link
                href={`/app/exercises/${current.id}`}
                className="mt-2 inline-block text-sm font-medium underline"
              >
                {current.hasDemo ? "Watch the 3D demo" : "See the exercise page"}
                <span className="sr-only"> for {current.name} (your progress is kept)</span>
              </Link>
            </div>

            <SetEntry
              key={`${stepKey}:${attempt}`}
              exercise={current}
              step={step}
              consent={consent}
              setIndex={nextSetIndex(progress, current.id)}
              mode={chosen?.key === stepKey ? chosen.mode : current.tracked ? "camera" : "manual"}
              counted={counted?.key === stepKey ? counted.summary : null}
              busy={busy}
              error={error}
              userId={userId}
              sessionId={sessionId}
              onMode={(mode) => setChosen({ key: stepKey, mode })}
              onConsent={(granted) => setConsent(granted ? "granted" : "declined")}
              onCounted={(s) => setCounted({ key: stepKey, summary: s })}
              onRecordAgain={() => {
                setCounted(null);
                setAttempt((n) => n + 1);
              }}
              onSave={(values) => void saveSet(current, step, values)}
            />

            <fieldset className="flex flex-col gap-2 border-t border-border pt-4">
              <legend className="text-sm font-semibold">Not doing this exercise?</legend>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Why skip it? (optional)
                <select
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value as SkipReason | "")}
                  className="w-64 rounded-md border border-border bg-background px-3 py-2 text-base text-foreground"
                >
                  <option value="">No reason given</option>
                  {SKIP_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {SKIP_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void skip(current)}
                  className={secondary}
                >
                  Skip exercise
                </button>
              </div>
            </fieldset>
            <p className="text-sm text-muted">{MEDICAL_NOTE}</p>
          </section>
        )
      )}

      {!showFinish && (
        <div>
          <button type="button" onClick={() => setFinishing(true)} className={secondary}>
            Finish workout
          </button>
        </div>
      )}
    </div>
  );
}

function Overview({
  exercises,
  progress,
  currentIndex,
  pending,
  done,
  skipped,
}: {
  exercises: RunnerExercise[];
  progress: Progress;
  currentIndex: number;
  pending: number;
  done: number;
  skipped: number;
}) {
  return (
    <section aria-labelledby="overview-heading" className="flex flex-col gap-2">
      <h2 id="overview-heading" className="text-lg font-semibold">
        Your workout
      </h2>
      <p className="text-sm text-muted" data-testid="workout-progress">
        {done} of {exercises.length} exercises done
        {skipped > 0 ? `, ${skipped} skipped` : ""}.
      </p>
      <ol aria-label="Exercises in this workout" className="flex flex-col gap-1 text-sm">
        {exercises.map((e, i) => {
          const state = exerciseState(progress, e.planned);
          const sets = progressOf(progress, e.id).sets.length;
          return (
            <li
              key={e.id}
              data-testid="runner-exercise"
              data-exercise-id={e.id}
              data-state={state}
              aria-current={i === currentIndex ? "step" : undefined}
              className={`flex flex-wrap items-baseline justify-between gap-2 rounded-md border px-3 py-2 ${
                i === currentIndex ? "border-brand" : "border-border"
              }`}
            >
              <span className="font-medium">{e.name}</span>
              <span className="text-muted">
                {state === "done" && `Done · ${sets} ${sets === 1 ? "set" : "sets"}`}
                {state === "skipped" && "Skipped"}
                {state === "in_progress" && `${sets} of ${e.planned.sets} sets`}
                {state === "todo" && `${e.planned.sets} ${e.planned.sets === 1 ? "set" : "sets"}`}
                {" · "}
                {e.tracked ? "Camera-tracked" : "Logged by hand"}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-muted" data-testid="save-status" data-pending={pending}>
        {pending === 0
          ? "Nothing is waiting to be sent."
          : `${pending} ${pending === 1 ? "item is" : "items are"} waiting to be sent. They go as soon as you're online.`}
      </p>
    </section>
  );
}

/** Camera or by-hand entry for the current set, and the form that saves it. */
function SetEntry({
  exercise,
  step,
  consent,
  setIndex,
  mode,
  counted,
  busy,
  error,
  userId,
  sessionId,
  onMode,
  onConsent,
  onCounted,
  onRecordAgain,
  onSave,
}: {
  exercise: RunnerExercise;
  step: Step;
  consent: Consent;
  setIndex: number;
  mode: "camera" | "manual";
  counted: SetSummary | null;
  busy: boolean;
  error: string | null;
  userId: string;
  sessionId: string;
  onMode: (mode: "camera" | "manual") => void;
  onConsent: (granted: boolean) => void;
  onCounted: (summary: SetSummary) => void;
  onRecordAgain: () => void;
  onSave: (values: SetFormValues) => void;
}) {
  const timed = exercise.prescription === "duration";
  const amountLabel = timed ? "Seconds held" : "Reps completed";
  const planned = exercise.planned;

  if (mode === "manual") {
    return (
      <div className="flex flex-col gap-3" data-testid="manual-set">
        <h3 className="font-semibold">Log this set</h3>
        <SetForm
          amountLabel={amountLabel}
          defaultAmount={timed ? planned.duration_s : planned.reps}
          submitLabel="Save set"
          busy={busy}
          error={error}
          onSubmit={onSave}
        />
        {exercise.tracked && (
          <div>
            <button type="button" className={secondary} onClick={() => onMode("camera")}>
              Use the camera instead
            </button>
          </div>
        )}
      </div>
    );
  }

  // The camera is on screen until its set is over; then the member saves (and may rate) it.
  const saveWithCamera = counted !== null && consent === "granted";
  return (
    <div className="flex flex-col gap-3" data-testid="camera-set">
      <LiveCoach
        exercise={{
          id: exercise.id,
          name: exercise.name,
          required_landmarks: exercise.required_landmarks,
        }}
        userId={userId}
        sessionId={sessionId}
        setIndex={setIndex}
        targetReps={planned.reps ?? undefined}
        trackingConsent={consent === "granted"}
        consentDeclined={consent === "declined"}
        onConsentChange={onConsent}
        onSetComplete={onCounted}
        singleSet
      />
      {counted ? (
        <div className="flex flex-col gap-3" data-testid="save-tracked-set">
          <h3 className="font-semibold">
            Save set {step.setNumber}: {counted.reps} {counted.reps === 1 ? "rep" : "reps"} counted
          </h3>
          {!saveWithCamera && (
            <p className="text-sm text-muted">
              You chose to keep tracking data on this device, so the camera count isn&apos;t saved.
              You can log the set yourself to include it in your workout.
            </p>
          )}
          <SetForm
            amountLabel={saveWithCamera ? null : amountLabel}
            defaultAmount={saveWithCamera ? null : counted.reps}
            submitLabel="Save set"
            busy={busy}
            error={error}
            onSubmit={onSave}
          />
          <div>
            <button type="button" className={secondary} onClick={onRecordAgain}>
              Discard and record this set again
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className={secondary} onClick={() => onMode("manual")}>
            Log this set by hand instead
          </button>
        </div>
      )}
    </div>
  );
}

function FinishPanel({
  headingRef,
  allDone,
  unfinished,
  busy,
  error,
  onBack,
  onComplete,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  allDone: boolean;
  unfinished: number;
  busy: boolean;
  error: string | null;
  onBack?: () => void;
  onComplete: (values: SetFormValues) => void;
}) {
  return (
    <section aria-labelledby="finish-heading" data-testid="finish-panel" className={card}>
      <h2
        id="finish-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold outline-offset-4"
      >
        {allDone ? "All exercises done" : "Finish your workout"}
      </h2>
      {!allDone && unfinished > 0 && (
        <p className="text-muted">
          {unfinished} {unfinished === 1 ? "exercise isn't" : "exercises aren't"} finished. They
          won&apos;t appear in your summary.
        </p>
      )}
      <SetForm
        amountLabel={null}
        difficultyLabel="How hard was the whole workout? (optional)"
        submitLabel={busy ? "Saving…" : "Complete workout"}
        busy={busy}
        error={error}
        onSubmit={onComplete}
      />
      {onBack && (
        <div>
          <button type="button" className={secondary} onClick={onBack}>
            Back to the workout
          </button>
        </div>
      )}
    </section>
  );
}
