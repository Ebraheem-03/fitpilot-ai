import type { SessionSummary } from "@fitpilot/exercise-contracts";

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
  /** null = no consent given, or withdrawn (ADR-0011 §4) */
  tracking_data_consent_at: string | null;
  tracking_data_consent_version: number | null;
  created_at: string;
  updated_at: string;
};
export type ProfileInput = Omit<
  Profile,
  "created_at" | "updated_at" | "tracking_data_consent_at" | "tracking_data_consent_version"
>;

/** The consent copy version this build shows; the API accepts only versions it knows. */
export const TRACKING_CONSENT_VERSION = 1;

export type SessionStatus = "started" | "completed";
export type WorkoutSessionBrief = {
  id: string;
  status: SessionStatus;
  training_plan_id: string | null;
  plan_day_index: number | null;
  started_at: string;
  completed_at: string | null;
  perceived_difficulty: number | null;
};
export type WorkoutSession = WorkoutSessionBrief & {
  note: string | null;
  /** present once the session is completed; shape is the SessionSummary contract */
  summary: SessionSummary | null;
};
export type WorkoutSessionPage = {
  items: WorkoutSessionBrief[];
  total: number;
  limit: number;
  offset: number;
};
export type EventIngestResult = { accepted: number; duplicates: number };
export type StartSessionInput = { training_plan_id?: string; plan_day_index?: number };
export type CompleteSessionInput = { perceived_difficulty?: number; note?: string };
