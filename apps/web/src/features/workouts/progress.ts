import type { PlannedExercise } from "@fitpilot/exercise-contracts";

/**
 * Where the member is in a workout (FR-07: "track completed exercises and skipped exercises").
 *
 * The API exposes a session's results only after it is completed, and the outbox deletes events
 * once the server confirms them, so neither can tell the runner where to resume. This small
 * on-device ledger records what the member saved, in step with the events enqueued for the
 * server. It only drives the screen: the events are the record. Losing it (cleared storage, another
 * device) restarts the walk-through at the first exercise, and re-saving a set is harmless because
 * the server keeps the latest event for each set index (session_summary.py).
 */
export interface SetRecord {
  /** index the events were sent with: unique within the exercise */
  set_index: number;
  source: "tracked" | "manual";
  reps: number | null;
  duration_s: number | null;
}

export interface ExerciseProgress {
  sets: SetRecord[];
  skipped: boolean;
}

export interface Progress {
  exercises: Record<string, ExerciseProgress>;
}

export const emptyProgress = (): Progress => ({ exercises: {} });

const of = (progress: Progress, exerciseId: string): ExerciseProgress =>
  progress.exercises[exerciseId] ?? { sets: [], skipped: false };

export const progressOf = of;

/** Saves (or replaces, for the same set index) a set. A skipped exercise that gets a set is no longer skipped. */
export function recordSet(progress: Progress, exerciseId: string, set: SetRecord): Progress {
  const current = of(progress, exerciseId);
  const sets = [...current.sets.filter((s) => s.set_index !== set.set_index), set].sort(
    (a, b) => a.set_index - b.set_index,
  );
  return { exercises: { ...progress.exercises, [exerciseId]: { sets, skipped: false } } };
}

export function skipExercise(progress: Progress, exerciseId: string): Progress {
  const current = of(progress, exerciseId);
  return { exercises: { ...progress.exercises, [exerciseId]: { ...current, skipped: true } } };
}

/** Index for the next set of this exercise: after every index already used. */
export function nextSetIndex(progress: Progress, exerciseId: string): number {
  const sets = of(progress, exerciseId).sets;
  return sets.length === 0 ? 0 : Math.max(...sets.map((s) => s.set_index)) + 1;
}

export type ExerciseState = "done" | "skipped" | "in_progress" | "todo";

export function exerciseState(
  progress: Progress,
  exercise: Pick<PlannedExercise, "exercise_id" | "sets">,
): ExerciseState {
  const p = of(progress, exercise.exercise_id);
  if (p.skipped) return "skipped";
  if (p.sets.length >= exercise.sets) return "done";
  return p.sets.length > 0 ? "in_progress" : "todo";
}

export interface Step {
  exerciseIndex: number;
  /** 1-based: the set the member is about to do */
  setNumber: number;
}

/** The first exercise that is neither done nor skipped, and its next set. Null when all are. */
export function currentStep(
  progress: Progress,
  exercises: readonly Pick<PlannedExercise, "exercise_id" | "sets">[],
): Step | null {
  for (const [exerciseIndex, exercise] of exercises.entries()) {
    const state = exerciseState(progress, exercise);
    if (state === "todo" || state === "in_progress") {
      return { exerciseIndex, setNumber: of(progress, exercise.exercise_id).sets.length + 1 };
    }
  }
  return null;
}

/** Totals for the "n of m exercises" line. */
export function counts(
  progress: Progress,
  exercises: readonly Pick<PlannedExercise, "exercise_id" | "sets">[],
) {
  const states = exercises.map((e) => exerciseState(progress, e));
  return {
    total: exercises.length,
    done: states.filter((s) => s === "done").length,
    skipped: states.filter((s) => s === "skipped").length,
  };
}

// --- persistence ------------------------------------------------------------------------------

export const progressKey = (sessionId: string) => `fitpilot.workout.v1.${sessionId}`;

const isSet = (v: unknown): v is SetRecord => {
  const s = v as SetRecord | null;
  return (
    typeof s === "object" &&
    s !== null &&
    Number.isInteger(s.set_index) &&
    s.set_index >= 0 &&
    (s.source === "tracked" || s.source === "manual") &&
    (s.reps === null || Number.isInteger(s.reps)) &&
    (s.duration_s === null || Number.isInteger(s.duration_s))
  );
};

/** Parses what was stored; anything unexpected is treated as no progress, never an error. */
export function parseProgress(raw: string | null): Progress {
  if (!raw) return emptyProgress();
  try {
    const data = JSON.parse(raw) as Progress;
    const exercises: Progress["exercises"] = {};
    for (const [id, value] of Object.entries(data.exercises ?? {})) {
      if (!/^[a-z0-9_]+$/.test(id) || !Array.isArray(value?.sets)) continue;
      exercises[id] = { sets: value.sets.filter(isSet), skipped: value.skipped === true };
    }
    return { exercises };
  } catch {
    return emptyProgress();
  }
}

export const serialiseProgress = (progress: Progress) => JSON.stringify(progress);
