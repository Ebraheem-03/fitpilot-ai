import { defaultAssetBases, PoseWorkerClient } from "../worker/pose-client";
import type { PoseModel } from "../worker/protocol";
import type { Analyzer, EngineDeps, PoseSource } from "./engine";

/** Runtime model (ADR-0010 §3). Switching to "full" is this one constant, once S4 justifies it. */
export const RUNTIME_MODEL: PoseModel = "lite";

class WorkerPoseSource implements PoseSource {
  private readonly client = new PoseWorkerClient();

  get busy() {
    return this.client.busy;
  }

  get crashHandler() {
    return null;
  }

  set crashHandler(handler: ((error: Error) => void) | null) {
    this.client.crashHandler = handler;
  }

  init() {
    return this.client.init({
      model: RUNTIME_MODEL,
      delegate: "auto",
      ...defaultAssetBases(location.origin),
    });
  }

  detect(frame: ImageBitmap, tMs: number) {
    return this.client.detect(frame, tMs);
  }

  terminate() {
    this.client.terminate();
  }
}

/** Real browser bindings for LiveEngine. Every frame stays in this tab (principle 5). */
export function browserDeps(video: HTMLVideoElement, createAnalyzer: () => Analyzer): EngineDeps {
  const lumaCanvas = document.createElement("canvas");
  lumaCanvas.width = 16;
  lumaCanvas.height = 12;
  const lumaCtx = lumaCanvas.getContext("2d", { willReadFrequently: true });
  return {
    getUserMedia: (constraints) => {
      // undefined on insecure origins and old browsers → TypeError → "unsupported"
      if (!navigator.mediaDevices?.getUserMedia) {
        return Promise.reject(new TypeError("camera API unavailable"));
      }
      return navigator.mediaDevices.getUserMedia(constraints);
    },
    createPoseSource: () => new WorkerPoseSource(),
    createAnalyzer,
    grabFrame: (v) => createImageBitmap(v),
    sampleLuma: (v) => {
      if (!lumaCtx || v.readyState < 2) return null;
      lumaCtx.drawImage(v, 0, 0, lumaCanvas.width, lumaCanvas.height);
      const { data } = lumaCtx.getImageData(0, 0, lumaCanvas.width, lumaCanvas.height);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      }
      return sum / (data.length / 4) / 255;
    },
    // one callback per new camera frame where supported, so the same frame isn't analysed twice
    scheduleFrame: (callback) => {
      if ("requestVideoFrameCallback" in video) {
        const id = video.requestVideoFrameCallback(() => callback());
        return () => video.cancelVideoFrameCallback(id);
      }
      const id = requestAnimationFrame(() => callback());
      return () => cancelAnimationFrame(id);
    },
    now: () => performance.now(),
  };
}
