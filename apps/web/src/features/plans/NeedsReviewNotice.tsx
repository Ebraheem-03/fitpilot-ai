import type { PlanValidationIssue } from "@fitpilot/exercise-contracts";
import { ISSUE_EXPLANATIONS, NEEDS_REVIEW_HEADLINE } from "./labels";

/**
 * A generated plan the validator rejected after one repair. The draft itself is never shown
 * (the API returns `plan: null`); the member sees why in plain words, and the validator's own
 * wording as detail.
 */
export function NeedsReviewNotice({ issues }: { issues: PlanValidationIssue[] }) {
  const codes = [...new Set(issues.map((i) => i.code))];
  return (
    <section
      aria-labelledby="needs-review-heading"
      data-testid="needs-review"
      className="rounded-xl border border-border bg-surface p-5"
    >
      <h2 id="needs-review-heading" className="font-semibold">
        {NEEDS_REVIEW_HEADLINE}
      </h2>
      <p className="mt-1 text-muted">
        The plan the coach drafted did not pass our safety and fit checks, so we are not showing it.
        Nothing has been made up to replace it.
      </p>
      <h3 className="mt-3 text-sm font-semibold">What the checks found</h3>
      <ul className="mt-1 list-disc pl-5" data-testid="needs-review-issues">
        {codes.map((code) => (
          <li key={code}>{ISSUE_EXPLANATIONS[code]}</li>
        ))}
      </ul>
      <details className="mt-3 text-sm text-muted">
        <summary className="cursor-pointer">Details from the checks</summary>
        <ul className="mt-1 list-disc pl-5">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`}>{issue.message}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
