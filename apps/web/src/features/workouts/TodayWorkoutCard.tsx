"use client";

import { DAYS_OF_WEEK, type DayOfWeek } from "@fitpilot/exercise-contracts";
import { useSyncExternalStore } from "react";
import { StartWorkoutButton } from "./StartWorkoutButton";

export interface PlanDayRef {
  /** position in the plan's days (the API's `plan_day_index`) */
  index: number;
  day: DayOfWeek;
  focus: string;
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const noop = () => () => {};

/** Monday = 0 … Sunday = 6 in the member's own time zone. */
export const todayIndex = (now: Date) => (now.getDay() + 6) % 7;

/**
 * The plan day to offer for `today` (Monday-first index): today's, or the next one coming up
 * (wrapping into next week). Null for a plan with no days.
 */
export function pickDay(
  days: readonly PlanDayRef[],
  today: number,
): { day: PlanDayRef; isToday: boolean } | null {
  const rank = (d: PlanDayRef) => DAYS_OF_WEEK.indexOf(d.day);
  const exact = days.find((d) => rank(d) === today);
  if (exact) return { day: exact, isToday: true };
  const sorted = [...days].sort((a, b) => rank(a) - rank(b));
  const next = sorted.find((d) => rank(d) > today) ?? sorted[0];
  return next ? { day: next, isToday: false } : null;
}

/**
 * "Today's workout" on the plan page. The weekday is read in the browser (the server's clock
 * isn't the member's), so nothing renders until then.
 */
export function TodayWorkoutCard({
  planId,
  days,
  resume,
}: {
  planId: string;
  days: PlanDayRef[];
  /** plan day index → a started, unfinished session */
  resume: Readonly<Record<number, string>>;
}) {
  // A day-sized snapshot: stable between renders, null on the server and during hydration.
  const today = useSyncExternalStore(
    noop,
    () => todayIndex(new Date()),
    () => null,
  );
  if (today === null) return null;
  const pick = pickDay(days, today);
  if (!pick) return null;
  const { day, isToday } = pick;
  return (
    <section
      aria-labelledby="today-heading"
      data-testid="today-workout"
      data-is-today={isToday}
      className="flex flex-col gap-3 rounded-xl border border-brand p-5"
    >
      <h2 id="today-heading" className="text-lg font-semibold">
        {isToday ? "Today's workout" : "Your next workout"}
      </h2>
      <p>
        {isToday ? "" : "Nothing is planned for today. "}
        {cap(day.day)} · {day.focus}
      </p>
      <div>
        <StartWorkoutButton
          planId={planId}
          dayIndex={day.index}
          label={isToday ? "Start today's workout" : `Start ${cap(day.day)}'s workout now`}
          resumeSessionId={resume[day.index]}
          primary
        />
      </div>
    </section>
  );
}
