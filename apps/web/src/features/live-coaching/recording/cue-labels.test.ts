import { describe, expect, it } from "vitest";
import { formatDuration, formatMeasurement, measurementLines } from "./cue-labels";

describe("cue display text (FR-06)", () => {
  it("formats measurements by unit", () => {
    expect(formatMeasurement(128.4, "deg")).toBe("128°");
    expect(formatMeasurement(812.6, "ms")).toBe("813 ms");
    expect(formatMeasurement(0.456, "ratio")).toBe("0.46");
  });

  it("labels a cue's measurements from its rule, in the rule's order, and drops undeclared keys", () => {
    expect(
      measurementLines("squat_torso_forward_lean_v1", {
        min_knee_angle_deg: 88,
        trunk_lean_deg: 63.2,
        hip_x: 0.4,
      }),
    ).toEqual([
      { key: "trunk_lean_deg", label: "Upper-body lean from vertical at the bottom", value: "63°" },
      { key: "min_knee_angle_deg", label: "Smallest knee angle in the rep", value: "88°" },
    ]);
  });

  it("shows nothing for a cue its rules don't define", () => {
    expect(measurementLines("made_up_v1", { x: 1 })).toEqual([]);
  });

  it("formats span durations", () => {
    expect(formatDuration(3500)).toBe("3.5 s");
    expect(formatDuration(95_000)).toBe("1 min 35 s");
  });
});
