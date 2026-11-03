import type { SkipReason } from "@fitpilot/exercise-contracts";

export const SKIP_LABELS: Record<SkipReason, string> = {
  no_equipment: "I don't have the equipment",
  too_difficult: "It's too difficult",
  discomfort: "It's uncomfortable or painful",
  no_time: "I'm short on time",
  other: "Another reason",
};

/** How the summary words a skipped exercise's reason. */
export const SKIP_SUMMARY: Record<SkipReason, string> = {
  no_equipment: "no equipment",
  too_difficult: "too difficult",
  discomfort: "discomfort",
  no_time: "short on time",
  other: "another reason",
};

export const DIFFICULTY_HINT = "1 is very easy, 10 is the hardest you could do";

export const MEDICAL_NOTE =
  "Coaching, not medical advice. Stop if anything hurts, and talk to a qualified professional about pain or injury.";

export function targetLabel(planned: { reps: number | null; duration_s: number | null }): string {
  return planned.reps !== null ? `${planned.reps} reps` : `${planned.duration_s} s`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "12 min" for a workout's length; "under a minute" below that. */
export function formatSpan(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return null;
  const ms = Date.parse(endIso) - Date.parse(startIso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.round(ms / 60_000);
  return min < 1 ? "under a minute" : `${min} min`;
}

const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
