// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LandmarkFixture } from "@fitpilot/exercise-contracts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineDeps } from "./engine/engine";
import { FixtureReplayPoseSource } from "./engine/testing/fixture-source";
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
}));

vi.mock("./engine/browser", async () => {
  const { SquatAnalyzer } = await import("@fitpilot/exercise-rules");
  return {
    browserDeps: (): EngineDeps => ({
      getUserMedia: () => env.camera!(),
      createPoseSource: () => new FixtureReplayPoseSource(mannequin),
      createAnalyzer: () => new SquatAnalyzer(),
      grabFrame: async () => ({ close() {} }) as ImageBitmap,
      sampleLuma: () => 0.5,
      scheduleFrame: (cb) => {
        env.queued.push(cb);
        return () => (env.queued = env.queued.filter((q) => q !== cb));
      },
      now: () => env.clock,
    }),
  };
});

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

describe("LiveCoach (FR-04 UI)", () => {
  beforeEach(() => {
    env.clock = 0;
    env.queued = [];
    env.trackStopped = false;
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
    expect(screen.getByText(/processed/).textContent).toMatch(/on this device only/);
    expect(screen.getByRole("link", { name: /3D demonstration/ })).toBeTruthy();
    expect(coach().dataset.session).toBe("idle");
  });

  it("starts, tracks and counts reps, with the count announced politely", async () => {
    render(<LiveCoach exercise={exercise} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
    expect(coach().dataset.session).toBe("running");
    await advance(4500);
    expect(screen.getByTestId("tracking-status").dataset.status).toBe("tracking");
    expect(screen.getByTestId("rep-count").textContent).toBe("1");
    expect(screen.getByTestId("live-announcement").textContent).toBe("Tracking. 1 reps.");
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

  it("turns the camera off when the page is left", async () => {
    const { unmount } = render(<LiveCoach exercise={exercise} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start camera" })));
    unmount();
    expect(env.trackStopped).toBe(true);
  });
});
