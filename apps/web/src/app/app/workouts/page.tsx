import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { HistoryList } from "@/features/workouts/HistoryList";
import { getMe, listWorkoutSessions } from "@/lib/api";

export const metadata: Metadata = { title: "Your workouts · FitPilot AI" };

const PAGE_SIZE = 10;

async function History({ searchParams }: Pick<PageProps<"/app/workouts">, "searchParams">) {
  await connection();
  const raw = (await searchParams).page;
  const page = Math.max(1, Number.parseInt(typeof raw === "string" ? raw : "1", 10) || 1);
  const [me, result] = await Promise.all([
    getMe(),
    listWorkoutSessions(PAGE_SIZE, (page - 1) * PAGE_SIZE),
  ]);

  const hasNewer = page > 1;
  const hasOlder = page * PAGE_SIZE < result.total;
  return (
    <>
      <HistoryList userId={me.id} sessions={result.items} />
      {(hasNewer || hasOlder) && (
        <nav aria-label="Workout pages" className="flex gap-4 text-sm font-medium">
          {hasNewer && (
            <Link href={`/app/workouts?page=${page - 1}`} className="underline">
              Newer workouts
            </Link>
          )}
          {hasOlder && (
            <Link href={`/app/workouts?page=${page + 1}`} className="underline">
              Older workouts
            </Link>
          )}
        </nav>
      )}
    </>
  );
}

export default function WorkoutsPage({ searchParams }: PageProps<"/app/workouts">) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your workouts</h1>
        <p className="mt-1 text-muted">
          Every workout you started, newest first. Open one to see what was saved.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <History searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
