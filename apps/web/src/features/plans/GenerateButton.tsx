"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { generatePlanAction } from "./actions";
import { IDLE, type GenerateState } from "./generate-state";
import { errorMessage } from "./labels";

/** Seconds the button stays disabled after a "busy" reply, from the server's Retry-After. */
function useCooldown(state: GenerateState): number {
  const initial = state.status === "error" ? (state.retryAfterS ?? 0) : 0;
  const [seen, setSeen] = useState(state);
  const [remaining, setRemaining] = useState(initial);
  if (seen !== state) {
    // New server reply: restart the cooldown while rendering (no effect needed).
    setSeen(state);
    setRemaining(initial);
  }
  const counting = remaining > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [counting, seen]);
  return remaining;
}

/**
 * Generate / Regenerate. One idempotency key per intent: it is created on the first click and kept
 * until a plan was actually returned, so retrying after a failure or a dropped connection cannot
 * create two plans, while a deliberate second regeneration gets a fresh key.
 */
export function GenerateButton({ hasPlan }: { hasPlan: boolean }) {
  const [state, formAction, pending] = useActionState(generatePlanAction, IDLE);
  const key = useRef<string | null>(null);
  const cooldown = useCooldown(state);

  function submit(form: FormData) {
    if (state.status === "done" || key.current === null) key.current = crypto.randomUUID();
    form.set("idempotency_key", key.current);
    formAction(form);
  }

  const label = hasPlan ? "Regenerate plan" : "Generate my plan";
  const blocked = pending || cooldown > 0;

  return (
    <form action={submit} className="flex flex-col gap-3" aria-busy={pending}>
      <div>
        <button
          type="submit"
          disabled={blocked}
          className="rounded-md bg-brand px-4 py-2 font-medium text-brand-foreground hover:bg-brand-hover disabled:opacity-60"
        >
          {pending
            ? "Building your plan…"
            : cooldown > 0
              ? `${label} (available in ${cooldown} s)`
              : label}
        </button>
      </div>
      <div role="status" aria-live="polite" data-testid="generate-status">
        {pending && (
          <p className="text-muted">The coach is working on it. This can take a moment.</p>
        )}
        {!pending && state.status === "done" && <DoneMessage state={state} />}
        {!pending && state.status === "error" && <ErrorMessage state={state} />}
      </div>
    </form>
  );
}

function DoneMessage({ state }: { state: Extract<GenerateState, { status: "done" }> }) {
  if (state.planStatus === "needs_review") {
    return (
      <p data-testid="generate-needs-review">
        The new plan was saved for a trainer to check. Your current plan, if you have one, stays as
        it is.{" "}
        <Link href={`/app/plan/${state.planId}`} className="font-medium underline">
          See why
        </Link>
      </p>
    );
  }
  return (
    <p data-testid="generate-done">
      {state.replayed ? "That plan was already created." : "Your new plan is ready"} (version{" "}
      {state.version}).
    </p>
  );
}

function ErrorMessage({ state }: { state: Extract<GenerateState, { status: "error" }> }) {
  const message = errorMessage(state.code, state.retryAfterS);
  return (
    <p data-testid={`generate-error-${state.code}`} className="text-danger">
      {message.title}{" "}
      {message.link && (
        <Link href={message.link.href} className="font-medium underline">
          {message.link.label}
        </Link>
      )}
    </p>
  );
}
