import type { LandmarkName } from "@fitpilot/exercise-contracts";
import type { AnalysisResult, LandmarkFrame } from "@fitpilot/exercise-rules";
import { isOutOfFrame, toLandmarkFrame } from "../landmarks";
import type { PoseDelegate } from "../worker/protocol";
import {
  classifyCameraError,
  initialSession,
  type SessionAction,
  sessionReducer,
  type SessionState,
} from "./session";
import { TrackingMonitor, type TrackingSnapshot } from "./tracking";

/** The pose estimator behind the engine (ADR-0002 `PoseSource`): the worker, or a fixture. */
export interface PoseSource {
  readonly busy: boolean;
  crashHandler: ((error: Error) => void) | null;
  init(): Promise<{ delegate: PoseDelegate }>;
  detect(frame: ImageBitmap, tMs: number): Promise<{ landmarks: Float32Array | null }>;
  terminate(): void;
}

export interface Analyzer {
  step(frame: LandmarkFrame, tMs: number): AnalysisResult<string>;
  reset(): void;
}

/** Everything that touches the browser, injected so the engine runs in Vitest (ADR-0010 §8). */
export interface EngineDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createPoseSource(): PoseSource;
  createAnalyzer(): Analyzer;
  grabFrame(video: HTMLVideoElement): Promise<ImageBitmap>;
  /** mean luma 0–1 of a tiny downscaled frame, or null if it can't be read */
  sampleLuma(video: HTMLVideoElement): number | null;
  scheduleFrame(callback: () => void): () => void;
  /** repeating timer independent of video frames (the stall watchdog); returns a cancel */
  every(ms: number, callback: () => void): () => void;
  now(): number;
}

export interface EngineSnapshot {
  session: SessionState;
  tracking: TrackingSnapshot;
  reps: number;
  phase: string | null;
  /** latest 33-point landmarks for the overlay; null when nobody is detected */
  landmarks: Float32Array | null;
  delegate: PoseDelegate | null;
  /**
   * Pipeline latency of the last frame: frame grab → analysis published, ms. Excludes the camera's
   * own frame interval and the paint; see benchmarks.md for the end-to-end estimate.
   */
  latencyMs: number | null;
}

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
  audio: false,
};
const LUMA_EVERY_MS = 1000;
/** no analysed frame for this long while running ⇒ say tracking has stalled (principle 3) */
export const STALL_MS = 2000;

/**
 * Live coaching engine (FR-04/FR-05, §8 stages 1–3): camera → pose worker → exercise analyzer,
 * with the session machine deciding what may run and the tracking monitor deciding what the
 * member is told. Frames and landmarks never leave the device: nothing here touches the network.
 */
export class LiveEngine {
  private state: EngineSnapshot;
  private listeners = new Set<() => void>();
  private stream: MediaStream | null = null;
  private source: PoseSource | null = null;
  private analyzer: Analyzer;
  private readonly monitor = new TrackingMonitor();
  private cancelFrame: (() => void) | null = null;
  private cancelWatchdog: (() => void) | null = null;
  private lastResultAt = 0;
  /** one frame in flight end to end (grab + detect), so frames are dropped, never queued */
  private inFlight = false;
  private clockStart = 0;
  private lastLumaAt = -Infinity;
  private luma: number | null = null;
  /** bumps on stop/restart so results from an old camera or worker are dropped */
  private generation = 0;
  /** bumps whenever the frame loop (re)starts or stops, so a frame from before a pause is dropped */
  private run = 0;

  constructor(
    private readonly deps: EngineDeps,
    private readonly video: HTMLVideoElement,
    private readonly required: readonly LandmarkName[],
  ) {
    this.analyzer = deps.createAnalyzer();
    this.state = {
      session: initialSession,
      tracking: this.monitor.snapshot,
      reps: 0,
      phase: null,
      landmarks: null,
      delegate: null,
      latencyMs: null,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  /** Explicit start (FR-04: permission only after the member asks). Also used for retry. */
  async start(): Promise<void> {
    const before = this.state.session;
    this.dispatch({ type: before.status === "error" ? "retry" : "start" });
    // only a real transition starts a camera (a second click while requesting does nothing)
    if (this.state.session === before || this.state.session.status !== "requesting") return;
    const generation = ++this.generation;
    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia(CAMERA_CONSTRAINTS);
    } catch (error) {
      if (generation === this.generation) {
        this.dispatch({ type: "cameraFailed", reason: classifyCameraError(error) });
      }
      return;
    }
    if (generation !== this.generation) {
      stopTracks(stream); // stopped while the prompt was open
      return;
    }
    this.stream = stream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", () => this.onTrackEnded(generation), { once: true });
    }
    this.video.srcObject = stream;
    await this.video.play().catch(() => {}); // autoplay is allowed: muted + user gesture
    if (generation !== this.generation) return; // stopped meanwhile: don't start a worker
    this.dispatch({ type: "granted" });
    this.resetAnalysis();
    await this.loadModel(generation);
  }

  pause(): void {
    this.dispatch({ type: "pause" });
    this.stopLoop();
  }

  resume(): void {
    this.dispatch({ type: "resume" });
    if (this.state.session.status === "running") this.startLoop(this.generation);
  }

