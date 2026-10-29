import { join } from "node:path";
import {
  type FeedPlan,
  SHALLOW_MOTION,
} from "../../src/features/live-coaching/bench/feed-timeline";

/** Synthetic camera feeds for the live-coaching e2e (ADR-0010 §8); generated, gitignored. */
export const FAKE_CAMERA_Y4M = join(__dirname, ".generated", "mannequin-squat.y4m");

/**
 * 10 s standing (covers model download + warm-up on a cold CI dev server), then 6 squat loops of
 * 4 s; loop 3 shows an empty room. Ground truth: 5 reps, all full depth (no cue).
 */
export const FEED_PLAN: FeedPlan = {
  width: 320,
  height: 240,
  fps: 15,
  leadInMs: 10_000,
  loops: 6,
  hiddenLoops: [3],
};
export const FEED_REPS = 5;

export const SHALLOW_CAMERA_Y4M = join(__dirname, ".generated", "mannequin-shallow-squat.y4m");

/**
 * The cue feed (live-cues.spec.ts): 10 s standing, then 7 shallow squats of 3.5 s down to a knee
 * angle of about 130° (`SHALLOW_MOTION`: counted, and `squat.depth.shallow` fires); loop 1 shows
 * an empty room. Ground truth: 6 reps. With the cue selector's 20 s cooldown, the depth cue is
 * shown on rep 1 (and withdrawn when the room empties a second later) and again on the last rep
 * (21 s later).
 */
export const SHALLOW_FEED_PLAN: FeedPlan = {
  width: 320,
  height: 240,
  fps: 15,
  leadInMs: 10_000,
  loops: 7,
  hiddenLoops: [1],
  motion: SHALLOW_MOTION,
};
export const SHALLOW_FEED_REPS = 6;

export const FEEDS = [
  { path: FAKE_CAMERA_Y4M, plan: FEED_PLAN },
  { path: SHALLOW_CAMERA_Y4M, plan: SHALLOW_FEED_PLAN },
];
