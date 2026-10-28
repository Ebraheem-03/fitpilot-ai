import { PoseRunner } from "../worker/pose-runner";
import { defaultAssetBases, PoseWorkerClient } from "../worker/pose-client";
import type { PoseDelegate, PoseModel } from "../worker/protocol";

export interface BenchConfig {
  thread: "worker" | "main";
  model: PoseModel;
  delegate: PoseDelegate | "auto";
  /** how frames reach the worker; main thread reads the source directly */
  transport: "bitmap" | "videoframe" | "direct";
}

export interface BenchRow extends BenchConfig {
  /** delegate actually used (GPU falls back to CPU when WebGL2 is unavailable) */
  actualDelegate: PoseDelegate;
  initMs: number;
  /** init done → first landmarks back (shader compile / first-inference cost) */
  firstResultMs: number | null;
  processedFps: number;
  inferP50: number;
  inferP95: number;
  /** capture → landmarks back on the main thread */
  latencyP50: number;
  latencyP95: number;
  captureP50: number;
  /** main-thread requestAnimationFrame rate during the run: UI smoothness */
  mainRafFps: number;
  longTasks: number | null;
  longTaskMs: number | null;
  detectionRate: number;
  error?: string;
}

/** Something that yields the current frame each animation tick (avatar canvas or camera video). */
export type FrameSource = (tMs: number) => HTMLCanvasElement | HTMLVideoElement;

export const BENCH_MATRIX: BenchConfig[] = [
  { thread: "worker", model: "lite", delegate: "auto", transport: "bitmap" },
  { thread: "worker", model: "lite", delegate: "GPU", transport: "bitmap" },
  { thread: "worker", model: "lite", delegate: "CPU", transport: "bitmap" },
  { thread: "worker", model: "full", delegate: "GPU", transport: "bitmap" },
  { thread: "worker", model: "full", delegate: "CPU", transport: "bitmap" },
  { thread: "worker", model: "lite", delegate: "GPU", transport: "videoframe" },
  { thread: "main", model: "lite", delegate: "GPU", transport: "direct" },
  { thread: "main", model: "lite", delegate: "CPU", transport: "direct" },
  { thread: "main", model: "full", delegate: "GPU", transport: "direct" },
];

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

export async function runBenchConfig(
  cfg: BenchConfig,
  source: FrameSource,
  durationMs: number,
  warmupMs = 1500,
): Promise<BenchRow> {
  const options = {
    model: cfg.model,
    delegate: cfg.delegate,
    ...defaultAssetBases(location.origin),
  };
  const infer: number[] = [];
  const latency: number[] = [];
  const capture: number[] = [];
  let processed = 0;
  let firstResultAt: number | null = null;
  let detected = 0;
  let raf = 0;
  let longTasks: number | null = null;
  let longTaskMs: number | null = null;

  const client = cfg.thread === "worker" ? new PoseWorkerClient() : null;
  const runner = cfg.thread === "main" ? new PoseRunner() : null;
  const initStart = performance.now();
  let actualDelegate: PoseDelegate;
  try {
    actualDelegate = client ? (await client.init(options)).delegate : await runner!.init(options);
  } catch (error) {
    client?.terminate();
    return { ...cfg, ...emptyRow(), actualDelegate: "CPU", error: String(error) };
  }
  const initMs = performance.now() - initStart;

  let observer: PerformanceObserver | null = null;
  const start = performance.now();
  let recording = false;
  let recordStart = start;
  try {
    while (performance.now() - start < warmupMs + durationMs) {
      const now = await nextFrame();
      if (!recording && now - start >= warmupMs) {
        recording = true;
        recordStart = performance.now();
        if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
          longTasks = 0;
          longTaskMs = 0;
          observer = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              longTasks! += 1;
              longTaskMs! += e.duration;
            }
          });
          observer.observe({ type: "longtask" });
        }
      }
      if (recording) raf += 1;
      const tMs = now - start;
      const el = source(tMs);

      if (client) {
        if (client.busy) continue; // backpressure: drop, never queue stale frames
        const t0 = performance.now();
        const frame =
          cfg.transport === "videoframe"
            ? new VideoFrame(el, { timestamp: Math.round(tMs * 1000) })
            : await createImageBitmap(el);
        const captured = performance.now();
        const rec = recording;
        void client.detect(frame, tMs).then(
          (r) => {
            firstResultAt ??= performance.now();
            if (!rec) return;
            processed += 1;
            if (r.landmarks) detected += 1;
            infer.push(r.inferMs);
            latency.push(performance.now() - t0);
            capture.push(captured - t0);
          },
          () => {},
        );
      } else {
        const t0 = performance.now();
        const r = runner!.detect(el, tMs);
        firstResultAt ??= performance.now();
        if (recording) {
          processed += 1;
          if (r.landmarks) detected += 1;
          infer.push(r.inferMs);
          latency.push(performance.now() - t0);
          capture.push(0);
        }
      }
    }
  } finally {
    observer?.disconnect();
    client?.terminate();
    runner?.close();
  }
  const seconds = (performance.now() - recordStart) / 1000;
  return {
    ...cfg,
    actualDelegate,
    initMs: Math.round(initMs),
    firstResultMs: firstResultAt === null ? null : Math.round(firstResultAt - start),
    processedFps: r1(processed / seconds),
    inferP50: r1(pct(infer, 50)),
    inferP95: r1(pct(infer, 95)),
    latencyP50: r1(pct(latency, 50)),
    latencyP95: r1(pct(latency, 95)),
    captureP50: r1(pct(capture, 50)),
    mainRafFps: r1(raf / seconds),
    longTasks,
    longTaskMs: longTaskMs === null ? null : Math.round(longTaskMs),
    detectionRate: processed ? r1((detected / processed) * 100) / 100 : 0,
  };
}

function emptyRow() {
  return {
    initMs: 0,
    firstResultMs: null,
    processedFps: 0,
    inferP50: 0,
    inferP95: 0,
    latencyP50: 0,
    latencyP95: 0,
    captureP50: 0,
    mainRafFps: 0,
    longTasks: null,
    longTaskMs: null,
    detectionRate: 0,
  };
}
