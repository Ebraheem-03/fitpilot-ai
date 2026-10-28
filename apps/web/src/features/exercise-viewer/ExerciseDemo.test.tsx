// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewerError } from "./compat";
import { type DemoExercise, ExerciseDemo } from "./ExerciseDemo";
import type { AvatarSceneProps } from "./AvatarScene";
import type { PlaybackStore } from "./playback";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  webgl: vi.fn(() => true),
  sceneThrows: false,
  store: null as PlaybackStore | null,
}));

vi.mock("./model", () => ({ loadExerciseModel: mocks.load }));
vi.mock("./webgl", () => ({ hasWebGL: mocks.webgl }));
// Stand-in for the WebGL scene: reports ready like the real one and exposes the store.
vi.mock("./LazyScene", () => ({
  LazyScene: function FakeScene({ onReady, store, view }: AvatarSceneProps) {
    if (mocks.sceneThrows) throw new Error("WebGL context lost");
    mocks.store = store;
    useEffect(() => onReady(), [onReady]);
    return <div data-testid="scene" data-view={view} />;
  },
}));

const squat: DemoExercise = {
  id: "bodyweight_squat",
  name: "Bodyweight Squat",
  phases: ["standing", "descending", "bottom", "ascending"],
  instructions: ["Stand tall.", "Sit the hips back.", "Lower to parallel.", "Drive up."],
  animation: {
    asset: "squat.glb",
    clip: "squat",
    duration_s: 4,
    phases: [
      { phase: "standing", start_s: 0, end_s: 0.5, instruction_indices: [0] },
      { phase: "descending", start_s: 0.5, end_s: 2, instruction_indices: [1] },
      { phase: "bottom", start_s: 2, end_s: 2.4, instruction_indices: [2] },
      { phase: "ascending", start_s: 2.4, end_s: 3.6, instruction_indices: [3] },
      { phase: "standing", start_s: 3.6, end_s: 4, instruction_indices: [0] },
    ],
  },
};

const viewer = () => screen.getByTestId("exercise-viewer");
const announced = () => screen.getByTestId("viewer-announcement").textContent;
const button = (name: string) => screen.getByRole("button", { name });
const currentStep = () =>
  screen
    .getAllByRole("listitem")
    .filter((li) => li.getAttribute("aria-current") === "step")
    .map((li) => li.textContent);

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as typeof window.matchMedia;
}

async function renderLoaded() {
  render(<ExerciseDemo exercise={squat} />);
  await screen.findByTestId("scene");
}

beforeEach(() => {
  mocks.load.mockReset().mockResolvedValue({ scene: {}, clip: {} });
  mocks.webgl.mockReturnValue(true);
  mocks.sceneThrows = false;
  setReducedMotion(true);
});
afterEach(cleanup);

