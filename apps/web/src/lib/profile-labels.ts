import type { Profile } from "@/lib/api-types";

export const GOAL_LABELS: Record<Profile["primary_goal"], string> = {
  general_fitness: "General fitness",
  strength: "Get stronger",
  muscle_gain: "Build muscle",
  fat_loss: "Lose fat",
  mobility: "Move better (mobility)",
};

export const EXPERIENCE_LABELS: Record<Profile["experience_level"], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export const EQUIPMENT_LABELS: Record<Profile["equipment"][number], string> = {
  dumbbells: "Dumbbells",
  kettlebell: "Kettlebell",
  resistance_band: "Resistance band",
  pull_up_bar: "Pull-up bar",
  bench: "Bench",
  barbell: "Barbell",
  mat: "Exercise mat",
};
