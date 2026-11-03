"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { WorkoutSessionBrief } from "@/lib/api-types";
import { deleteSession } from "./actions";
import { formatDateTime } from "./labels";
import { clearStoredProgress } from "./useStoredProgress";

/**
 * The member's workouts, newest first, with an in-page confirmation before anything is deleted
 * (deleting removes the session's events and summary, ADR-0011 §5).
 */
export function HistoryList({ sessions }: { sessions: WorkoutSessionBrief[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const messageRef = useRef<HTMLParagraphElement>(null);

  async function remove(id: string) {
    setBusy(true);
    setFailed(false);
    const res = await deleteSession(id).catch(() => null);
    setBusy(false);
    // A workout that is already gone is as good as deleted.
    if (res && (res.ok || res.failure === "session_not_found")) {
      clearStoredProgress(id);
      setConfirming(null);
      setMessage("Workout deleted.");
      router.refresh();
      // the row (and the button that had focus) is gone: land on the confirmation
      requestAnimationFrame(() => messageRef.current?.focus());
    } else {
      setFailed(true);
      setMessage("We couldn't delete that workout. Please try again.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p
        role="status"
        ref={messageRef}
        tabIndex={-1}
        data-testid="history-message"
        className={failed ? "text-danger" : ""}
      >
        {message}
      </p>
      {sessions.length === 0 && (
        <p data-testid="no-workouts" className="rounded-xl border border-dashed border-border p-5">
          You haven&apos;t done a workout yet.{" "}
          <Link href="/app/plan" className="font-medium underline">
            Start one from your plan
          </Link>
          .
        </p>
      )}
      <ul
        className={
          sessions.length === 0
            ? "hidden"
            : "flex flex-col divide-y divide-border rounded-xl border border-border"
        }
      >
        {sessions.map((s) => {
          const done = s.status === "completed";
          const asking = confirming === s.id;
          return (
            <li
              key={s.id}
              data-testid="workout-item"
              data-status={s.status}
              data-session-id={s.id}
              className="flex flex-col gap-2 px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={done ? `/app/workouts/${s.id}/summary` : `/app/workouts/${s.id}`}
                  className="font-medium underline"
                >
                  {formatDateTime(s.started_at)}
                  <span className="sr-only">: {done ? "view summary" : "resume workout"}</span>
                </Link>
                <span className="text-sm text-muted">
                  {done ? "Completed" : "In progress"}
                  {s.perceived_difficulty !== null ? ` · felt ${s.perceived_difficulty}/10` : ""}
                </span>
              </div>
              {asking ? (
                <div
                  role="group"
                  aria-label="Confirm delete"
                  data-testid="delete-confirm"
                  className="flex flex-col gap-2 rounded-md border border-danger p-3"
                >
                  <p className="text-sm">
                    Delete this workout and everything saved with it? This can&apos;t be undone.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(s.id)}
                      className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-background disabled:opacity-60"
                    >
                      {busy ? "Deleting…" : "Delete workout"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setConfirming(null);
                        requestAnimationFrame(() => deleteButtons.current.get(s.id)?.focus());
                      }}
                      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface"
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) deleteButtons.current.set(s.id, el);
                      else deleteButtons.current.delete(s.id);
                    }}
                    onClick={() => {
                      setMessage(null);
                      setConfirming(s.id);
                    }}
                    className="text-sm font-medium text-muted underline hover:text-foreground"
                  >
                    Delete
                    <span className="sr-only"> workout from {formatDateTime(s.started_at)}</span>
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