describe("ExerciseDemo (FR-03)", () => {
  it("shows the written steps and phases before the 3D model has loaded", () => {
    mocks.load.mockReturnValue(new Promise(() => {}));
    render(<ExerciseDemo exercise={squat} />);
    expect(screen.getByText("Loading 3D demonstration…")).toBeTruthy();
    expect(screen.getByText("Lower to parallel.")).toBeTruthy();
    expect(screen.getByText("Descending")).toBeTruthy();
    expect(button("Play").hasAttribute("disabled")).toBe(true);
  });

  it("loads the GLB from the catalogue's asset path", async () => {
    await renderLoaded();
    expect(mocks.load).toHaveBeenCalledWith(
      "/exercises/bodyweight_squat/squat.glb",
      squat.animation,
      expect.any(AbortSignal),
    );
  });

  it("autoplays when motion is allowed", async () => {
    setReducedMotion(false);
    await renderLoaded();
    expect(viewer().dataset.status).toBe("playing");
    expect(button("Pause")).toBeTruthy();
  });

  it("waits for the user under prefers-reduced-motion", async () => {
    await renderLoaded();
    expect(viewer().dataset.status).toBe("ready");
    expect(announced()).toBe("Demonstration ready.");
  });

  it("plays, pauses, replays and resets from the buttons", async () => {
    await renderLoaded();
    fireEvent.click(button("Play"));
    expect(viewer().dataset.status).toBe("playing");
    act(() => mocks.store!.dispatch({ type: "tick", dt: 2.2 }));
    fireEvent.click(button("Pause"));
    expect(viewer().dataset.status).toBe("paused");
    expect(announced()).toBe("Paused at the bottom phase.");
    fireEvent.click(button("Replay"));
    expect(mocks.store!.getState()).toMatchObject({ status: "playing", time: 0 });
    fireEvent.click(button("Reset"));
    expect(mocks.store!.getState()).toMatchObject({ status: "paused", time: 0 });
  });

  it("highlights the phase and the instruction for the current time", async () => {
    await renderLoaded();
    expect(currentStep()).toEqual(["Standing", "Stand tall."]);
    fireEvent.change(screen.getByRole("slider", { name: "Position in demonstration" }), {
      target: { value: "2.2" },
    });
    expect(currentStep()).toEqual(["Bottom", "Lower to parallel."]);
    expect(screen.getByTestId("viewer-phase").textContent).toBe("Bottom · 2.2 / 4.0 s");
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe(
      "2.2 of 4.0 seconds, Bottom phase",
    );
  });

  it("supports keyboard shortcuts on the focused viewer only", async () => {
    await renderLoaded();
    fireEvent.keyDown(viewer(), { key: " " });
    expect(viewer().dataset.status).toBe("playing");
    fireEvent.keyDown(viewer(), { key: "Home" });
    expect(mocks.store!.getState()).toMatchObject({ status: "paused", time: 0 });
    fireEvent.keyDown(viewer(), { key: "ArrowRight" });
    expect(mocks.store!.getState().time).toBe(0.5);
    // Space on a button is the button's own business
    fireEvent.keyDown(button("Replay"), { key: " " });
    expect(viewer().dataset.status).toBe("paused");
  });

  it("switches camera presets with pressed state", async () => {
    await renderLoaded();
    const views = within(screen.getByRole("group", { name: "Camera view" }));
    expect(views.getByRole("button", { name: "45°" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(views.getByRole("button", { name: "Side" }));
    expect(views.getByRole("button", { name: "Side" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("scene").dataset.view).toBe("side");
  });
});

describe("ExerciseDemo failure states (FR-03: handle missing or incompatible assets)", () => {
  it.each([
    ["missing", "The 3D demonstration couldn't be loaded."],
    ["corrupt", "The 3D demonstration file is damaged."],
    ["incompatible", "The 3D demonstration doesn't match this exercise yet."],
  ] as const)("%s asset: explains, keeps the steps, disables controls", async (reason, message) => {
    mocks.load.mockRejectedValue(new ViewerError(reason, "test"));
    render(<ExerciseDemo exercise={squat} />);
    const fallback = await screen.findByTestId("viewer-fallback");
    expect(within(fallback).getByText(message)).toBeTruthy();
    expect(announced()).toBe(`${message} Follow the written steps instead.`);
    expect(screen.getByText("Lower to parallel.")).toBeTruthy();
    expect(button("Play").hasAttribute("disabled")).toBe(true);
    expect(currentStep()).toEqual([]);
  });

  it("offers a retry for a missing asset that loads on the second attempt", async () => {
    mocks.load.mockRejectedValueOnce(new ViewerError("missing", "404"));
    render(<ExerciseDemo exercise={squat} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByTestId("scene");
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(viewer().dataset.status).toBe("ready");
  });

  it("does not offer a retry for a damaged file", async () => {
    mocks.load.mockRejectedValue(new ViewerError("corrupt", "bad"));
    render(<ExerciseDemo exercise={squat} />);
    await screen.findByTestId("viewer-fallback");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("never loads the model without WebGL", async () => {
    mocks.webgl.mockReturnValue(false);
    render(<ExerciseDemo exercise={squat} />);
    expect(await screen.findByText("Your browser or device can't show 3D graphics.")).toBeTruthy();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("falls back when the 3D scene crashes while rendering", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sceneThrows = true;
    render(<ExerciseDemo exercise={squat} />);
    expect(await screen.findByText("Your browser or device can't show 3D graphics.")).toBeTruthy();
    expect(screen.getByText("Stand tall.")).toBeTruthy();
  });
});
