import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { NeedsReviewNotice } from "@/features/plans/NeedsReviewNotice";
import { PlanView } from "@/features/plans/PlanView";
import { STATUS_LABELS } from "@/features/plans/labels";
import { listExercises } from "@/lib/api";
import { getPlan } from "@/lib/api-plans";
import { buildExerciseIndex } from "../../_lib/exercise-index";

export const metadata: Metadata = { title: "Plan version · FitPilot AI" };

async function PlanVersion({ params }: Pick<PageProps<"/app/plan/[id]">, "params">) {
  await connection();
  const resource = await getPlan((await params).id);
  if (!resource) notFound();
  const catalogue = resource.plan ? await listExercises() : [];

  return (
    <article className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Plan version {resource.version}</h1>
        <p className="mt-1 text-muted" data-testid="plan-status">
          {STATUS_LABELS[resource.status]} · created{" "}
          {new Date(resource.created_at).toLocaleDateString("en", { dateStyle: "long" })}
        </p>
        {resource.status === "superseded" && (
          <p className="mt-2">
            This is an earlier version.{" "}
            <Link href="/app/plan" className="font-medium underline">
              Go to your current plan
            </Link>
          </p>
        )}
      </header>
      {resource.plan ? (
        <PlanView plan={resource.plan} exercises={buildExerciseIndex(catalogue)} />
      ) : (
        <NeedsReviewNotice issues={resource.validation_issues} />
      )}
    </article>
  );
}

export default function PlanVersionPage({ params }: PageProps<"/app/plan/[id]">) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/app/plan" className="text-sm font-medium text-muted hover:text-foreground">
        ← Your plan
      </Link>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <PlanVersion params={params} />
      </Suspense>
    </div>
  );
}
