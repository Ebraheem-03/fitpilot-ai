import { describe, expect, it } from "vitest";
import type { TrackingSnapshot } from "./engine/tracking";
import { announcement, guidance } from "./labels";
import { LANDMARK_STRIDE, POSE_LANDMARK_COUNT } from "./worker/protocol";

const REQUIRED = ["left_hip", "left_knee", "left_ankle", "left_shoulder"] as const;
const tracking = (patch: Partial<TrackingSnapshot> = {}): TrackingSnapshot => ({
  status: "tracking",
  issue: null,
  confidence: 0.9,
  fps: 30,
  slow: false,
  ...patch,
});
/** shoulder at y=top, ankle at y=bottom */
function body(top: number, bottom: number) {
  const a = new Float32Array(POSE_LANDMARK_COUNT * LANDMARK_STRIDE);
  a[11 * 4 + 1] = top;
  a[23 * 4 + 1] = (top + bottom) / 2;
  a[25 * 4 + 1] = (top + bottom) * 0.6;
  a[27 * 4 + 1] = bottom;
  return a;
}

describe("guidance (FR-04 placement)", () => {
  it.each([
    ["no_person", "Step into view"],
    ["out_of_frame", "Part of you is out of the picture"],
    ["low_light", "It's too dark to track reliably"],
    ["low_visibility", "The tracker can't see your hip, knee and ankle clearly"],
    ["slow_device", "This device is too slow to count reliably"],
    ["unsupported_view", "Turn side-on"],
  ] as const)("%s → %s", (issue, title) => {
    const g = guidance(tracking({ status: "unreliable", issue }), null, REQUIRED);
    expect(g.title).toBe(title);
    expect(g.tone).not.toBe("ok");
  });

  it("suggests moving closer when the body is small in the frame", () => {
    expect(guidance(tracking(), body(0.4, 0.6), REQUIRED).title).toMatch(/closer/);
    expect(guidance(tracking(), body(0.2, 0.85), REQUIRED).title).toBe("Tracking");
  });

  it("never diagnoses the person, only the view", () => {
    for (const issue of [
      "no_person",
      "out_of_frame",
      "low_light",
      "low_visibility",
      "slow_device",
    ] as const) {
      const { title, detail } = guidance(tracking({ issue }), null, REQUIRED);
      expect(`${title} ${detail}`).not.toMatch(/injur|pain|wrong|bad form|unsafe/i);
    }
  });
});

describe("announcement", () => {
  const running = { status: "running", restarts: 0 } as const;
  it("says when reps are paused because tracking isn't reliable", () => {
    expect(announcement(running, tracking({ status: "unreliable", issue: "low_light" }), 4)).toBe(
      "Tracking not reliable. Reps paused at 4.",
    );
  });

  it("confirms the camera is off after stop", () => {
    expect(announcement({ status: "stopped" }, tracking(), 7)).toBe(
      "Stopped. Camera off. 7 reps counted.",
    );
  });

  it("is stable across frames with the same state (no 30 Hz chatter)", () => {
    const a = announcement(running, tracking({ confidence: 0.81, fps: 29 }), 2);
    const b = announcement(running, tracking({ confidence: 0.93, fps: 31 }), 2);
    expect(a).toBe(b);
  });
});
