import { MEDIAPIPE_POSE_INDEX, type LandmarkName } from "@fitpilot/exercise-contracts";
import { LANDMARK_STRIDE } from "./worker/protocol";

const BONES: [LandmarkName, LandmarkName][] = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["left_ankle", "left_heel"],
  ["left_heel", "left_foot_index"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
  ["right_ankle", "right_heel"],
  ["right_heel", "right_foot_index"],
];

export interface SkeletonStyle {
  /** landmarks below this visibility are drawn faint, so weak tracking is visible, not hidden */
  minVisibility: number;
  /** mirror horizontally to match a selfie-style preview */
  mirrored: boolean;
}

/** Draws 33-point worker output over a canvas the size of the video (FR-04 tracking display). */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Float32Array,
  { minVisibility, mirrored }: SkeletonStyle,
) {
  const { width, height } = ctx.canvas;
  const at = (name: LandmarkName) => {
    const o = MEDIAPIPE_POSE_INDEX[name] * LANDMARK_STRIDE;
    const x = landmarks[o]! * width;
    return { x: mirrored ? width - x : x, y: landmarks[o + 1]! * height, v: landmarks[o + 3]! };
  };
  ctx.lineWidth = Math.max(2, width / 160);
  ctx.lineCap = "round";
  for (const [a, b] of BONES) {
    const p = at(a);
    const q = at(b);
    const good = Math.min(p.v, q.v) >= minVisibility;
    ctx.strokeStyle = good ? "rgba(34, 197, 94, 0.95)" : "rgba(250, 204, 21, 0.45)";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  for (const name of Object.keys(MEDIAPIPE_POSE_INDEX) as LandmarkName[]) {
    const p = at(name);
    ctx.fillStyle = p.v >= minVisibility ? "#ffffff" : "rgba(250, 204, 21, 0.6)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}
