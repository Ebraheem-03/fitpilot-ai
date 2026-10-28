import { join } from "node:path";

/** Synthetic camera feed for the live-coaching e2e (ADR-0010 §8); generated, gitignored. */
export const FAKE_CAMERA_Y4M = join(__dirname, ".generated", "mannequin-squat.y4m");

/**
 * 10 s standing (covers model download + warm-up on a cold CI dev server), then 6 squat loops of
 * 4 s; loop 3 shows an empty room. Ground truth: 5 reps.
 */
export const FEED_PLAN = {
  width: 320,
  height: 240,
  fps: 15,
  leadInMs: 10_000,
  loops: 6,
  hiddenLoops: [3],
};
export const FEED_REPS = 5;
