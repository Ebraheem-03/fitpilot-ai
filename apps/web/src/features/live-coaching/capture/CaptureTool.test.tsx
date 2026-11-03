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

  function markRep(start: number, bottom: number, end: number) {
    seek(start);
    fireEvent.click(screen.getByRole("button", { name: "Rep start" }));
    seek(bottom);
    fireEvent.click(screen.getByRole("button", { name: "Bottom" }));
    seek(end);
    fireEvent.click(screen.getByRole("button", { name: "Rep end" }));
  }
  const judge = (rep: number, rule: string, value: string) =>
    fireEvent.change(screen.getByLabelText(`Rep ${rep} cue ${rule}`), { target: { value } });

  it("writes per-rep cue judgements into labels.json in the contract format (M3)", () => {
    render(<CaptureTool />);
    markRep(1000, 1800, 2600);
    markRep(3000, 3700, 4400);
    // every declared squat rule gets a control per rep, defaulting to "not judged"
    expect(
      (screen.getByLabelText("Rep 2 cue squat.torso.forward_lean") as HTMLSelectElement).value,
    ).toBe("not_judged");
    judge(1, "squat.depth.shallow", "not_expected");
    judge(2, "squat.depth.shallow", "expected");

    const labels = ClipLabels.parse(window.__capture?.labels);
    expect(labels.cue_labels).toEqual({
      rules: [
        {
          rule_id: "squat.depth.shallow",
          method: "by_eye",
          expected_reps: [1],
          not_expected_reps: [0],
        },
        {
          rule_id: "squat.torso.forward_lean",
          method: "not_judged",
          expected_reps: [],
          not_expected_reps: [],
        },
      ],
    });
  });

  it("drops an undone rep's cue judgements, so indices stay in range", () => {
    render(<CaptureTool />);
    markRep(1000, 1800, 2600);
    markRep(3000, 3700, 4400);
    judge(2, "squat.torso.forward_lean", "expected");
    fireEvent.click(screen.getByRole("button", { name: "Undo last rep" }));

    const labels = ClipLabels.parse(window.__capture?.labels);
    expect(labels.reps).toHaveLength(1);
    expect(labels.cue_labels?.rules.find((r) => r.rule_id === "squat.torso.forward_lean")).toEqual(
      expect.objectContaining({ method: "not_judged", expected_reps: [] }),
    );
    // a new rep starts unjudged, not with the undone rep's judgement
    markRep(5000, 5700, 6400);
    expect(
      (screen.getByLabelText("Rep 2 cue squat.torso.forward_lean") as HTMLSelectElement).value,
    ).toBe("not_judged");
  });

  it("writes no cue labels for an unsupported setup and disables the controls", () => {
    render(<CaptureTool />);
    markRep(1000, 1800, 2600);
    judge(1, "squat.depth.shallow", "expected");
    fireEvent.click(screen.getByLabelText("Supported setup (side view, full body)"));

    const labels = ClipLabels.parse(window.__capture?.labels);
    expect(labels.supported).toBe(false);
    expect(labels.cue_labels).toBeUndefined();
    expect(screen.getByLabelText("Rep 1 cue squat.depth.shallow")).toHaveProperty("disabled", true);
  });

  it("can't record a rep end before a start and bottom", () => {
    render(<CaptureTool />);
    expect(screen.getByRole("button", { name: "Bottom" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Rep end" })).toHaveProperty("disabled", true);
  });

  it("makes no network requests while annotating (video stays local)", () => {
    render(<CaptureTool />);
    markRep(1000, 1800, 2600);
    judge(1, "squat.depth.shallow", "expected");
    expect(window.__capture?.labels?.cue_labels).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
