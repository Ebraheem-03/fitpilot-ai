import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { ExerciseContract } from "@fitpilot/exercise-contracts";

// Server component: reads the approved exercise catalogue (principle 2: the catalogue is the source of truth).
function loadSquat() {
  const file = join(process.cwd(), "../../data/exercise-catalog/bodyweight_squat.json");
  return ExerciseContract.parse(JSON.parse(readFileSync(file, "utf8")));
}

export default function Home() {
  const squat = loadSquat();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-16 sm:px-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium tracking-wide text-brand uppercase">FitPilot AI</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          See it. Do it. Get grounded feedback.
        </h1>
        <p className="text-muted">
          3D exercise demos, live form feedback grounded in measurements, and AI coaching.
        </p>
        <div className="mt-2 flex gap-3">
          <Link
            href="/sign-up"
            className="rounded-md bg-brand px-4 py-2 font-medium text-brand-foreground hover:bg-brand-hover"
          >
            Create account
          </Link>
          <Link href="/sign-in" className="rounded-md border border-border px-4 py-2 font-medium">
            Sign in
          </Link>
        </div>
      </header>

      <section aria-labelledby="catalogue" className="rounded-xl border border-border p-6">
        <h2 id="catalogue" className="text-lg font-semibold">
          {squat.name} <span className="text-sm text-muted">v{squat.version}</span>
        </h2>
        <p className="mt-1 text-sm text-muted">
          Camera view: {squat.camera_views.join(", ")} · Ruleset v{squat.ruleset_version}
        </p>
        <ol className="mt-4 list-decimal space-y-1 pl-5">
          {squat.instructions.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}
