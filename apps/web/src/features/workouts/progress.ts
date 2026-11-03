import type { PlannedExercise } from "@fitpilot/exercise-contracts";

/**
 * Where the member is in a workout (FR-07: "track completed exercises and skipped exercises").
 *
 * The outbox deletes events once the server confirms them, so it can't tell the runner where to
 * resume. This small on-device ledger records what the member saved, in step with the events
 * enqueued for the server, and it only drives the screen: the events are the record.
 *
 * The ledger is not trusted to be complete. While a session is started the API returns the sets,
 * skips and highest set index it has stored (`WorkoutSession.progress`), and the runner merges
 * that in on mount (`seedFromServer`). So a cleared localStorage or a second device resumes where
 * the server is, and the next set index is always above every index the server holds: a new set
 * can never overwrite a stored one (the server keeps the latest event for each set index,
 * session_summary.py).
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
  /** the next set index is never below this (the server already holds indexes under it) */
  next_floor?: number;
}

/** `progress[exercise_id]` of a started session, as the API returns it. */
export interface ServerExerciseProgress {
  set_indexes: number[];
  skipped: boolean;
  highest_set_index: number | null;
}
export type ServerProgress = Record<string, ServerExerciseProgress>;

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

/** Index for the next set of this exercise: after every index already used, here or on the server. */
export function nextSetIndex(progress: Progress, exerciseId: string): number {
  const { sets, next_floor } = of(progress, exerciseId);
  const local = sets.length === 0 ? 0 : Math.max(...sets.map((s) => s.set_index)) + 1;
  return Math.max(local, next_floor ?? 0);
}

/**
 * Merges what the server has stored into the ledger. Sets the server holds that the ledger lacks
 * become placeholder records (the screen needs only that they exist), a server skip is kept
 * unless the member has since saved a set, and the next set index is raised above the server's
 * highest. Returns the same object when nothing changes.
 */
export function seedFromServer(progress: Progress, server: ServerProgress | null): Progress {
  if (!server) return progress;
  let changed = false;
  const exercises = { ...progress.exercises };
  for (const [id, remote] of Object.entries(server)) {
    if (!/^[a-z0-9_]+$/.test(id)) continue;
    const current = of(progress, id);
    const known = new Set(current.sets.map((s) => s.set_index));
    const missing = remote.set_indexes.filter(
      (i) => Number.isInteger(i) && i >= 0 && !known.has(i),
    );
    const sets = missing.length
      ? [
          ...current.sets,
          ...missing.map((set_index) => ({
            set_index,
            source: "manual" as const,
            reps: null,
            duration_s: null,
          })),
        ].sort((a, b) => a.set_index - b.set_index)
      : current.sets;
    const skipped = current.skipped || (remote.skipped && sets.length === 0);
    const floor = Math.max(
      current.next_floor ?? 0,
      remote.highest_set_index === null ? 0 : remote.highest_set_index + 1,
    );
    const next_floor = floor > 0 ? floor : undefined;
    if (sets === current.sets && skipped === current.skipped && next_floor === current.next_floor) {
      continue;
    }
    changed = true;
    exercises[id] = { sets, skipped, ...(next_floor !== undefined ? { next_floor } : {}) };
  }
  return changed ? { exercises } : progress;
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

/**
 * Storage key per member and session: on a shared device one member's progress is never read
 * (or shown) for another, and sign-out can remove everything under the member's prefix.
 */
export const progressKeyPrefix = (userId: string) => `fitpilot.workout.v1.${userId}.`;
export const progressKey = (userId: string, sessionId: string) =>
  `${progressKeyPrefix(userId)}${sessionId}`;

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
      const floor = value.next_floor;
      exercises[id] = {
        sets: value.sets.filter(isSet),
        skipped: value.skipped === true,
        ...(Number.isInteger(floor) && (floor as number) > 0 ? { next_floor: floor } : {}),
      };
    }
    return { exercises };
  } catch {
    return emptyProgress();
  }
}

export const serialiseProgress = (progress: Progress) => JSON.stringify(progress);
