"use client";
import { flushBeforeSignOut } from "../workouts/outbox/browser";
import { clearAllStoredProgress } from "../workouts/useStoredProgress";
import { signOut } from "./actions";

/** Tries to send the member's queued workout data first (best effort), then signs out. */
export function SignOutButton({ userId }: { userId?: string }) {
  async function action() {
    if (userId) {
      await flushBeforeSignOut(userId);
      clearAllStoredProgress(userId); // workout progress kept on this device goes with the session
    }
    await signOut();
  }
  return (
    <form action={action}>
      <button
        type="submit"
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Sign out
      </button>
    </form>
  );
}
