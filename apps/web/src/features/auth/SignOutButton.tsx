"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { discardOutbox, flushBeforeSignOut } from "../workouts/outbox/browser";
import { clearAllStoredProgress } from "../workouts/useStoredProgress";
import { signOut } from "./actions";

const buttonClass =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

/**
 * Tries to send the member's queued workout data first (best effort). If some could not be sent,
 * asks whether to keep it on this device for next sign-in or discard it, so a shared device is
 * never left holding a workout the member didn't decide to leave there. Without `userId` (the
 * session-expired page, the layout's loading fallback) there is nothing on the device to ask about.
 */
export function SignOutButton({ userId, disabled }: { userId?: string; disabled?: boolean }) {
  const [unsent, setUnsent] = useState<number | null>(null);
  const [busy, startTransition] = useTransition();
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (unsent !== null) keepRef.current?.focus();
  }, [unsent]);

  function begin(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      if (userId) {
        const { pending } = await flushBeforeSignOut(userId);
        if (pending > 0) {
          setUnsent(pending);
          return;
        }
      }
      await finish(false);
    });
  }

  async function finish(discard: boolean) {
    if (userId) {
      if (discard) await discardOutbox(userId);
      clearAllStoredProgress(userId); // workout progress kept on this device goes with the session
    }
    await signOut();
  }

  return (
    <div className="relative">
      <form onSubmit={begin}>
        <button
          type="submit"
          disabled={disabled || busy || unsent !== null}
          className={buttonClass}
        >
          Sign out
        </button>
      </form>
      {unsent !== null && (
        <div
          role="alertdialog"
          aria-labelledby="unsent-title"
          data-testid="unsent-choice"
          className="absolute top-full right-0 z-20 mt-2 flex w-72 flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-lg"
        >
          <p id="unsent-title" className="text-sm">
            {unsent} workout {unsent === 1 ? "item hasn't" : "items haven't"} been sent yet. Keep
            {unsent === 1 ? " it" : " them"} on this device to send next time you sign in, or
            discard {unsent === 1 ? "it" : "them"}?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              ref={keepRef}
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => startTransition(() => finish(false))}
            >
              Keep on this device
            </button>
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => startTransition(() => finish(true))}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
