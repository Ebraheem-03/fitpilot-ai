import { type LandmarkName, MEDIAPIPE_POSE_INDEX } from "@fitpilot/exercise-contracts";
import type { SessionFailure, SessionState } from "./engine/session";
import type { TrackingSnapshot } from "./engine/tracking";
import { LANDMARK_STRIDE } from "./worker/protocol";

export const FAILURE_MESSAGES: Record<SessionFailure, { title: string; detail: string }> = {
  denied: {
    title: "Camera access was blocked.",
    detail:
      "Allow camera access for this site in your browser's address bar or settings, then try again.",
  },
  unsupported: {
    title: "This browser can't use the camera here.",
    detail:
      "Use a current version of Chrome, Edge, Firefox or Safari over a secure (https) connection.",
  },
  no_camera: {
    title: "No camera was found.",
    detail: "Connect a camera, or use a device that has one, then try again.",
  },
  camera_busy: {
    title: "The camera couldn't be started.",
    detail: "Another app or tab may be using it. Close it and try again.",
  },
  camera_lost: {
    title: "The camera stopped.",
    detail: "It was disconnected or access was turned off. Reps after this point weren't counted.",
  },
  model_failed: {
    title: "Tracking couldn't be loaded on this device.",
    detail: "Check your connection and try again. The written steps and 3D demo still work.",
  },
  worker_crashed: {
    title: "Tracking stopped unexpectedly.",
    detail: "This device may be low on memory. Close other tabs and try again.",
  },
};

export interface Guidance {
  tone: "ok" | "warn" | "wait";
  title: string;
  detail: string;
}

/**
 * Placement guidance (FR-04: "guide the member into an appropriate camera position") from what
 * the tracker can and can't see. Describes the camera view, never the person (principle 1).
 */
export function guidance(
  tracking: TrackingSnapshot,
  landmarks: Float32Array | null,
  required: readonly LandmarkName[],
): Guidance {
  switch (tracking.issue) {
    case "no_person":
      return {
        tone: "wait",
        title: "Step into view",
        detail:
          "Stand side-on to the camera, about 2–3 m away, with your whole body in the picture.",
      };
    case "out_of_frame":
      return {
        tone: "warn",
        title: "Part of you is out of the picture",
        detail: "Move back, or tilt the camera, until your head and feet are both visible.",
      };
    case "low_light":
      return {
        tone: "warn",
        title: "It's too dark to track reliably",
        detail: "Turn on a light in front of you, or face a window.",
      };
    case "low_visibility":
      return {
        tone: "warn",
        title: "The tracker can't see your hip, knee and ankle clearly",
        detail: "Turn so your side faces the camera and nothing blocks your legs.",
      };
    case "unsupported_view":
      return {
        tone: "warn",
        title: "Turn side-on",
        detail: "Squats are tracked from the side. Turn 90° so your side faces the camera.",
      };
    case "slow_device":
      return {
        tone: "warn",
        title: "This device is too slow to count reliably",
        detail: "Close other apps and tabs, or try a faster device.",
      };
    case null:
      if (landmarks && bodyHeight(landmarks, required) < 0.35) {
        return {
          tone: "ok",
          title: "Tracking — you could move a little closer",
          detail: "You're small in the picture; closer gives steadier tracking.",
        };
      }
      return { tone: "ok", title: "Tracking", detail: "Reps are being counted." };
  }
}

/** Vertical span of the required landmarks as a fraction of the image height. */
function bodyHeight(landmarks: Float32Array, required: readonly LandmarkName[]): number {
  const ys = required.map((n) => landmarks[MEDIAPIPE_POSE_INDEX[n] * LANDMARK_STRIDE + 1]!);
  return Math.max(...ys) - Math.min(...ys);
}

/** Polite live-region text: changes only when something worth announcing changes. */
export function announcement(session: SessionState, tracking: TrackingSnapshot, reps: number) {
  switch (session.status) {
    case "idle":
      return "";
    case "requesting":
      return "Waiting for camera permission.";
    case "loading":
      return "Camera on. Preparing tracking.";
    case "paused":
      return `Paused. ${reps} reps counted.`;
    case "stopped":
      return `Stopped. Camera off. ${reps} reps counted.`;
    case "error":
      return FAILURE_MESSAGES[session.reason].title;
    case "running":
      return tracking.status === "tracking"
        ? `Tracking. ${reps} reps.`
        : `Tracking not reliable. Reps paused at ${reps}.`;
  }
}
