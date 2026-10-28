import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LandmarkFixture } from "@fitpilot/exercise-contracts";
import { SquatAnalyzer } from "@fitpilot/exercise-rules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EngineDeps, LiveEngine, type PoseSource } from "./engine";
import { FixtureReplayPoseSource } from "./testing/fixture-source";

const FIXTURES = join(
  __dirname,
  "../../../../../../data/evaluation-fixtures/vision/bodyweight_squat",
);
const mannequin = LandmarkFixture.parse(
  JSON.parse(readFileSync(join(FIXTURES, "mannequin_side_lite.landmarks.json"), "utf8")),
);
const REQUIRED = ["left_hip", "left_knee", "left_ankle", "left_shoulder"] as const;

class FakeTrack {
  stopped = false;
  private ended: (() => void) | null = null;
  stop = () => void (this.stopped = true);
  addEventListener = (_: string, fn: () => void) => void (this.ended = fn);
  end = () => this.ended?.();
}

function harness(
  opts: { source?: () => PoseSource; frameMs?: number; camera?: () => Promise<MediaStream> } = {},
) {
  const track = new FakeTrack();
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  const video = { srcObject: null as MediaStream | null, play: vi.fn(async () => {}) };
  let clock = 0;
  let queued: (() => void)[] = [];
  const sources: PoseSource[] = [];
  const deps: EngineDeps = {
    getUserMedia: vi.fn(opts.camera ?? (async () => stream)),
    createPoseSource: () => {
      const s = opts.source?.() ?? new FixtureReplayPoseSource(mannequin);
      sources.push(s);
      return s;
    },
    createAnalyzer: () => new SquatAnalyzer(),
    grabFrame: async () => ({ close() {} }) as ImageBitmap,
    sampleLuma: () => 0.5,
    scheduleFrame: (cb) => {
      queued.push(cb);
      return () => (queued = queued.filter((q) => q !== cb));
    },
    now: () => clock,
  };
  const engine = new LiveEngine(deps, video as unknown as HTMLVideoElement, REQUIRED);
  /** advance `ms` of wall time one animation frame at a time, letting async work settle */
  async function play(ms: number, onFrame?: () => void) {
    const step = opts.frameMs ?? 1000 / 30;
    for (let t = 0; t < ms; t += step) {
      clock += step;
      const due = queued;
      queued = [];
      for (const cb of due) cb();
      await new Promise((r) => setTimeout(r, 0));
      onFrame?.();
    }
  }
  return { engine, deps, track, video, sources, play, snap: () => engine.getSnapshot() };
}

describe("LiveEngine (FR-04 live session, ADR-0010 §8)", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => vi.stubGlobal("fetch", fetchSpy));
  afterEach(() => vi.unstubAllGlobals());

  it("doesn't touch the camera until started", () => {
    const h = harness();
    expect(h.deps.getUserMedia).not.toHaveBeenCalled();
    expect(h.snap().session.status).toBe("idle");
  });

  it("counts the mannequin's squats and freezes the count while nobody is visible", async () => {
    const h = harness();
    await h.engine.start();
    expect(h.snap().session.status).toBe("running");
    const hidden: { reps: number; status: string }[] = [];
    await h.play(24_000, () => {
      const t = h.deps.now();
      // loop 3 (12–16 s) is the hidden one; skip the settle time at its edges
      if (t > 12_500 && t < 15_900)
        hidden.push({ reps: h.snap().reps, status: h.snap().tracking.status });
    });
    expect(h.snap().reps).toBe(5);
    expect(new Set(hidden.map((h) => h.reps)).size).toBe(1);
    expect(hidden.every((h) => h.status === "searching")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows tracking with a confidence while the person is visible", async () => {
    const h = harness();
    await h.engine.start();
    await h.play(1000);
    expect(h.snap().tracking).toMatchObject({ status: "tracking", issue: null });
    expect(h.snap().tracking.confidence).toBeGreaterThan(0.6);
    expect(h.snap().landmarks).toBeInstanceOf(Float32Array);
  });

  it("explains a denied camera and creates no worker", async () => {
    const h = harness({
      camera: async () => Promise.reject(new DOMException("no", "NotAllowedError")),
    });
    await h.engine.start();
    expect(h.snap().session).toEqual({ status: "error", reason: "denied", retryable: true });
    expect(h.sources).toHaveLength(0);
  });

  it("stop releases the camera and the worker, and drops late results", async () => {
    const h = harness();
    await h.engine.start();
    await h.play(500);
    h.engine.stop();
    expect(h.track.stopped).toBe(true);
    expect(h.video.srcObject).toBeNull();
    expect((h.sources[0] as FixtureReplayPoseSource).closed).toBe(true);
    const reps = h.snap().reps;
    await h.play(5000);
    expect(h.snap()).toMatchObject({ reps, landmarks: null, session: { status: "stopped" } });
  });

  it("stops processing while paused and resumes counting after", async () => {
    const h = harness();
    await h.engine.start();
    const detect = vi.spyOn(h.sources[0]!, "detect");
    await h.play(1000);
    h.engine.pause();
    const calls = detect.mock.calls.length;
    await h.play(2000);
    expect(detect.mock.calls.length).toBe(calls);
    expect(h.snap().session.status).toBe("paused");
    h.engine.resume();
    await h.play(500);
    expect(detect.mock.calls.length).toBeGreaterThan(calls);
  });

  it("releases a camera that was granted after the member already stopped", async () => {
    let grant!: (s: MediaStream) => void;
    const track = new FakeTrack();
    const late = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    const h = harness({ camera: () => new Promise((r) => (grant = r)) });
    const starting = h.engine.start();
    h.engine.stop();
    grant(late);
    await starting;
    expect(track.stopped).toBe(true);
    expect(h.snap().session.status).toBe("stopped");
  });

  it("reports a camera that disappears mid-session", async () => {
    const h = harness();
    await h.engine.start();
    await h.play(300);
    h.track.end();
    expect(h.snap().session).toMatchObject({ status: "error", reason: "camera_lost" });
  });

  it("fails clearly and turns the camera off when the model can't load", async () => {
    const broken = new FixtureReplayPoseSource(mannequin);
    broken.init = () => Promise.reject(new Error("404 model"));
    const h = harness({ source: () => broken });
    await h.engine.start();
    expect(h.snap().session).toMatchObject({ status: "error", reason: "model_failed" });
    expect(h.track.stopped).toBe(true);
  });

  it("restarts a crashed worker once, then gives up and releases the camera", async () => {
    const h = harness();
    await h.engine.start();
    await h.play(300);
    (h.sources[0] as FixtureReplayPoseSource).crash();
    await h.play(100);
    expect(h.sources).toHaveLength(2);
    expect(h.snap().session.status).toBe("running");
    (h.sources[1] as FixtureReplayPoseSource).crash();
    expect(h.snap().session).toMatchObject({ status: "error", reason: "worker_crashed" });
    expect(h.track.stopped).toBe(true);
  });

  it("withholds counting on a device too slow to time reps (ADR-0010 §7)", async () => {
    const h = harness({ frameMs: 200 }); // 5 processed fps
    await h.engine.start();
    await h.play(24_000);
    expect(h.snap().tracking).toMatchObject({ status: "unreliable", issue: "slow_device" });
    expect(h.snap().reps).toBeLessThanOrEqual(1); // only before the fps window filled
  });
});
