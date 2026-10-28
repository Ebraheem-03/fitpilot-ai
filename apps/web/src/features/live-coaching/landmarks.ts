import {
  type LandmarkFixture,
  type LandmarkName,
  LANDMARK_NAMES,
  MEDIAPIPE_POSE_INDEX,
} from "@fitpilot/exercise-contracts";
import type { LandmarkFrame } from "@fitpilot/exercise-rules";
import { LANDMARK_STRIDE, POSE_LANDMARK_COUNT } from "./worker/protocol";

/**
 * Worker output (33 × normalised x,y,z,visibility) → the named frame `exercise-rules` analyses,
 * with x rescaled by the video's aspect ratio (image-height units, see `LandmarkFrame`).
 */
export function toLandmarkFrame(raw: Float32Array, aspect: number): LandmarkFrame {
  const frame: LandmarkFrame = {};
  for (const name of LANDMARK_NAMES) {
    const o = MEDIAPIPE_POSE_INDEX[name] * LANDMARK_STRIDE;
    frame[name] = {
      x: raw[o]! * aspect,
      y: raw[o + 1]!,
      z: raw[o + 2]! * aspect, // MediaPipe z uses x's (width) scale
      visibility: raw[o + 3]!,
    };
  }
  return frame;
}

/** A required landmark the model placed outside the image (the body is cut off). */
export function isOutOfFrame(
  frame: LandmarkFrame,
  required: readonly LandmarkName[],
  aspect: number,
): boolean {
  return required.some((name) => {
    const p = frame[name];
    return !p || p.x < 0 || p.x > aspect || p.y < 0 || p.y > 1;
  });
}

/** Packed fixture frame → 33-point worker layout (unnamed points stay zero / invisible). */
export function unpackFixtureFrame(fixture: LandmarkFixture, index: number): Float32Array | null {
  const p = fixture.frames[index]?.p;
  if (!p) return null;
  const out = new Float32Array(POSE_LANDMARK_COUNT * LANDMARK_STRIDE);
  fixture.landmark_names.forEach((name, i) => {
    out.set(
      p.slice(i * LANDMARK_STRIDE, (i + 1) * LANDMARK_STRIDE),
      MEDIAPIPE_POSE_INDEX[name] * LANDMARK_STRIDE,
    );
  });
  return out;
}
