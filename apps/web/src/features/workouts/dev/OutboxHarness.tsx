"use client";
import type { SessionEvent, SessionSummary } from "@fitpilot/exercise-contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { completeSession, startSession } from "../actions";
import { getOutbox } from "../outbox/browser";

/**
 * Dev-only harness (never in production builds, see /dev layout) that drives the real outbox and
 * server actions without a camera: start a session, log a set by hand, send, complete. The e2e for
 * "offline mid-workout, reload, reconnect, stored once" uses it until the workout runner (M3 S8)
 * offers the same flow to members.
 */
export function OutboxHarness({ sessionId }: { sessionId: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<SessionSummary | null>(null);

  const refresh = () => {
    if (sessionId) void getOutbox().pendingCount(sessionId).then(setPending);
  };
  useEffect(refresh, [sessionId]);

  async function start() {
    const res = await startSession(`dev-start-${crypto.randomUUID()}`);
    if (res.ok) router.replace(`/dev/outbox?session=${res.data.id}`);
    else setMessage(`Could not start: ${res.failure}`);
  }

  async function logSet() {
    if (!sessionId) return;
    const event: SessionEvent = {
      type: "set_logged",
      session_id: sessionId,
      exercise_id: "bodyweight_squat",
      occurred_at: new Date().toISOString(),
      idempotency_key: `dev-set-${crypto.randomUUID()}`,
      set_index: 0,
      reps: 10,
    };
    await getOutbox().enqueue([event]);
    refresh();
  }

  async function send() {
    if (!sessionId) return;
    setMessage(await getOutbox().flush(sessionId));
    refresh();
  }

  async function complete() {
    if (!sessionId) return;
    const outcome = await getOutbox().flush(sessionId);
    if (outcome !== "sent" && outcome !== "empty") {
      setMessage(`Not sent yet (${outcome}); finish once you are back online.`);
      return refresh();
    }
    const res = await completeSession(sessionId, `dev-complete-${sessionId}`);
    if (res.ok) setSummary(res.data);
    else setMessage(`Could not complete: ${res.failure}`);
    refresh();
  }

  const sets = summary?.exercises.flatMap((e) => e.sets) ?? [];
  return (
    <div className="flex flex-col gap-3" data-testid="outbox-harness">
      <p data-testid="harness-session">{sessionId ?? "no session"}</p>
      <p data-testid="harness-pending">{pending === null ? "?" : pending} queued</p>
      <p data-testid="harness-message" role="status">
        {message}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void start()} className="rounded border px-3 py-1">
          Start session
        </button>
        <button type="button" onClick={() => void logSet()} className="rounded border px-3 py-1">
          Log a 10-rep set by hand
        </button>
        <button type="button" onClick={() => void send()} className="rounded border px-3 py-1">
          Send now
        </button>
        <button type="button" onClick={() => void complete()} className="rounded border px-3 py-1">
          Complete workout
        </button>
      </div>
      {summary && (
        <p data-testid="harness-summary">
          {sets.length} sets, {summary.exercises.reduce((n, e) => n + e.total_reps, 0)} reps
        </p>
      )}
    </div>
  );
}
