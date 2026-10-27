// Hand-written mirrors of the API's Pydantic models until ADR-0008 picks a type-sharing strategy.
export type Role = "member" | "trainer" | "gym_admin" | "platform_admin";
export type Me = { id: string; role: Role };

export const GOALS = [
  "general_fitness",
  "strength",
  "muscle_gain",
  "fat_loss",
  "mobility",
] as const;
export const EXPERIENCE = ["beginner", "intermediate", "advanced"] as const;
export const EQUIPMENT = [
  "dumbbells",
  "kettlebell",
  "resistance_band",
  "pull_up_bar",
  "bench",
  "barbell",
  "mat",
] as const;

export type Profile = {
  primary_goal: (typeof GOALS)[number];
  experience_level: (typeof EXPERIENCE)[number];
  days_per_week: number | null;
  session_minutes: number | null;
  equipment: (typeof EQUIPMENT)[number][];
  created_at: string;
  updated_at: string;
};
export type ProfileInput = Omit<Profile, "created_at" | "updated_at">;
