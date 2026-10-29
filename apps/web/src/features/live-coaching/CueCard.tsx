import { type ActiveCue, explainCue } from "@fitpilot/exercise-rules";
import { useLayoutEffect, useRef } from "react";
import { measurementLines } from "./recording/cue-labels";

const button =
  "rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface disabled:opacity-50";

/**
 * The one cue on screen (FR-06): the rule's message, the measurement that triggered it, "what
 * this means" from the rule's explanation, and Got it / Dismiss. Only ever given
 * `EngineSnapshot.cue` (the cue selector's choice), never an analyzer's raw cues.
 *
 * Latency (NFR: median ≤ 250 ms from processed movement data to a displayed cue): when the card
 * commits, `data-cue-latency-ms` is the time since the analysis result that produced the cue;
 * `data-cue-frame-latency-ms` is the same at the next animation frame, i.e. just before paint.
 */
export function CueCard({
  cue,
  producedAt,
  now,
  onAcknowledge,
  onDismiss,
  onFocusChange,
}: {
  cue: ActiveCue;
  producedAt: number | null;
  now: () => number;
  onAcknowledge: () => void;
  onDismiss: () => void;
  /** whether focus is inside the card, so the page can restore it when the card goes */
  onFocusChange: (inside: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rule = explainCue(cue.message_id);
  const lines = measurementLines(cue.message_id, cue.measurements);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || producedAt === null) return;
    el.dataset.cueLatencyMs = String(Math.round(now() - producedAt));
    const raf = requestAnimationFrame(() => {
      el.dataset.cueFrameLatencyMs = String(Math.round(now() - producedAt));
    });
    return () => cancelAnimationFrame(raf);
  }, [producedAt, now]);

  return (
    <div
      ref={ref}
      data-testid="active-cue"
      data-rule-id={cue.rule_id}
      data-message-id={cue.message_id}
      data-ruleset-version={cue.ruleset_version}
      data-shown-at-ms={Math.round(cue.shown_at_ms)}
      onFocus={() => onFocusChange(true)}
      onBlur={() => onFocusChange(false)}
      className="flex flex-col gap-2 rounded-xl border border-brand p-4"
    >
      <p className="text-sm text-muted">Cue</p>
      <p className="font-semibold" data-testid="cue-message">
        {cue.message}
      </p>
      {lines.length > 0 && (
        <ul className="text-sm" data-testid="cue-measurements">
          {lines.map((m) => (
            <li key={m.key}>
              {m.label}: <span className="font-medium tabular-nums">{m.value}</span>
            </li>
          ))}
        </ul>
      )}
      {rule && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">What this means</summary>
          <p className="mt-1" data-testid="cue-explanation">
            {rule.explanation}
          </p>
        </details>
      )}
      <div role="group" aria-label="Respond to this cue" className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={onAcknowledge}>
          Got it
        </button>
        <button type="button" className={button} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
