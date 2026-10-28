import { type ExerciseContract, isTracked } from "@fitpilot/exercise-contracts";
import Link from "next/link";
import { ExerciseDemo } from "../exercise-viewer/ExerciseDemo";
import { analyzerFor } from "../live-coaching/analyzers";
import { NO_DEMO_MESSAGE } from "./labels";

type GuideExercise = Pick<
  ExerciseContract,
  "id" | "name" | "animation" | "phases" | "instructions" | "supported_capabilities"
>;

/** Camera tracking needs both the catalogue's say-so and an analyzer shipped in this build. */
export const canTrackLive = (exercise: Pick<ExerciseContract, "id" | "supported_capabilities">) =>
  isTracked(exercise) && analyzerFor(exercise.id) !== undefined;

/**
 * The 3D demonstration when the catalogue has one; otherwise the written steps alone, with a plain
 * "No 3D demo yet" note (not an error: most of the catalogue has no clip until M4). Offers the
 * camera link only for exercises we can actually track.
 */
export function ExerciseGuide({ exercise }: { exercise: GuideExercise }) {
  const { animation } = exercise;
  return (
    <>
      {animation ? (
        <ExerciseDemo exercise={{ ...exercise, animation }} />
      ) : (
        <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
          <p
            data-testid="no-demo"
            className="rounded-xl border border-dashed border-border p-5 text-muted"
          >
            {NO_DEMO_MESSAGE}
          </p>
          <h2 id="steps-heading" className="font-semibold">
            How to do it
          </h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5" data-testid="exercise-steps">
            {exercise.instructions.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ol>
        </section>
      )}
      {canTrackLive(exercise) && (
        <Link
          href={`/app/exercises/${exercise.id}/live`}
          className="self-start rounded-md bg-brand px-4 py-2 font-medium text-brand-foreground hover:bg-brand-hover"
        >
          Track your reps with the camera
        </Link>
      )}
    </>
  );
}
