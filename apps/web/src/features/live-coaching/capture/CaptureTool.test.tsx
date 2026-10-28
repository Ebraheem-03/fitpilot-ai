// @vitest-environment jsdom
import { ClipLabels } from "@fitpilot/exercise-contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureTool } from "./CaptureTool";

// three.js isn't needed until "Extract" runs with the mannequin source
vi.mock("../bench/avatar-source", () => ({ AvatarSource: class {} }));

describe("CaptureTool (M2 S2)", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => vi.stubGlobal("fetch", fetchSpy));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** jsdom has no media playback: drive the annotation clock directly. */
  function seek(ms: number) {
    const video = document.querySelector("video")!;
    Object.defineProperty(video, "currentTime", { value: ms / 1000, configurable: true });
  }

  it("turns marked reps and untrackable spans into schema-valid labels", () => {
    render(<CaptureTool />);
    fireEvent.change(screen.getByLabelText("Clip id"), { target: { value: "squat_side_007" } });
    fireEvent.change(screen.getByLabelText("Facing (in the image)"), {
      target: { value: "right" },
    });
    fireEvent.change(screen.getByLabelText("Lighting"), { target: { value: "dim" } });

    for (const [start, bottom, end] of [
      [1000, 1800, 2600],
      [3000, 3700, 4400],
    ]) {
      seek(start);
      fireEvent.click(screen.getByRole("button", { name: "Rep start" }));
      seek(bottom);
      fireEvent.click(screen.getByRole("button", { name: "Bottom" }));
      seek(end);
      fireEvent.click(screen.getByRole("button", { name: "Rep end" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Toggle last rep full depth" }));
    seek(5000);
    fireEvent.click(screen.getByRole("button", { name: "Untrackable from here" }));
    seek(6200);
    fireEvent.click(screen.getByRole("button", { name: "Untrackable until here" }));

    const labels = ClipLabels.parse(window.__capture?.labels);
    expect(labels).toMatchObject({
      clip_id: "squat_side_007",
      facing: "right",
      conditions: { lighting: "dim" },
      reps: [
        { start_ms: 1000, bottom_ms: 1800, end_ms: 2600, full_depth: true },
        { start_ms: 3000, bottom_ms: 3700, end_ms: 4400, full_depth: false },
      ],
      untrackable_ranges_ms: [[5000, 6200]],
    });
    expect(screen.getByText(/2 reps/)).toBeTruthy();
  });

  it("can't record a rep end before a start and bottom", () => {
    render(<CaptureTool />);
    expect(screen.getByRole("button", { name: "Bottom" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Rep end" })).toHaveProperty("disabled", true);
  });

  it("makes no network requests while annotating (video stays local)", () => {
    render(<CaptureTool />);
    seek(1000);
    fireEvent.click(screen.getByRole("button", { name: "Rep start" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
