"use client";

import { useEffect, useRef, useState } from "react";
import { formatClock } from "./labels";

/**
 * Rest between sets (FR-07). Counts down from `seconds`, can be skipped, and calls `onDone` once
 * (at zero or on skip). The ticking number is not a live region: it would be read out every
 * second. The state change at zero is announced instead.
 */
export function RestTimer({
  seconds,
  nextLabel,
  onDone,
}: {
  seconds: number;
  nextLabel: string;
  onDone: () => void;
}) {
  const [endsAt] = useState(() => Date.now() + seconds * 1000);
  const [left, setLeft] = useState(seconds);
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    const id = setInterval(() => {
      // wall-clock based: a throttled background tab catches up instead of lagging
      setLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current();
  };
  useEffect(() => {
    if (left <= 0) finish();
  }, [left]);

  return (
    <section
      aria-labelledby="rest-heading"
      data-testid="rest-timer"
      className="flex flex-col gap-3 rounded-xl border border-border p-5"
    >
      <h2 id="rest-heading" className="text-lg font-semibold">
        Rest
      </h2>
      <p role="timer" aria-live="off" className="text-4xl font-semibold tabular-nums">
        {formatClock(left)}
      </p>
      <p className="text-muted">Next: {nextLabel}</p>
      <div>
        <button
          type="button"
          onClick={finish}
          className="rounded-md border border-border px-4 py-2 font-medium hover:bg-surface"
        >
          Skip rest
        </button>
      </div>
    </section>
  );
}
