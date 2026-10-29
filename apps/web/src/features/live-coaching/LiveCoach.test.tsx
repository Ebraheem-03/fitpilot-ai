// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LandmarkFixture, type SessionEvent } from "@fitpilot/exercise-contracts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feedFrameAt, type FeedPlan, SHALLOW_MOTION } from "./bench/feed-timeline";
import type { EngineDeps } from "./engine/engine";
import { FixtureReplayPoseSource } from "./engine/testing/fixture-source";
import { Outbox } from "../workouts/outbox/outbox";
import { MemoryStore } from "../workouts/outbox/store";
import { LiveCoach } from "./LiveCoach";

const FIXTURE = join(
  __dirname,
  "../../../../../data/evaluation-fixtures/vision/bodyweight_squat/mannequin_side_lite.landmarks.json",
);
const mannequin = LandmarkFixture.parse(JSON.parse(readFileSync(FIXTURE, "utf8")));

const env = vi.hoisted(() => ({
  camera: null as null | (() => Promise<MediaStream>),
  queued: [] as (() => void)[],
  clock: 0,
  trackStopped: false,
  source: null as null | (() => import("./engine/engine").PoseSource),
}));

vi.mock("./engine/browser", async () => {
  const { SquatAnalyzer } = await import("@fitpilot/exercise-rules");
  return {
    browserDeps: (): EngineDeps => ({
      getUserMedia: () => env.camera!(),
      createPoseSource: () => env.source?.() ?? new FixtureReplayPoseSource(mannequin),
      createAnalyzer: () => new SquatAnalyzer(),
      grabFrame: async () => ({ close() {} }) as ImageBitmap,
      sampleLuma: () => 0.5,
      scheduleFrame: (cb) => {
        env.queued.push(cb);
        return () => (env.queued = env.queued.filter((q) => q !== cb));
      },
      every: () => () => {},
      now: () => env.clock,
    }),
  };
});

// A real outbox over an in-memory store; only its network edge (the send) is faked, and it
// records whether the camera was running at the moment of each send.
const outbox = vi.hoisted(() => ({
  holds: [] as boolean[],
  sends: [] as { types: string[]; cameraRunning: boolean }[],
  instance: null as null | import("../workouts/outbox/outbox").Outbox,
}));
vi.mock("../workouts/outbox/browser", () => ({ getOutbox: () => outbox.instance! }));
vi.mock("../workouts/actions", () => ({
  setTrackingConsent: vi.fn(async () => ({ ok: true, data: {} })),
  sendEvents: vi.fn(),
}));

const exercise = {
  id: "bodyweight_squat",
  name: "Bodyweight squat",
  required_landmarks: ["left_hip", "left_knee", "left_ankle", "left_shoulder"] as const,
};

