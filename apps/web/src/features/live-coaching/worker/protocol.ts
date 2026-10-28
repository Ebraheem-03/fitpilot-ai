/**
 * Messages between the page and the pose worker (ADR-0002, ADR-0010). Frames go in as transferred
 * ImageBitmap/VideoFrame and are closed in the worker; only landmark numbers come back. Nothing
 * here is ever sent over the network.
 */
export type PoseModel = "lite" | "full";
export type PoseDelegate = "CPU" | "GPU";

export interface PoseRunnerOptions {
  model: PoseModel;
  /** "auto": GPU when hardware WebGL2 is available, else CPU (ADR-0010) */
  delegate: PoseDelegate | "auto";
  /** absolute or root-relative URL of the vendored wasm folder (scripts/vendor-mediapipe.mjs) */
  wasmBase: string;
  modelBase: string;
}

/** 33 MediaPipe landmarks × (x, y, z, visibility), image-normalised; see MEDIAPIPE_POSE_INDEX. */
export const LANDMARK_STRIDE = 4;
export const POSE_LANDMARK_COUNT = 33;

export type ToWorker =
  | { type: "init"; options: PoseRunnerOptions }
  | { type: "frame"; id: number; tMs: number; frame: ImageBitmap | VideoFrame }
  | { type: "close" };

export type FromWorker =
  | { type: "ready"; delegate: PoseDelegate; initMs: number }
  | {
      type: "result";
      id: number;
      tMs: number;
      /** null when no person was detected */
      landmarks: Float32Array | null;
      inferMs: number;
    }
  | { type: "error"; stage: "init" | "frame"; id?: number; message: string };
