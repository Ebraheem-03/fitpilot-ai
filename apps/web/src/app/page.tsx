import { readFileSync } from "node:fs";
import { join } from "node:path";
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
        <p className="text-sm font-medium tracking-wide text-emerald-600 uppercase">FitPilot AI</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          See it. Do it. Get grounded feedback.
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Scaffold is running. Next milestone: 3D squat demo + live pose tracking (M1–M2).
        </p>
      </header>

      <section
        aria-labelledby="catalogue"
        className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800"
      >
        <h2 id="catalogue" className="text-lg font-semibold">
          {squat.name} <span className="text-sm text-zinc-500">v{squat.version}</span>
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
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
