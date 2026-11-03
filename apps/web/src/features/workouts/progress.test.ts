import { describe, expect, it } from "vitest";
import {
  counts,
  currentStep,
  emptyProgress,
  exerciseState,
  nextSetIndex,
  parseProgress,
  recordSet,
  serialiseProgress,
  skipExercise,
} from "./progress";

const day = [
  { exercise_id: "bodyweight_squat", sets: 2 },
  { exercise_id: "plank", sets: 1 },
  { exercise_id: "glute_bridge", sets: 3 },
];
const manual = (set_index: number, reps = 10) => ({
  set_index,
  source: "manual" as const,
  reps,
  duration_s: null,
});

describe("workout progress", () => {
  it("starts at set 1 of the first exercise", () => {
    expect(currentStep(emptyProgress(), day)).toEqual({ exerciseIndex: 0, setNumber: 1 });
  });

  it("walks through sets, then on to the next exercise, then finishes", () => {
    let p = recordSet(emptyProgress(), "bodyweight_squat", manual(0));
    expect(exerciseState(p, day[0]!)).toBe("in_progress");
    expect(currentStep(p, day)).toEqual({ exerciseIndex: 0, setNumber: 2 });
    p = recordSet(p, "bodyweight_squat", manual(1));
    expect(exerciseState(p, day[0]!)).toBe("done");
    expect(currentStep(p, day)).toEqual({ exerciseIndex: 1, setNumber: 1 });
    p = recordSet(p, "plank", { set_index: 0, source: "manual", reps: null, duration_s: 30 });
    p = skipExercise(p, "glute_bridge");
    expect(currentStep(p, day)).toBeNull();
    expect(counts(p, day)).toEqual({ total: 3, done: 2, skipped: 1 });
  });

  it("skipping jumps over an exercise, also one that was started", () => {
    let p = recordSet(emptyProgress(), "bodyweight_squat", manual(0));
    p = skipExercise(p, "bodyweight_squat");
    expect(exerciseState(p, day[0]!)).toBe("skipped");
    expect(currentStep(p, day)).toEqual({ exerciseIndex: 1, setNumber: 1 });
  });

  it("re-saving a set replaces it instead of counting twice, and a set un-skips", () => {
    let p = recordSet(emptyProgress(), "plank", manual(0, 5));
    p = recordSet(p, "plank", manual(0, 8));
    expect(p.exercises.plank!.sets).toEqual([manual(0, 8)]);
    p = skipExercise(p, "plank");
    p = recordSet(p, "plank", manual(1));
    expect(p.exercises.plank!.skipped).toBe(false);
  });

  it("never reuses a set index, even after a gap (a retried camera set)", () => {
    expect(nextSetIndex(emptyProgress(), "plank")).toBe(0);
    const p = recordSet(emptyProgress(), "plank", manual(2));
    expect(nextSetIndex(p, "plank")).toBe(3);
  });

  it("does not mutate the previous state", () => {
    const before = emptyProgress();
    recordSet(before, "plank", manual(0));
    skipExercise(before, "plank");
    expect(before).toEqual({ exercises: {} });
  });
});

describe("persistence", () => {
  it("round-trips", () => {
    const p = skipExercise(recordSet(emptyProgress(), "plank", manual(0)), "glute_bridge");
    expect(parseProgress(serialiseProgress(p))).toEqual(p);
  });

  it.each([null, "", "not json", "[]", '{"exercises":"x"}', '{"exercises":{"A B":{"sets":[]}}}'])(
    "treats %j as no progress",
    (raw) => {
      expect(parseProgress(raw)).toEqual(emptyProgress());
    },
  );

  it("drops malformed sets but keeps the good ones", () => {
    const raw = JSON.stringify({
      exercises: {
        plank: {
          sets: [manual(0), { set_index: -1, source: "manual", reps: 1, duration_s: null }, 7],
          skipped: true,
        },
      },
    });
    expect(parseProgress(raw)).toEqual({
      exercises: { plank: { sets: [manual(0)], skipped: true } },
    });
  });
});
