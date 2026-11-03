import type { ExerciseSummary, SessionSummary } from "@fitpilot/exercise-contracts";
import { explainCue } from "@fitpilot/exercise-rules";
import {
  DEGRADED_LABELS,
  formatDuration,
  measurementLines,
} from "../live-coaching/recording/cue-labels";
import { formatDateTime, formatSpan, MEDICAL_NOTE, SKIP_SUMMARY } from "./labels";

const RESPONSE_TEXT = {
  acknowledged: "You marked this “Got it”.",
  dismissed: "You dismissed this.",
} as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A saved workout (FR-07), rendered from the server's `SessionSummary` only: what the member
 * did per exercise, which sets the camera counted, every cue with the rule and measurements
 * behind it (FR-06 traceability) and the spans where tracking wasn't reliable. Cue wording and
 * explanations come from `explainCue`; nothing here adds advice of its own.
 */
export function SummaryView({
  summary,
  names,
}: {
  summary: SessionSummary;
  /** exercise id → display name */
  names: Readonly<Record<string, string>>;
}) {
  const done = summary.exercises.filter((e) => e.status === "completed").length;
  const skipped = summary.exercises.length - done;
  const length = formatSpan(summary.started_at, summary.completed_at);
  return (
    <div className="flex flex-col gap-6" data-testid="session-summary">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        {summary.completed_at && (
          <>
            <dt className="text-muted">Finished</dt>
            <dd className="font-medium">{formatDateTime(summary.completed_at)}</dd>
          </>
        )}
        {length && (
          <>
            <dt className="text-muted">Length</dt>
            <dd className="font-medium">{length}</dd>
          </>
        )}
        <dt className="text-muted">Exercises</dt>
        <dd className="font-medium" data-testid="summary-counts">
          {done} done{skipped > 0 ? `, ${skipped} skipped` : ""}
        </dd>
        {summary.perceived_difficulty !== null && (
          <>
            <dt className="text-muted">How hard it felt</dt>
            <dd className="font-medium" data-testid="summary-difficulty">
              {summary.perceived_difficulty} out of 10
            </dd>
          </>
        )}
        {summary.note && (
          <>
            <dt className="text-muted">Your note</dt>
            <dd className="font-medium" data-testid="summary-note">
              {summary.note}
            </dd>
          </>
        )}
      </dl>

      {summary.exercises.length === 0 ? (
        <p
          data-testid="summary-empty"
          className="rounded-xl border border-dashed border-border p-5"
        >
          No exercises were recorded in this workout.
        </p>
      ) : (
        summary.exercises.map((exercise) => (
          <ExerciseSection
            key={exercise.exercise_id}
            exercise={exercise}
            name={names[exercise.exercise_id] ?? exercise.exercise_id.replaceAll("_", " ")}
          />
        ))
      )}
      <p className="text-sm text-muted">{MEDICAL_NOTE}</p>
    </div>
  );
}

function ExerciseSection({ exercise, name }: { exercise: ExerciseSummary; name: string }) {
  const headingId = `summary-${exercise.exercise_id}`;
  const completed = exercise.status === "completed";
  const total =
    exercise.prescription === "reps"
      ? plural(exercise.total_reps, "rep")
      : `${exercise.total_duration_s} s`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid="summary-exercise"
      data-exercise-id={exercise.exercise_id}
      data-status={exercise.status}
      data-tracked={exercise.tracked}
      className="flex flex-col gap-3 rounded-xl border border-border p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {name}
        </h2>
        <p className="text-sm text-muted">
          {completed
            ? "Completed"
            : `Skipped${exercise.skip_reason ? ` (${SKIP_SUMMARY[exercise.skip_reason]})` : ""}`}
          {" · "}
          <span data-testid="summary-tracked">
            {exercise.tracked ? "Camera-tracked" : "Logged by hand"}
          </span>
        </p>
      </div>

      {completed && (
        <>
          <ol aria-label={`Sets of ${name}`} className="flex flex-col gap-1">
            {exercise.sets.map((set, i) => (
              <li key={set.set_index} data-testid="summary-set" data-source={set.source}>
                Set {i + 1}:{" "}
                <span className="font-medium">
                  {set.reps !== null ? plural(set.reps, "rep") : `${set.duration_s ?? 0} s`}
                </span>{" "}
                <span className="text-muted">
                  ({set.source === "tracked" ? "counted by the camera" : "logged by hand"})
                  {set.perceived_difficulty !== null
                    ? ` · felt ${set.perceived_difficulty} out of 10`
                    : ""}
                </span>
              </li>
            ))}
          </ol>
          <p data-testid="summary-total">Total: {total}</p>
        </>
      )}
      {exercise.note && (
        <p>
          <span className="text-muted">Your note: </span>
          {exercise.note}
        </p>
      )}

      {exercise.tracked && (
        <>
          <div>
            <h3 className="text-sm font-semibold">Coaching cues</h3>
            {exercise.cues.length === 0 ? (
              <p className="text-sm">No cues were shown.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-2 text-sm" data-testid="summary-cues">
                {exercise.cues.map((cue, i) => {
                  const rule = explainCue(cue.message_id);
                  return (
                    <li
                      key={`${cue.shown_at}-${i}`}
                      data-testid="summary-cue"
                      data-rule-id={cue.rule_id}
                      data-message-id={cue.message_id}
                      data-ruleset-version={cue.ruleset_version}
                      data-response={cue.response ?? "none"}
                      className="rounded-md border border-border p-3"
                    >
                      <p className="font-medium">{rule?.message ?? "A cue was shown."}</p>
                      {rule && <p className="text-muted">{rule.explanation}</p>}
                      <ul>
                        {measurementLines(cue.message_id, cue.measurements).map((m) => (
                          <li key={m.key}>
                            {m.label}: <span className="font-medium">{m.value}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-muted">
                        {cue.response ? RESPONSE_TEXT[cue.response] : "No response."} Rule{" "}
                        {cue.rule_id}, version {cue.ruleset_version}.
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold">Tracking</h3>
            {exercise.tracking_degraded.length === 0 ? (
              <p className="text-sm">Tracking stayed reliable.</p>
            ) : (
              <ul className="mt-1 list-disc pl-5 text-sm" data-testid="summary-tracking">
                {exercise.tracking_degraded.map((span, i) => (
                  <li key={`${span.started_at}-${i}`} data-reason={span.reason}>
                    {DEGRADED_LABELS[span.reason]}: {formatDuration(span.duration_ms)}. Reps and
                    cues were paused.
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
