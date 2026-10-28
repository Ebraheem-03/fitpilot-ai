import type { FromWorker, PoseDelegate, PoseRunnerOptions, ToWorker } from "./protocol";

export interface PoseResult {
  id: number;
  tMs: number;
  landmarks: Float32Array | null;
  inferMs: number;
}

/** Root of the self-hosted runtime (scripts/vendor-mediapipe.mjs). */
export function defaultAssetBases(origin: string) {
  return { wasmBase: `${origin}/mediapipe/wasm`, modelBase: `${origin}/mediapipe/models` };
}

/**
 * Promise wrapper around pose.worker. One frame in flight at a time: callers drop frames while
 * `busy` (backpressure) instead of queueing stale ones.
 */
export class PoseWorkerClient {
  private readonly worker: Worker;
  private pending = new Map<number, (r: PoseResult | Error) => void>();
  private nextId = 0;
  private onCrash: ((error: Error) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL("./pose.worker.ts", import.meta.url), { type: "module" });
    this.worker.onerror = (event) => this.fail(new Error(event.message || "pose worker crashed"));
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  /** Called when the worker dies; pending detections reject with the same error. */
  set crashHandler(handler: ((error: Error) => void) | null) {
    this.onCrash = handler;
  }

  init(options: PoseRunnerOptions): Promise<{ delegate: PoseDelegate; initMs: number }> {
    return new Promise((resolve, reject) => {
      this.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
        if (data.type === "ready") {
          this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.handle(e.data);
          resolve({ delegate: data.delegate, initMs: data.initMs });
        } else if (data.type === "error") reject(new Error(data.message));
      };
      this.send({ type: "init", options });
    });
  }

  detect(frame: ImageBitmap | VideoFrame, tMs: number): Promise<PoseResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (r) => (r instanceof Error ? reject(r) : resolve(r)));
      this.send({ type: "frame", id, tMs, frame }, [frame]);
    });
  }

  terminate(): void {
    this.send({ type: "close" });
    this.worker.terminate();
    this.fail(new Error("pose worker terminated"), false);
  }

  private handle(message: FromWorker) {
    if (message.type === "result") {
      this.pending.get(message.id)?.(message);
      this.pending.delete(message.id);
    } else if (message.type === "error" && message.id !== undefined) {
      this.pending.get(message.id)?.(new Error(message.message));
      this.pending.delete(message.id);
    }
  }

  private fail(error: Error, notify = true) {
    for (const settle of this.pending.values()) settle(error);
    this.pending.clear();
    if (notify) this.onCrash?.(error);
  }

  private send(message: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }
}
