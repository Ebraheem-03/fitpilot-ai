import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { OutboxHarness } from "@/features/workouts/dev/OutboxHarness";
import { OutboxBoot } from "@/features/workouts/outbox/OutboxBoot";

export const metadata: Metadata = { title: "Outbox harness · FitPilot dev" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Harness({ searchParams }: Pick<PageProps<"/dev/outbox">, "searchParams">) {
  await connection();
  const raw = (await searchParams).session;
  const sessionId = typeof raw === "string" && UUID.test(raw) ? raw : null;
  return (
    <>
      {/* the member shell mounts this on every /app page; the harness stands in for it */}
      <OutboxBoot />
      <OutboxHarness sessionId={sessionId} />
    </>
  );
}

export default function OutboxPage({ searchParams }: PageProps<"/dev/outbox">) {
  return (
    <>
      <h1 className="text-xl font-semibold">Session outbox harness (FR-07)</h1>
      <p className="max-w-3xl text-sm text-muted">
        Developer tool: exercises the on-device outbox and the session server actions without a
        camera.
      </p>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Harness searchParams={searchParams} />
      </Suspense>
    </>
  );
}
