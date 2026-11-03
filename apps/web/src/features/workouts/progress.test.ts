import { describe, expect, it } from "vitest";
import {
  counts,
  currentStep,
  emptyProgress,
  exerciseState,
  nextSetIndex,
  parseProgress,
  recordSet,
  seedFromServer,
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

describe("seedFromServer (a lost or missing ledger)", () => {
  it("does nothing without server progress or when the ledger is already ahead", () => {
    const p = recordSet(emptyProgress(), "plank", manual(0));
    expect(seedFromServer(p, null)).toBe(p);
    expect(
      seedFromServer(p, { plank: { set_indexes: [0], skipped: false, highest_set_index: 0 } }),
    ).toEqual({
      exercises: { plank: { sets: [manual(0)], skipped: false, next_floor: 1 } },
    });
  });

  it("an empty ledger resumes after the sets the server holds, never reusing an index", () => {
    const seeded = seedFromServer(emptyProgress(), {
      glute_bridge: { set_indexes: [0, 1], skipped: false, highest_set_index: 1 },
    });
    expect(exerciseState(seeded, day[2]!)).toBe("in_progress");
    expect(currentStep(seeded, day)?.setNumber).toBe(1); // squat, untouched
    expect(nextSetIndex(seeded, "glute_bridge")).toBe(2);
  });

  it("a camera set the server only has reps for still reserves its index", () => {
    const seeded = seedFromServer(emptyProgress(), {
      bodyweight_squat: { set_indexes: [0], skipped: false, highest_set_index: 3 },
    });
    expect(nextSetIndex(seeded, "bodyweight_squat")).toBe(4);
    expect(seeded.exercises.bodyweight_squat!.sets).toHaveLength(1);
  });

  it("keeps the server's skip, unless the member has saved a set since", () => {
    const skipped = seedFromServer(emptyProgress(), {
      plank: { set_indexes: [], skipped: true, highest_set_index: null },
    });
    expect(exerciseState(skipped, day[1]!)).toBe("skipped");
    const withSet = seedFromServer(emptyProgress(), {
      plank: { set_indexes: [0], skipped: true, highest_set_index: 0 },
    });
    expect(exerciseState(withSet, day[1]!)).toBe("done");
  });

  it("is idempotent, and the floor survives storage", () => {
    const server = { plank: { set_indexes: [2], skipped: false, highest_set_index: 5 } };
    const once = seedFromServer(emptyProgress(), server);
    expect(seedFromServer(once, server)).toBe(once);
    expect(nextSetIndex(parseProgress(serialiseProgress(once)), "plank")).toBe(6);
  });
});
