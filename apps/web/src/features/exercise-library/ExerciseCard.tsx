import type { ExerciseContract } from "@fitpilot/exercise-contracts";
import Link from "next/link";
import { canTrackLive } from "./ExerciseGuide";
import { exerciseTags, listLabel } from "./labels";

type CardExercise = Pick<
  ExerciseContract,
  | "id"
  | "name"
  | "target_muscles"
  | "equipment"
  | "prescription"
  | "animation"
  | "supported_capabilities"
>;

/** One library entry. Says plainly what is and is not available for the exercise. */
export function ExerciseCard({ exercise }: { exercise: CardExercise }) {
  return (
    <Link
      href={`/app/exercises/${exercise.id}`}
      className="flex h-full flex-col gap-2 rounded-xl border border-border p-5 hover:border-brand"
    >
      <span className="text-lg font-semibold">{exercise.name}</span>
      <span className="text-sm text-muted">Works: {listLabel(exercise.target_muscles, "—")}</span>
      <span className="text-sm text-muted">
        Equipment: {listLabel(exercise.equipment, "None (bodyweight)")}
      </span>
      <ul aria-label="What's available" className="mt-1 flex flex-wrap gap-2 text-xs">
        {exerciseTags(exercise, canTrackLive(exercise)).map((tag) => (
          <li key={tag} className="rounded-full border border-border px-2 py-0.5 text-muted">
            {tag}
          </li>
        ))}
      </ul>
    </Link>
  );
}
