import type { PlanIssueCode, PlannedExercise, PlanStatus } from "@fitpilot/exercise-contracts";
import type { GenerateErrorCode } from "./generate-state";

export const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "3 × 10 reps" or "3 × 30 s", from the plan's reps-or-duration pair. */
export function prescriptionLabel(
  exercise: Pick<PlannedExercise, "sets" | "reps" | "duration_s">,
): string {
  return exercise.reps !== null
    ? `${exercise.sets} × ${exercise.reps} reps`
    : `${exercise.sets} × ${exercise.duration_s} s`;
}

export const restLabel = (restS: number) => `Rest ${restS} s between sets`;

export const STATUS_LABELS: Record<PlanStatus, string> = {
  active: "Current",
  needs_review: "Waiting for a trainer",
  superseded: "Earlier version",
};

/** Plain-words reason per validator code. The validator's own message is shown as detail. */
export const ISSUE_EXPLANATIONS: Record<PlanIssueCode, string> = {
  generation_failed: "The coach could not put a plan together this time.",
  schema: "The draft was not in the format a plan needs.",
  reps_or_duration: "An exercise was missing how many reps or how long to hold it.",
  days_distinct: "The same weekday was used twice.",
  duplicate_exercise: "An exercise appeared twice on the same day.",
  catalogue: "The draft included an exercise that is not in our approved exercise library.",
  equipment: "The draft used equipment you did not say you have.",
  days_count: "The number of training days did not match what you asked for.",
  prescription: "An exercise was set up in reps when it is a timed hold, or the other way round.",
  session_length: "A day's workout would run longer than the time you have.",
  medical_claim: "The draft used medical wording that a trainer needs to check.",
};

export const NEEDS_REVIEW_HEADLINE = "A trainer needs to check this plan before you can use it";

export interface GenerateMessage {
  title: string;
  /** a link the message offers, when there is one */
  link?: { href: string; label: string };
}

/** What to tell the member when generation fails. Never offers a made-up plan. */
export function errorMessage(code: GenerateErrorCode, retryAfterS: number | null): GenerateMessage {
  switch (code) {
    case "coach_busy":
      return {
        title:
          retryAfterS === null
            ? "The coach is busy, try again in a little while."
            : `The coach is busy, try again in ${retryAfterS} s.`,
      };
    case "ai_unavailable":
      return {
        title:
          "Plan generation isn't available right now. Your current plan, if you have one, is unchanged. Please try again later.",
      };
    case "profile_required":
      return {
        title: "Set up your training profile first so the plan fits you.",
        link: { href: "/app/onboarding", label: "Set up your profile" },
      };
    case "generation_in_progress":
      return {
        title:
          retryAfterS === null
            ? "A plan is already being generated. Try again in a moment."
            : `A plan is already being generated. Try again in ${retryAfterS} s.`,
      };
    case "unknown":
      return { title: "Something went wrong and no plan was created. Please try again." };
  }
}
