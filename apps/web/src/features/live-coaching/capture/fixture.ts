import {
  type ClipLabels,
  type ExerciseAnimation,
  FIXTURE_FORMAT_VERSION,
  LANDMARK_NAMES,
  type LandmarkFixture,
  MEDIAPIPE_POSE_INDEX,
} from "@fitpilot/exercise-contracts";
import { LANDMARK_STRIDE, type PoseModel } from "../worker/protocol";

/** Matches the vendored runtime (scripts/vendor-mediapipe.mjs copies it from this package). */
export const TASKS_VISION_VERSION = "1.1.1";

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** 33-point worker output → our named landmarks, packed per the fixture format. */
export function packLandmarks(raw: Float32Array | null): number[] | null {
  if (!raw) return null;
  const out: number[] = [];
  for (const name of LANDMARK_NAMES) {
    const o = MEDIAPIPE_POSE_INDEX[name] * LANDMARK_STRIDE;
    for (let k = 0; k < LANDMARK_STRIDE; k++) out.push(round4(raw[o + k]!));
  }
  return out;
}

export interface CapturedFrame {
  tMs: number;
  landmarks: Float32Array | null;
}

export function buildLandmarkFixture(input: {
  clipId: string;
  exerciseId: string;
  kind: "recording" | "synthetic";
  model: PoseModel;
  width: number;
  height: number;
  fps: number;
  frames: CapturedFrame[];
}): LandmarkFixture {
  return {
    format_version: FIXTURE_FORMAT_VERSION,
    clip_id: input.clipId,
    exercise_id: input.exerciseId,
    source: {
      kind: input.kind,
      model: `pose_landmarker_${input.model}`,
      tasks_vision_version: TASKS_VISION_VERSION,
      width: input.width,
      height: input.height,
      fps: input.fps,
    },
    landmark_names: [...LANDMARK_NAMES],
    frames: input.frames.map((f) => ({ t_ms: Math.round(f.tMs), p: packLandmarks(f.landmarks) })),
  };
}

/**
 * Ground truth for the synthetic mannequin clip: the catalogue's phase timeline defines exactly
 * when each looped rep starts, bottoms out and ends. Blank loops (mannequin hidden) become
 * untrackable spans with no rep.
 */
export function mannequinLabels(input: {
  clipId: string;
  exerciseId: string;
  animation: ExerciseAnimation;
  loops: number;
  blankLoops: number[];
  /** front-on is outside the squat's supported setup: every count is a false positive */
  view?: "side" | "front";
}): ClipLabels {
  const { phases, duration_s } = input.animation;
  const find = (phase: string) => {
    const span = phases.find((p) => p.phase === phase);
    if (!span) throw new Error(`animation has no "${phase}" phase`);
    return span;
  };
  const descending = find("descending");
  const bottom = find("bottom");
  const ascending = find("ascending");
  const loopMs = duration_s * 1000;
  const reps: ClipLabels["reps"] = [];
  const untrackable: [number, number][] = [];
  for (let i = 0; i < input.loops; i++) {
    const t0 = i * loopMs;
    if (input.blankLoops.includes(i)) {
      untrackable.push([t0, t0 + loopMs]);
      continue;
    }
    reps.push({
      start_ms: Math.round(t0 + descending.start_s * 1000),
      bottom_ms: Math.round(t0 + ((bottom.start_s + bottom.end_s) / 2) * 1000),
      end_ms: Math.round(t0 + ascending.end_s * 1000),
      full_depth: true,
    });
  }
  return {
    format_version: FIXTURE_FORMAT_VERSION,
    clip_id: input.clipId,
    exercise_id: input.exerciseId,
    camera_view: input.view ?? "side",
    facing: input.view === "front" ? "camera" : "left",
    supported: (input.view ?? "side") === "side",
    conditions: {
      lighting: "normal",
      clothing: "fitted",
      notes: "generated M1 mannequin (ADR-0009)",
    },
    reps,
    untrackable_ranges_ms: untrackable,
    annotated_by: "generated",
  };
}