  /** Stops processing and releases the camera (the indicator light goes off). */
  stop(): void {
    this.generation += 1;
    this.stopLoop();
    this.source?.terminate();
    this.source = null;
    if (this.stream) stopTracks(this.stream);
    this.stream = null;
    this.video.srcObject = null;
    this.dispatch({ type: "stop" });
    this.monitor.reset();
    this.update({ tracking: this.monitor.snapshot, landmarks: null });
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  private async loadModel(generation: number) {
    const source = this.deps.createPoseSource();
    this.source = source;
    source.crashHandler = () => {
      if (generation !== this.generation || this.source !== source) return;
      this.stopLoop();
      source.terminate();
      this.source = null;
      this.dispatch({ type: "workerCrashed" });
      // the analyzer keeps its state: the gap rules (maxGapMs) decide whether a rep survives
      if (this.state.session.status === "loading") void this.loadModel(generation);
      else this.releaseCamera(); // gave up: don't leave the camera on with nothing analysing
    };
    // a source that is no longer current (stopped or replaced) must not outlive this call
    const stale = () => {
      if (generation === this.generation && this.source === source) return false;
      if (this.source !== source) source.terminate();
      return true;
    };
    try {
      const { delegate } = await source.init();
      if (stale()) return;
      this.update({ delegate });
      this.dispatch({ type: "modelReady" });
      this.startLoop(generation);
    } catch {
      if (stale()) return;
      source.terminate();
      this.source = null;
      this.dispatch({ type: "modelFailed" });
      this.releaseCamera();
    }
  }

  private startLoop(generation: number) {
    this.stopLoop();
    const run = this.run;
    const tick = () => {
      if (generation !== this.generation || run !== this.run) return;
      if (this.state.session.status !== "running") return;
      this.cancelFrame = this.deps.scheduleFrame(tick);
      void this.processFrame(generation, run);
    };
    this.cancelFrame = this.deps.scheduleFrame(tick);
    this.lastResultAt = this.deps.now();
    this.cancelWatchdog = this.deps.every(STALL_MS / 4, () => this.checkStall(run));
  }

  private stopLoop() {
    this.run += 1;
    this.cancelFrame?.();
    this.cancelFrame = null;
    this.cancelWatchdog?.();
    this.cancelWatchdog = null;
  }

  /** Frames stopped arriving (frozen camera, background tab, failing worker): don't look healthy. */
  private checkStall(run: number) {
    if (run !== this.run || this.state.session.status !== "running") return;
    if (this.deps.now() - this.lastResultAt < STALL_MS) return;
    if (this.state.tracking.issue === "no_frames") return;
    this.update({ tracking: this.monitor.stall(), landmarks: null });
  }

  private async processFrame(generation: number, run: number) {
    const source = this.source;
    if (!source || source.busy || this.inFlight) return; // drop, never queue (ADR-0010 §6)
    this.inFlight = true;
    try {
      await this.analyseNextFrame(source, generation, run);
    } catch {
      // a bug in analysis must not become an unhandled rejection; the frame is simply not
      // counted, and if it keeps happening the stall watchdog says so
    } finally {
      this.inFlight = false;
    }
  }

  private async analyseNextFrame(source: PoseSource, generation: number, run: number) {
    const tMs = this.deps.now() - this.clockStart;
    if (tMs - this.lastLumaAt >= LUMA_EVERY_MS) {
      this.luma = this.deps.sampleLuma(this.video);
      this.lastLumaAt = tMs;
    }
    const grabbedAt = this.deps.now();
    let landmarks: Float32Array | null;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await this.deps.grabFrame(this.video);
      ({ landmarks } = await source.detect(bitmap, tMs));
    } catch {
      bitmap?.close(); // not transferred (e.g. DataCloneError); a no-op if it was
      return; // one bad frame (or a crash, handled by crashHandler) — nothing to analyse
    }
    if (generation !== this.generation || run !== this.run) return;
    if (this.state.session.status !== "running") return;

    const frame = landmarks ? toLandmarkFrame(landmarks) : {};
    // Below the fps floor the state machine's timing is meaningless: don't advance it.
    const analysis = this.monitor.analysisAllowed ? this.analyzer.step(frame, tMs) : null;
    const tracking = this.monitor.observe({
      tMs,
      personDetected: landmarks !== null,
      analysisReliable: analysis?.tracking.reliable ?? false,
      confidence: analysis?.tracking.confidence ?? 0,
      outOfFrame: landmarks !== null && isOutOfFrame(frame, this.required),
      luma: this.luma,
      unsupportedView: analysis?.tracking.reason === "unsupported_view",
    });
    this.update({
      tracking,
      landmarks,
      reps: analysis?.reps ?? this.state.reps,
      phase: analysis?.phase ?? this.state.phase,
      latencyMs: Math.round(this.deps.now() - grabbedAt),
    });
    this.lastResultAt = this.deps.now(); // only a published result counts as "alive"
  }

  private onTrackEnded(generation: number) {
    if (generation !== this.generation) return;
    this.stopLoop();
    this.source?.terminate();
    this.source = null;
    this.dispatch({ type: "trackEnded" });
    this.releaseCamera();
  }

  private releaseCamera() {
    if (this.stream) stopTracks(this.stream);
    this.stream = null;
    this.video.srcObject = null;
  }

  private resetAnalysis() {
    this.analyzer.reset();
    this.monitor.reset();
    this.clockStart = this.deps.now();
    this.lastLumaAt = -Infinity;
    this.luma = null;
    this.update({ reps: 0, phase: null, landmarks: null, tracking: this.monitor.snapshot });
  }

  private dispatch(action: SessionAction) {
    const session = sessionReducer(this.state.session, action);
    if (session !== this.state.session) this.update({ session });
  }

  private update(patch: Partial<EngineSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}
