import type { TrainingPlanResource } from "@fitpilot/exercise-contracts";
import Link from "next/link";
import { STATUS_LABELS } from "./labels";

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

/** Every version of the member's plan, newest first (FR-02: current plan and previous versions). */
export function PlanVersions({ plans }: { plans: TrainingPlanResource[] }) {
  if (plans.length === 0) return null;
  return (
    <section aria-labelledby="versions-heading" className="flex flex-col gap-2">
      <h2 id="versions-heading" className="text-lg font-semibold">
        Plan versions
      </h2>
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {plans.map((plan) => (
          <li key={plan.id} data-testid="plan-version" data-plan-status={plan.status}>
            <Link
              href={`/app/plan/${plan.id}`}
              className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-surface"
            >
              <span className="font-medium">Version {plan.version}</span>
              <span className="text-sm text-muted">
                {STATUS_LABELS[plan.status]} · {date.format(new Date(plan.created_at))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
