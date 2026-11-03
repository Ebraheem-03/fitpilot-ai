import type { ExerciseContract, PlannedExercise } from "@fitpilot/exercise-contracts";
import { describe, expect, it } from "vitest";
import { resolveRunnerExercises } from "./runner-exercises";

const planned = (exercise_id: string): PlannedExercise =>
  ({ exercise_id, sets: 3, reps: 10, duration_s: null, rest_s: 60 }) as PlannedExercise;
const squat = {
  id: "bodyweight_squat",
  name: "Bodyweight squat",
  prescription: "reps",
  instructions: ["Stand tall."],
  required_landmarks: [],
  animation: null,
  supported_capabilities: ["rep_counting"],
} as unknown as ExerciseContract;

describe("resolveRunnerExercises", () => {
  it("uses the catalogue's name, prescription and instructions", () => {
    const { exercises, missing } = resolveRunnerExercises([planned("bodyweight_squat")], [squat]);
    expect(missing).toEqual([]);
    expect(exercises[0]).toMatchObject({ id: "bodyweight_squat", name: "Bodyweight squat" });
  });

  it("reports an exercise the catalogue no longer has, and never invents an entry for it", () => {
    const { exercises, missing } = resolveRunnerExercises(
      [planned("bodyweight_squat"), planned("retired_move")],
      [squat],
    );
    expect(missing).toEqual(["retired_move"]);
    expect(exercises.map((e) => e.id)).toEqual(["bodyweight_squat"]);
  });
});
