import type { ExerciseContract } from "@fitpilot/exercise-contracts";

/** "front_45" → "front 45", joined for display: ["quadriceps","glutes"] → "Quadriceps, glutes". */
export function listLabel(values: readonly string[], empty: string): string {
  if (values.length === 0) return empty;
  const text = values.map((v) => v.replaceAll("_", " ")).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const NO_DEMO_MESSAGE = "No 3D demo yet. Follow the written steps below.";

export const PRESCRIPTION_LABELS: Record<ExerciseContract["prescription"], string> = {
  reps: "Counted in reps",
  duration: "Held for time",
};

/** Short tags for a library card: how it is prescribed, and what help we can give. */
export function exerciseTags(
  exercise: Pick<ExerciseContract, "prescription" | "animation">,
  tracked: boolean,
): string[] {
  return [
    PRESCRIPTION_LABELS[exercise.prescription],
    exercise.animation ? "3D demo" : "No 3D demo yet",
    ...(tracked ? ["Camera tracking"] : []),
  ];
}
