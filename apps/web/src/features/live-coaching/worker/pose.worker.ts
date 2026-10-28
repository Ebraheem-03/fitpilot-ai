/// <reference lib="webworker" />
import { confineFetch } from "./confine-fetch";
import { PoseRunner } from "./pose-runner";
import type { FromWorker, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

// before anything can create a MediaPipe task: no request may leave this origin
confineFetch(self);
const runner = new PoseRunner();
const post = (message: FromWorker, transfer: Transferable[] = []) =>
  self.postMessage(message, transfer);

self.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  switch (data.type) {
    case "init": {
      const start = performance.now();
      try {
        const delegate = await runner.init(data.options);
        post({ type: "ready", delegate, initMs: performance.now() - start });
      } catch (error) {
        post({ type: "error", stage: "init", message: String(error) });
      }
      break;
    }
    case "frame": {
      try {
        const { landmarks, inferMs } = runner.detect(data.frame, data.tMs);
        post(
          { type: "result", id: data.id, tMs: data.tMs, landmarks, inferMs },
          landmarks ? [landmarks.buffer] : [],
        );
      } catch (error) {
        post({ type: "error", stage: "frame", id: data.id, message: String(error) });
      } finally {
        data.frame.close();
      }
      break;
    }
    case "close":
      runner.close();
      self.close();
      break;
  }
};
