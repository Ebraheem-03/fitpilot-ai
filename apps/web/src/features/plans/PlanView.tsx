import type { TrainingDay, TrainingPlanResource } from "@fitpilot/exercise-contracts";
import Link from "next/link";
import type { ReactNode } from "react";
import { capitalise, prescriptionLabel, restLabel } from "./labels";

/** What the plan page needs to know about a catalogue exercise. */
export interface ExerciseInfo {
  id: string;
  name: string;
  /** the catalogue has a 3D demonstration */
  hasDemo: boolean;
  /** the catalogue says camera-tracked AND this build ships an analyzer */
  tracked: boolean;
}

export type ExerciseIndex = ReadonlyMap<string, ExerciseInfo>;

export const TRACKED_LABEL = "Camera-tracked";
export const MANUAL_LABEL = "Logged by hand";

/**
 * The week as a list of days. Pure and server-renderable. `dayAction` lets the workout flow put a
 * "Start" button on each day without this component knowing about sessions.
 */
export function PlanView({
  plan,
  exercises,
  dayAction,
}: {
  plan: NonNullable<TrainingPlanResource["plan"]>;
  exercises: ExerciseIndex;
  dayAction?: (day: TrainingDay, index: number) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6" data-testid="plan-view">
      <section aria-labelledby="rationale-heading" className="rounded-xl border border-border p-5">
        <h2 id="rationale-heading" className="font-semibold">
          Why this plan
        </h2>
        <p className="mt-1">{plan.rationale}</p>
      </section>
      <ol className="flex flex-col gap-4" aria-label="Training days">
        {plan.days.map((day, index) => (
          <li key={day.day_of_week}>
            <DayCard
              day={day}
              index={index}
              exercises={exercises}
              action={dayAction?.(day, index)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function DayCard({
  day,
  index,
  exercises,
  action,
}: {
  day: TrainingDay;
  index: number;
  exercises: ExerciseIndex;
  action: ReactNode;
}) {
  const headingId = `day-${day.day_of_week}`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={`plan-day-${day.day_of_week}`}
      data-day-index={index}
      className="rounded-xl border border-border p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-lg font-semibold">
          {capitalise(day.day_of_week)}
          <span className="font-normal text-muted"> · {day.focus}</span>
        </h3>
        {action}
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-border">
        {day.exercises.map((planned) => {
          const info = exercises.get(planned.exercise_id);
          const name = info?.name ?? planned.exercise_id.replaceAll("_", " ");
          return (
            <li
              key={planned.exercise_id}
              data-testid="plan-exercise"
              data-exercise-id={planned.exercise_id}
              className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium">{name}</span>
                <span data-testid="plan-prescription">{prescriptionLabel(planned)}</span>
                <span className="text-sm text-muted">{restLabel(planned.rest_s)}</span>
              </div>
              <p className="text-sm text-muted">Progression: {planned.progression}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  data-testid="plan-tracking"
                  className="rounded-full border border-border px-2 py-0.5 text-muted"
                >
                  {info?.tracked ? TRACKED_LABEL : MANUAL_LABEL}
                </span>
                {info && (
                  <Link
                    href={`/app/exercises/${info.id}`}
                    className="text-sm font-medium underline"
                  >
                    {info.hasDemo ? "Watch the 3D demo" : "How to do it"}
                    <span className="sr-only">: {name}</span>
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