async function advance(ms: number) {
  for (let t = 0; t < ms; t += 1000 / 30) {
    env.clock += 1000 / 30;
    const due = env.queued;
    env.queued = [];
    await act(async () => {
      for (const cb of due) cb();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const coach = () => screen.getByTestId("live-coach");

beforeEach(() => {
  outbox.holds = [];
  // Per-test array captured by this outbox: a flush from the previous test's unmount must not
  // land in this test's record.
  const sends: typeof outbox.sends = (outbox.sends = []);
  const real = new Outbox({
    store: new MemoryStore(),
    send: async (_sessionId, events) => {
      const state = document
        .querySelector("[data-testid=live-coach]")
        ?.getAttribute("data-session");
      sends.push({
        types: events.map((e) => e.type),
        cameraRunning: state === "running" || state === "paused" || state === "loading",
      });
      return { ok: true };
    },
  });
  const hold = real.holdWhile.bind(real);
  real.holdWhile = (v) => {
    outbox.holds.push(v);
    hold(v);
  };
  outbox.instance = real;
});

describe("LiveCoach (FR-04 UI)", () => {
  beforeEach(() => {
    env.clock = 0;
    env.queued = [];
    env.trackStopped = false;
    env.source = null;
    const track = {
      stop: () => (env.trackStopped = true),
      addEventListener: () => {},
    };
    env.camera = async () =>
      ({ getTracks: () => [track], getVideoTracks: () => [track] }) as unknown as MediaStream;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("explains on-device processing before asking for the camera, and offers a non-camera path", () => {
    render(<LiveCoach exercise={exercise} />);
    expect(screen.getByText(/never leave this device/).closest("li")!.textContent).toMatch(
      /only after\s+the camera stops/,
    );
    expect(screen.getByRole("link", { name: /3D demonstration/ })).toBeTruthy();
    expect(coach().dataset.session).toBe("idle");
  });

  it("practice mode (no session) asks for no consent and holds nothing", () => {
    render(<LiveCoach exercise={exercise} />);
    expect(screen.queryByTestId("tracking-consent")).toBeNull();
    expect(screen.getByRole("button", { name: "Start camera" })).toHaveProperty("disabled", false);
    expect(outbox.holds).toEqual([]);
  });

  it("asks for consent before a session's first tracked set, in plain words, and blocks the camera until answered", async () => {
    render(<LiveCoach exercise={exercise} sessionId="s-1" />);
    expect(screen.getByTestId("tracking-consent").textContent).toContain(
      "We'll save your rep counts, rep timing, tracking quality and the measurements behind each cue to your account — never video or body points.",
    );
    expect(screen.getByRole("button", { name: "Start camera" })).toHaveProperty("disabled", true);
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: /Don't save — track only on this device/ }),
      ),
    );
    expect(screen.queryByTestId("tracking-consent")).toBeNull();
    expect(screen.getByRole("button", { name: "Start camera" })).toHaveProperty("disabled", false);
  });

  it("records consent through the server action when the member agrees", async () => {
    const { setTrackingConsent } = await import("../workouts/actions");
    render(<LiveCoach exercise={exercise} sessionId="s-1" />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Save my tracking data" })),
    );
    expect(setTrackingConsent).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("tracking-consent")).toBeNull();
  });

  it("does not ask again once consent is on record", () => {
    render(<LiveCoach exercise={exercise} sessionId="s-1" trackingConsent />);
    expect(screen.queryByTestId("tracking-consent")).toBeNull();
  });

  it("holds the outbox while the camera is on and releases it when the camera stops", async () => {
    render(<LiveCoach exercise={exercise} sessionId="s-1" trackingConsent />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
    expect(outbox.holds.at(-1)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    expect(outbox.holds.at(-1)).toBe(false);
    expect(screen.getByTestId("save-state").textContent).toMatch(/being saved/);
  });

  it("starts, tracks and counts reps, with the count announced politely", async () => {
    render(<LiveCoach exercise={exercise} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
    expect(coach().dataset.session).toBe("running");
    await advance(4500);
    expect(screen.getByTestId("tracking-status").dataset.status).toBe("tracking");
    expect(screen.getByTestId("rep-count").textContent).toBe("1");
    expect(screen.getByTestId("live-announcement").textContent).toBe("Tracking. 1 rep.");
  });

  it("says reps are paused while nobody is visible (hidden loop) and keeps the count", async () => {
    render(<LiveCoach exercise={exercise} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
    await advance(13_000); // into the hidden 12–16 s loop
    expect(screen.getByTestId("tracking-status").dataset.issue).toBe("no_person");
    expect(screen.getByTestId("rep-state").textContent).toBe("Reps paused — tracking not reliable");
    expect(screen.getByText("Step into view")).toBeTruthy();
    expect(screen.getByTestId("rep-count").textContent).toBe("3");
  });

  it("pauses and resumes from the keyboard-reachable controls", async () => {
    render(<LiveCoach exercise={exercise} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(coach().dataset.session).toBe("paused");
    expect(screen.getByText(/nothing is being analysed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(coach().dataset.session).toBe("running");
  });

  it("stops: camera released and the count summarised", async () => {
    render(<LiveCoach exercise={exercise} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
    await advance(4500);
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    expect(env.trackStopped).toBe(true);
    expect(screen.getByTestId("final-reps").textContent).toBe("1 rep counted.");
    expect(screen.getByRole("button", { name: "Start again" })).toBeTruthy();
  });

  it("explains a blocked camera and offers retry", async () => {
    env.camera = () => Promise.reject(new DOMException("no", "NotAllowedError"));
    render(<LiveCoach exercise={exercise} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
    expect(screen.getByRole("alert").textContent).toMatch(/Camera access was blocked/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("moves focus to the next action when the panel it was on disappears", async () => {
    render(<LiveCoach exercise={exercise} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause" }));
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    expect(document.activeElement?.textContent).toBe("Camera off.");
  });

  it("survives React StrictMode's double mount with one live camera", async () => {
    render(
      <StrictMode>
        <LiveCoach exercise={exercise} />
      </StrictMode>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
    await advance(4500);
    expect(screen.getByTestId("rep-count").textContent).toBe("1");
  });

  it("turns the camera off when the page is left", async () => {
    const { unmount } = render(<LiveCoach exercise={exercise} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
    unmount();
    expect(env.trackStopped).toBe(true);
  });

  it("always shows that this is coaching, not medical advice", async () => {
    render(<LiveCoach exercise={exercise} />);
    expect(screen.getByRole("note").textContent).toMatch(
      /not medical advice.*stop if anything hurts/,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
    expect(screen.getByRole("note").textContent).toMatch(/qualified professional/);
  });
});

/** the shallow-squat replay (bench/feed-timeline.ts): 1 s standing, then 3.5 s shallow reps */
const SHALLOW: FeedPlan = {
  width: 640,
  height: 480,
  fps: 30,
  leadInMs: 1000,
  loops: 7,
  hiddenLoops: [1],
  motion: SHALLOW_MOTION,
};
const FIRST_CUE_MS = 3700; // rep 1 is counted ~3.5 s in
const HIDDEN_MS = 5000; // loop 1 (4.5–8 s) shows nobody

describe("LiveCoach cues + post-set summary (FR-06)", () => {
  beforeEach(() => {
    env.clock = 0;
    env.queued = [];
    env.trackStopped = false;
    env.source = () =>
      new FixtureReplayPoseSource(mannequin, (t) => {
        const { clipMs, hidden } = feedFrameAt(SHALLOW, 4000, t);
        return { tMs: clipMs, hidden };
      });
    const track = { stop: () => (env.trackStopped = true), addEventListener: () => {} };
    env.camera = async () =>
      ({ getTracks: () => [track], getVideoTracks: () => [track] }) as unknown as MediaStream;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    delete window.__fitpilotLiveEvents;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const start = async () =>
    act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
  const recorded = () => window.__fitpilotLiveEvents ?? [];
  const cueCard = () => screen.queryByTestId("active-cue");

  it("shows the selected cue with its measurement and what it means, without taking focus", async () => {
    render(<LiveCoach exercise={exercise} />);
    await start();
    expect(cueCard()).toBeNull();
    await advance(FIRST_CUE_MS);
    const card = cueCard()!;
    expect(card.dataset.ruleId).toBe("squat.depth.shallow");
    expect(screen.getByTestId("cue-message").textContent).toBe(
      "Try sitting a little deeper if it feels comfortable.",
    );
    expect(screen.getByTestId("cue-measurements").textContent).toMatch(
      /^Smallest knee angle in the rep: 1[23]\d°$/,
    );
    expect(screen.getByText("What this means").tagName).toBe("SUMMARY");
    expect(screen.getByTestId("cue-explanation").textContent).toMatch(/angle at your knee/);
    expect(screen.getByTestId("cue-region").getAttribute("aria-live")).toBe("polite");
    expect(Number(card.dataset.cueLatencyMs)).toBeGreaterThanOrEqual(0);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause" }));
    // the cue on screen is the one recorded
    const shown = recorded().filter((e) => e.type === "feedback_shown");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      rule_id: card.dataset.ruleId,
      message_id: card.dataset.messageId,
    });
  });

  it("“Got it” records feedback_acknowledged, removes the cue and keeps focus on the controls", async () => {
    render(<LiveCoach exercise={exercise} />);
    await start();
    await advance(FIRST_CUE_MS);
    const gotIt = screen.getByRole("button", { name: "Got it" });
    gotIt.focus();
    fireEvent.click(gotIt);
    expect(cueCard()).toBeNull();
    expect(recorded().at(-1)).toMatchObject({
      type: "feedback_acknowledged",
      rule_id: "squat.depth.shallow",
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause" }));
  });

  it("“Dismiss” records feedback_dismissed and removes the cue", async () => {
    render(<LiveCoach exercise={exercise} />);
    await start();
    await advance(FIRST_CUE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(cueCard()).toBeNull();
    expect(recorded().at(-1)).toMatchObject({ type: "feedback_dismissed" });
  });

  it("hides the cue as soon as tracking isn't reliable", async () => {
    render(<LiveCoach exercise={exercise} />);
    await start();
    await advance(FIRST_CUE_MS);
    expect(cueCard()).not.toBeNull();
    await advance(HIDDEN_MS - FIRST_CUE_MS); // nobody in view, well inside the cue's 4 s
    expect(screen.getByTestId("rep-state").textContent).toBe("Reps paused — tracking not reliable");
    expect(cueCard()).toBeNull();
    expect(
      recorded().some((e) => e.type.startsWith("feedback_") && e.type !== "feedback_shown"),
    ).toBe(false);
  });

  it("shows set progress against the target", async () => {
    render(<LiveCoach exercise={exercise} targetReps={2} />);
    await start();
    expect(screen.getByTestId("set-progress").textContent).toBe("0 of 2 reps this set");
    await advance(FIRST_CUE_MS);
    expect(screen.getByTestId("set-progress").textContent).toBe("1 of 2 reps this set");
    expect(screen.getByRole("progressbar", { name: "Set progress" })).toBeTruthy();
  });

  it("after stop, summarises the set from the recorded events only", async () => {
    const onSetComplete = vi.fn();
    render(<LiveCoach exercise={exercise} targetReps={8} onSetComplete={onSetComplete} />);
    await start();
    await advance(FIRST_CUE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await advance(11_500 - FIRST_CUE_MS); // through the hidden loop and one more rep
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));

    const summary = screen.getByTestId("set-summary");
    expect(screen.getByTestId("final-reps").textContent).toBe("2 reps counted.");
    expect(screen.getByTestId("summary-reps").textContent).toBe(
      "2 reps of 8 counted while tracking was reliable.",
    );
    const cues = summary.querySelectorAll<HTMLElement>("[data-rule-id]");
    expect([...cues].map((c) => [c.dataset.ruleId, c.dataset.response])).toEqual([
      ["squat.depth.shallow", "acknowledged"],
    ]);
    expect(cues[0]!.textContent).toMatch(/Smallest knee angle in the rep: 1[23]\d°/);
    expect(cues[0]!.textContent).toMatch(/Rule squat\.depth\.shallow, version 4/);
    const spans = screen.getByTestId("summary-tracking").querySelectorAll<HTMLElement>("li");
    expect([...spans].map((s) => s.dataset.reason)).toEqual(["no_person"]);
    expect(spans[0]!.textContent).toMatch(/^Nobody in view — 3\.\d s$/);

    expect(onSetComplete).toHaveBeenCalledTimes(1);
    const [s, events] = onSetComplete.mock.calls[0]!;
    expect(s).toMatchObject({ reps: 2, completed: true });
    expect(events).toBe(recorded());
  });

  it("practice mode never calls the sink; a real session gets every event", async () => {
    const sink = vi.fn();
    const { unmount } = render(<LiveCoach exercise={exercise} sink={sink} />);
    await start();
    await advance(FIRST_CUE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    expect(recorded().length).toBeGreaterThan(0);
    expect(sink).not.toHaveBeenCalled();
    unmount();

    delete window.__fitpilotLiveEvents;
    const sessionId = "6f1c1f0e-7a52-4c47-9a39-2b7d0e6f3a11";
    render(
      <LiveCoach
        exercise={exercise}
        sessionId={sessionId}
        sink={sink}
        setIndex={2}
        trackingConsent
      />,
    );
    await start();
    await advance(FIRST_CUE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    const sent = sink.mock.calls.flat(2) as SessionEvent[];
    expect(sent.map((e) => e.type)).toEqual(["rep_completed", "feedback_shown", "set_completed"]);
    expect(sent.every((e) => e.session_id === sessionId)).toBe(true);
    expect(sent.at(-1)).toMatchObject({ set_index: 2, reps: 1 });
    expect(window.__fitpilotLiveEvents).toBeUndefined(); // the e2e hook is practice-only
  });

  describe("session data leaves the device only after the set stops (ADR-0011)", () => {
    const sessionId = "6f1c1f0e-7a52-4c47-9a39-2b7d0e6f3a11";

    it("with consent: nothing is sent while the camera runs; the set is sent once it stops", async () => {
      render(<LiveCoach exercise={exercise} sessionId={sessionId} trackingConsent />);
      await start();
      await advance(FIRST_CUE_MS);
      expect(coach().dataset.session).toBe("running");
      await vi.waitFor(async () => expect(await outbox.instance!.pendingCount(sessionId)).toBe(2));
      expect(outbox.sends).toEqual([]); // queued on the device, no network call yet

      fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
      await vi.waitFor(() => expect(outbox.sends).toHaveLength(1));
      expect(outbox.sends[0]).toEqual({
        types: ["rep_completed", "feedback_shown", "set_completed"],
        cameraRunning: false,
      });
      expect(await outbox.instance!.pendingCount(sessionId)).toBe(0);
    });

    it("without consent: tracking works but no tracked event is stored or sent", async () => {
      render(<LiveCoach exercise={exercise} sessionId={sessionId} />);
      fireEvent.click(screen.getByRole("button", { name: /Don't save/ }));
      await start();
      await advance(FIRST_CUE_MS);
      expect(screen.getByTestId("rep-count").textContent).toBe("1");
      fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
      await act(async () => {
        await outbox.instance!.flush();
      });
      expect(await outbox.instance!.pendingCount()).toBe(0);
      expect(outbox.sends).toEqual([]);
    });

    it("practice mode stores and sends nothing", async () => {
      render(<LiveCoach exercise={exercise} />);
      await start();
      await advance(FIRST_CUE_MS);
      fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
      await act(async () => {
        await outbox.instance!.flush();
      });
      expect(await outbox.instance!.pendingCount()).toBe(0);
      expect(outbox.sends).toEqual([]);
    });

    it("clears the e2e events hook when the page is left", async () => {
      const { unmount } = render(<LiveCoach exercise={exercise} />);
      await start();
      await advance(FIRST_CUE_MS);
      expect(window.__fitpilotLiveEvents).toBeDefined();
      unmount();
      expect(window.__fitpilotLiveEvents).toBeUndefined();
    });
  });
});
