"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { startSession } from "./actions";

/**
 * Starts a workout from one day of a plan, or resumes the one already in progress for that day.
 * One idempotency key per button: a double click or a retry after a dropped connection gets the
 * same session back instead of a second one.
 */
export function StartWorkoutButton({
  planId,
  dayIndex,
  label = "Start workout",
  resumeSessionId,
  primary = false,
}: {
  planId: string;
  /** position in the plan's days, Monday first (the API's `plan_day_index`) */
  dayIndex: number;
  label?: string;
  /** a started, not yet completed session for this day */
  resumeSessionId?: string;
  primary?: boolean;
}) {
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const style = primary
    ? "bg-brand text-brand-foreground hover:bg-brand-hover"
    : "border border-border hover:bg-surface";

  if (resumeSessionId) {
    return (
      <Link
        href={`/app/workouts/${resumeSessionId}`}
        data-testid="resume-workout"
        className={`rounded-md px-4 py-2 text-sm font-medium ${style}`}
      >
        Resume workout
        <span className="sr-only"> ({label})</span>
      </Link>
    );
  }

  async function start() {
    setBusy(true);
    setError(null);
    key.current ??= `start-${crypto.randomUUID()}`;
    try {
      const res = await startSession(key.current, {
        training_plan_id: planId,
        plan_day_index: dayIndex,
      });
      if (res.ok) {
        router.push(`/app/workouts/${res.data.id}`);
        return; // stay "busy" until the page changes
      }
      setError(
        res.failure === "unavailable"
          ? "We couldn't reach the server. Please try again."
          : "We couldn't start this workout. The plan may have changed; reload the page and try again.",
      );
    } catch {
      setError("We couldn't start this workout. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void start()}
        data-testid="start-workout"
        className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 ${style}`}
      >
        {busy ? "Starting…" : label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
