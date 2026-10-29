export type GenerateErrorCode =
  "profile_required" | "generation_in_progress" | "coach_busy" | "ai_unavailable" | "unknown";

/** What the generate button shows after the server action ran. */
export type GenerateState =
  | { status: "idle" }
  | {
      status: "done";
      planStatus: "active" | "needs_review";
      planId: string;
      version: number;
      replayed: boolean;
    }
  | { status: "error"; code: GenerateErrorCode; retryAfterS: number | null };

export const IDLE: GenerateState = { status: "idle" };
