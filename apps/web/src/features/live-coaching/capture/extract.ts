import type { PoseWorkerClient } from "../worker/pose-client";
import type { CapturedFrame } from "./fixture";

/** A clip that can be rendered at any timestamp (seekable video, or the mannequin). */
export interface StepSource {
  width: number;
  height: number;
  durationMs: number;
  frameAt(tMs: number): Promise<HTMLVideoElement | HTMLCanvasElement>;
}

/**
 * Runs the same worker as live coaching over a clip at a fixed timestep, so fixtures reflect
 * the runtime model exactly (ADR-0010) and don't depend on playback speed.
 */
export async function extractLandmarks(
  source: StepSource,
  client: PoseWorkerClient,
  fps: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<CapturedFrame[]> {
  const frames: CapturedFrame[] = [];
  const step = 1000 / fps;
  for (let i = 0; i * step < source.durationMs; i++) {
    signal?.throwIfAborted();
    const tMs = Math.round(i * step);
    const bitmap = await createImageBitmap(await source.frameAt(tMs));
    const { landmarks } = await client.detect(bitmap, tMs);
    frames.push({ tMs, landmarks });
    onProgress(Math.min(1, (tMs + step) / source.durationMs));
  }
  return frames;
}

export function videoFileSource(video: HTMLVideoElement): StepSource {
  if (video.readyState < 1 || !Number.isFinite(video.duration)) {
    throw new Error("the video's length isn't known yet — wait for it to load, then extract");
  }
  return {
    width: video.videoWidth,
    height: video.videoHeight,
    durationMs: video.duration * 1000,
    frameAt: (tMs) =>
      new Promise((resolve, reject) => {
        const done = () => {
          video.removeEventListener("error", fail);
          resolve(video);
        };
        const fail = () => reject(new Error("video seek failed"));
        const target = tMs / 1000;
        // assigning the current position again doesn't fire "seeked" everywhere
        if (Math.abs(video.currentTime - target) < 1e-6 && video.readyState >= 2) {
          resolve(video);
          return;
        }
        video.addEventListener("seeked", done, { once: true });
        video.addEventListener("error", fail, { once: true });
        video.currentTime = target;
      }),
  };
}
