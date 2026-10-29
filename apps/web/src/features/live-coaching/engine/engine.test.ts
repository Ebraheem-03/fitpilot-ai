import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LandmarkFixture } from "@fitpilot/exercise-contracts";
import { SquatAnalyzer } from "@fitpilot/exercise-rules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feedFrameAt, type FeedPlan, SHALLOW_MOTION } from "../bench/feed-timeline";
import { SessionRecorder } from "../recording/recorder";
import {
  type EngineDeps,
  type EngineOptions,
  LiveEngine,
  type PoseSource,
  STALL_MS,
} from "./engine";
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
  opts: {
    source?: () => PoseSource;
    frameMs?: number;
    camera?: () => Promise<MediaStream>;
    options?: EngineOptions;
  } = {},
) {
  const track = new FakeTrack();
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  const video = { srcObject: null as MediaStream | null, play: vi.fn(async () => {}) };
  let clock = 0;
  let queued: (() => void)[] = [];
  let timers: { every: number; next: number; cb: () => void }[] = [];
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
    every: (ms, cb) => {
      const timer = { every: ms, next: clock + ms, cb };
      timers.push(timer);
      return () => (timers = timers.filter((t) => t !== timer));
    },
    now: () => clock,
  };
  const engine = new LiveEngine(deps, video as unknown as HTMLVideoElement, REQUIRED, opts.options);
  /** advance `ms` of wall time one animation frame at a time, letting async work settle */
  async function play(ms: number, onFrame?: () => void) {
    const step = opts.frameMs ?? 1000 / 30;
    for (let t = 0; t < ms; t += step) {
      clock += step;
      const due = queued;
      queued = [];
      for (const cb of due) cb();
      for (const t of timers.filter((t) => t.next <= clock)) {
        t.next += t.every;
        t.cb();
      }
      await new Promise((r) => setTimeout(r, 0));
      onFrame?.();
    }
  }
  /** stop delivering video frames (frozen camera / background tab) while time passes */
  const freeze = () => {
    deps.scheduleFrame = () => () => {};
    queued = [];
  };
  return { engine, deps, track, video, sources, play, freeze, snap: () => engine.getSnapshot() };
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

  it("starts no worker if stopped while the preview is starting", async () => {
    const h = harness();
    let resolvePlay!: () => void;
    h.video.play = vi.fn(() => new Promise<void>((r) => (resolvePlay = r)));
    const starting = h.engine.start();
    await Promise.resolve();
    await Promise.resolve();
    h.engine.dispose();
    resolvePlay();
    await starting;
    expect(h.sources).toHaveLength(0);
  });

  it("terminates a worker whose model finishes loading after stop", async () => {
    let finishInit!: () => void;
    const slow = new FixtureReplayPoseSource(mannequin);
    slow.init = () => new Promise((r) => (finishInit = () => r({ delegate: "CPU" })));
    const h = harness({ source: () => slow });
    const starting = h.engine.start();
    await new Promise((r) => setTimeout(r, 0));
    h.engine.stop();
    finishInit();
    await starting;
    expect(slow.closed).toBe(true);
    expect(h.snap().session.status).toBe("stopped");
  });

  it("says tracking has stalled when camera frames stop arriving", async () => {
    const h = harness();
    await h.engine.start();
    await h.play(1000);
    expect(h.snap().tracking.status).toBe("tracking");
    h.freeze();
    await h.play(STALL_MS + 600);
    expect(h.snap().tracking).toMatchObject({ status: "unreliable", issue: "no_frames" });
    expect(h.snap().session.status).toBe("running");
  });

  it("says tracking has stalled when every detection fails", async () => {
    const failing = new FixtureReplayPoseSource(mannequin);
    failing.detect = () => Promise.reject(new Error("bad frame"));
    const h = harness({ source: () => failing });
    await h.engine.start();
    await h.play(STALL_MS + 600);
    expect(h.snap().tracking.issue).toBe("no_frames");
  });

  it("recovers from a stall when frames come back", async () => {
    const h = harness();
    await h.engine.start();
    await h.play(500);
    const schedule = h.deps.scheduleFrame;
    h.freeze();
    await h.play(STALL_MS + 600);
    h.deps.scheduleFrame = schedule;
    h.engine.pause();
    h.engine.resume();
    await h.play(1000);
    expect(h.snap().tracking.status).toBe("tracking");
  });

  it("keeps one frame in flight end to end, even while grabbing is slow", async () => {
    const h = harness();
    const pending: (() => void)[] = [];
    h.deps.grabFrame = () =>
      new Promise((r) => pending.push(() => r({ close() {} } as ImageBitmap)));
    await h.engine.start();
    const detect = vi.spyOn(h.sources[0]!, "detect");
    await h.play(200); // several ticks while the first grab is pending
    for (const release of pending) release();
    await new Promise((r) => setTimeout(r, 0));
    expect(pending).toHaveLength(1);
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("closes a frame that couldn't be handed to the worker", async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const failing = new FixtureReplayPoseSource(mannequin);
    failing.detect = () => Promise.reject(new DOMException("detached", "DataCloneError"));
    const h = harness({ source: () => failing });
    h.deps.grabFrame = async () => bitmap;
    await h.engine.start();
    await h.play(100);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("asks for the camera once even if start is called twice", async () => {
    const h = harness();
    await Promise.all([h.engine.start(), h.engine.start()]);
    expect(h.deps.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("survives an analyzer that throws (no unhandled rejection, frame not counted)", async () => {
    const h = harness();
    h.deps.createAnalyzer = () => ({
      step: () => {
        throw new Error("bug");
      },
      reset: () => {},
    });
    const engine = new LiveEngine(h.deps, h.video as unknown as HTMLVideoElement, REQUIRED);
    await engine.start();
    await h.play(STALL_MS + 600);
    expect(engine.getSnapshot()).toMatchObject({ reps: 0, session: { status: "running" } });
    expect(engine.getSnapshot().tracking.issue).toBe("no_frames");
  });

  it("drops a result that was in flight when the member paused", async () => {
    let finish!: () => void;
    const slow = new FixtureReplayPoseSource(mannequin);
    const detect = slow.detect.bind(slow);
    const h = harness({ source: () => slow });
    await h.engine.start();
    await h.play(1000);
    const before = h.snap();
    slow.detect = (f, t) => new Promise((r) => (finish = () => r(detect(f, t))));
    await h.play(40); // a frame goes in flight
    h.engine.pause();
    h.engine.resume();
    finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.snap().landmarks).toBe(before.landmarks);
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

  it("tells the member to turn side-on when the analyzer reports a front view", async () => {
    const h = harness();
    const analyzer = {
      step: () => ({
        phase: "standing",
        reps: 0,
        repCompleted: false,
        tracking: { reliable: false, confidence: 0.9, reason: "unsupported_view" as const },
        features: null,
        cues: [],
      }),
      reset: () => {},
    };
    h.deps.createAnalyzer = () => analyzer;
    const engine = new LiveEngine(h.deps, h.video as unknown as HTMLVideoElement, REQUIRED);
    await engine.start();
    await h.play(1000);
    expect(engine.getSnapshot().tracking).toMatchObject({
      status: "unreliable",
      issue: "unsupported_view",
    });
  });

  it("withholds counting on a device too slow to time reps (ADR-0010 §7)", async () => {
    const h = harness({ frameMs: 200 }); // 5 processed fps
    await h.engine.start();
    await h.play(24_000);
    expect(h.snap().tracking).toMatchObject({ status: "unreliable", issue: "slow_device" });
    // the fps window needs ~2 s to fill; the lead-in is standing, so nothing can be counted
    expect(h.snap().reps).toBe(0);
  });
});

/**
 * The shallow feed the cue e2e uses (fake-camera.ts), replayed from the recorded lite-model
 * landmarks of the mannequin's first descent: 1 s standing, then 7 shallow reps (~130° knee) of
 * 3.5 s, the second one with nobody in view.
 */
const SHALLOW_PLAN: FeedPlan = {
  width: 640,
  height: 480,
  fps: 30,
  leadInMs: 1000,
  loops: 7,
  hiddenLoops: [1],
  motion: SHALLOW_MOTION,
};
const shallowSource = () =>
  new FixtureReplayPoseSource(mannequin, (t) => {
    const { clipMs, hidden } = feedFrameAt(SHALLOW_PLAN, 4000, t);
    return { tMs: clipMs, hidden };
  });

function cueHarness(opts: { source?: () => PoseSource } = {}) {
  const recorder = new SessionRecorder({ exerciseId: "bodyweight_squat" });
  const h = harness({ source: opts.source ?? shallowSource, options: { recorder } });
  const frames: ReturnType<typeof h.snap>[] = [];
  const record = () => frames.push(h.snap());
  return { ...h, recorder, frames, record };
}

const shownCues = (frames: { cue: { shown_at_ms: number; rule_id: string } | null }[]) => [
  ...new Map(frames.filter((f) => f.cue).map((f) => [f.cue!.shown_at_ms, f.cue!])).values(),
];

describe("LiveEngine cues + session events (FR-06, M3 S3)", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => vi.stubGlobal("fetch", fetchSpy));
  afterEach(() => vi.unstubAllGlobals());

  it("shows the shallow-depth cue for a counted shallow rep, recorded once as feedback_shown", async () => {
    const h = cueHarness();
    await h.engine.start();
    await h.play(26_000, h.record);
    expect(h.snap().reps).toBe(6);
    const cues = shownCues(h.frames);
    // cooldown (20 s): the first rep's cue, then the next one after 6 loops of 3.5 s
    expect(cues.map((c) => c.rule_id)).toEqual(["squat.depth.shallow", "squat.depth.shallow"]);
    const shown = h.snap().events.filter((e) => e.type === "feedback_shown");
    expect(shown.map((e) => e.type === "feedback_shown" && e.rule_id)).toEqual(
      cues.map((c) => c.rule_id),
    );
    for (const e of shown) {
      const knee = e.type === "feedback_shown" ? e.measurements.min_knee_angle_deg! : 0;
      expect(knee).toBeGreaterThan(120);
      expect(knee).toBeLessThanOrEqual(140);
    }
    expect(h.recorder.rejected).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never has a cue while tracking isn't reliable, and withdraws it when nobody is in view", async () => {
    const h = cueHarness();
    await h.engine.start();
    await h.play(8000, h.record);
    expect(shownCues(h.frames)).toHaveLength(1); // the first rep's cue appeared…
    for (const f of h.frames) if (f.cue) expect(f.tracking.status).toBe("tracking");
    // …and was gone once the hidden loop (4.5–8 s) began, before its 4 s were up
    const firstAt = h.frames.find((f) => f.cue)!.cue!.shown_at_ms;
    expect(firstAt).toBeGreaterThan(4500 - 4000);
    expect(h.snap().cue).toBeNull();
  });

  it("records the time the analysis result that produced a cue was ready", async () => {
    const h = cueHarness();
    await h.engine.start();
    await h.play(4500, h.record);
    const first = h.frames.find((f) => f.cue)!;
    expect(first.cueProducedAt).not.toBeNull();
    expect(
      h.frames.filter((f) => f.cue).every((f) => f.cueProducedAt === first.cueProducedAt),
    ).toBe(true);
  });

  it("acknowledging removes the cue, is recorded, and its rule still cools down", async () => {
    const h = cueHarness();
    await h.engine.start();
    await h.play(4500, () => {
      if (h.snap().cue) h.engine.acknowledgeCue();
    });
    expect(h.snap().cue).toBeNull();
    const types = h.snap().events.map((e) => e.type);
    expect(types).toContain("feedback_acknowledged");
    expect(types.filter((t) => t === "feedback_shown")).toHaveLength(1);
    await h.play(10_000, h.record); // three more shallow reps: all inside the cooldown
    expect(shownCues(h.frames)).toHaveLength(0);
  });

  it("dismissing removes the cue and records feedback_dismissed", async () => {
    const h = cueHarness();
    await h.engine.start();
    await h.play(4500, () => {
      if (h.snap().cue) h.engine.dismissCue();
    });
    expect(h.snap().events.filter((e) => e.type === "feedback_dismissed")).toHaveLength(1);
    h.engine.dismissCue(); // nothing on screen: nothing recorded
    expect(h.snap().events.filter((e) => e.type.startsWith("feedback_"))).toHaveLength(2);
  });

  it("pausing withdraws the cue", async () => {
    const h = cueHarness();
    await h.engine.start();
    await h.play(4500, () => {
      if (h.snap().cue && h.snap().session.status === "running") h.engine.pause();
    });
    expect(h.snap()).toMatchObject({ cue: null, session: { status: "paused" } });
  });

  it("a stalled camera picture withdraws the cue", async () => {
    const h = cueHarness();
    await h.engine.start();
    await h.play(4500, () => {
      if (h.snap().cue) h.freeze();
    });
    await h.play(STALL_MS + 500);
    expect(h.snap()).toMatchObject({ cue: null, tracking: { issue: "no_frames" } });
  });

  it("stop ends the set: tracking spans and set_completed recorded, cue gone", async () => {
    const h = cueHarness();
    await h.engine.start();
    await h.play(12_000);
    h.engine.stop();
    const events = h.snap().events;
    expect(events.at(-1)).toMatchObject({
      type: "set_completed",
      set_index: 0,
      reps: h.snap().reps,
    });
    expect(events.filter((e) => e.type === "rep_completed")).toHaveLength(h.snap().reps);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tracking_degraded", reason: "no_person" }),
    );
    expect(h.snap().cue).toBeNull();
    // the next set starts empty and numbered on
    await h.engine.start();
    expect(h.snap().events).toEqual([]);
    h.engine.stop();
    expect(h.snap().events).toEqual([
      expect.objectContaining({ type: "set_completed", set_index: 1 }),
    ]);
  });

  it("the full-depth mannequin gets no cue", async () => {
    const h = cueHarness({ source: () => new FixtureReplayPoseSource(mannequin) });
    await h.engine.start();
    await h.play(24_000, h.record);
    expect(h.snap().reps).toBe(5);
    expect(shownCues(h.frames)).toEqual([]);
    expect(h.snap().events.some((e) => e.type === "feedback_shown")).toBe(false);
  });

  it("a camera lost mid-set still records the set with the reps counted", async () => {
    const h = cueHarness();
    await h.engine.start();
    await h.play(4000);
    h.track.end();
    expect(h.snap().events.at(-1)).toMatchObject({ type: "set_completed", reps: 1 });
  });
});
