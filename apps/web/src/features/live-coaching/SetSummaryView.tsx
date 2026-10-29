import { explainCue } from "@fitpilot/exercise-rules";
import { DEGRADED_LABELS, formatDuration, measurementLines } from "./recording/cue-labels";
import type { SetSummary } from "./recording/summary";

const RESPONSE_TEXT = {
  acknowledged: "You marked this “Got it”.",
  dismissed: "You dismissed this.",
} as const;

/**
 * Post-set summary (FR-06), rendered from `summariseSet(recorded events)` only. Every cue shows
 * its rule id and version and the measurements that triggered it, so it can be traced (FR-06
 * acceptance); nothing here adds advice of its own.
 */
export function SetSummaryView({
  summary,
  targetReps,
}: {
  summary: SetSummary;
  targetReps?: number;
}) {
  return (
    <section
      aria-labelledby="set-summary-heading"
      data-testid="set-summary"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <h3 id="set-summary-heading" className="font-semibold">
        Set summary
      </h3>
      <p data-testid="summary-reps">
        {summary.reps} {summary.reps === 1 ? "rep" : "reps"}
        {targetReps ? ` of ${targetReps}` : ""} counted while tracking was reliable.
      </p>

      <div>
        <h4 className="text-sm font-semibold">Cues</h4>
        {summary.cues.length === 0 ? (
          <p className="text-sm">No cues were shown in this set.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm" data-testid="summary-cues">
            {summary.cues.map((cue) => (
              <li
                key={cue.shown_at + cue.rule_id}
                data-rule-id={cue.rule_id}
                data-response={cue.response ?? "none"}
                className="rounded-md border border-border p-2"
              >
                <p className="font-medium">
                  {explainCue(cue.message_id)?.message ?? "A cue was shown."}
                </p>
                <ul>
                  {measurementLines(cue.message_id, cue.measurements).map((m) => (
                    <li key={m.key}>
                      {m.label}: {m.value}
                    </li>
                  ))}
                </ul>
                <p className="text-muted">
                  {cue.response ? RESPONSE_TEXT[cue.response] : "No response."} Rule {cue.rule_id},
                  version {cue.ruleset_version}.
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-sm font-semibold">Tracking</h4>
        {summary.tracking_degraded.length === 0 ? (
          <p className="text-sm">No tracking interruptions longer than a second.</p>
        ) : (
          <>
            <p className="text-sm">
              Tracking wasn&apos;t reliable for {formatDuration(summary.degraded_ms)}. Reps and cues
              were paused during these times:
            </p>
            <ul className="list-disc pl-5 text-sm" data-testid="summary-tracking">
              {summary.tracking_degraded.map((span) => (
                <li key={span.started_at} data-reason={span.reason}>
                  {DEGRADED_LABELS[span.reason]} — {formatDuration(span.duration_ms)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
