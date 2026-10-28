import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadExerciseFixtures } from "./load";

const gate = {
  runtime_model: "pose_landmarker_lite",
  min_precision: 0.95,
  min_recall: 0.9,
  match_tolerance_ms: 300,
  min_recorded_clips: 0,
};
const landmarks = {
  format_version: 1,
  clip_id: "a",
  exercise_id: "ex",
  source: {
    kind: "synthetic",
    model: "pose_landmarker_lite",
    tasks_vision_version: "1.1.1",
    width: 1,
    height: 1,
    fps: 30,
  },
  landmark_names: ["left_hip"],
  frames: [{ t_ms: 0, p: [0, 0, 0, 1] }],
};
const labels = {
  format_version: 1,
  clip_id: "a",
  exercise_id: "ex",
  camera_view: "side",
  supported: true,
  conditions: { lighting: "normal", clothing: "fitted" },
  reps: [],
  untrackable_ranges_ms: [],
  annotated_by: "test",
};

function dir(files: Record<string, unknown>) {
  const d = mkdtempSync(join(tmpdir(), "fixtures-"));
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(d, name), JSON.stringify(body));
  return d;
}

describe("loadExerciseFixtures", () => {
  it("loads a valid pair", () => {
    const d = dir({ "gate.json": gate, "a.landmarks.json": landmarks, "a.labels.json": labels });
    expect(loadExerciseFixtures(d, "ex").clips).toHaveLength(1);
  });

  it("fails loudly on a malformed file, naming it", () => {
    const bad = { ...landmarks, frames: [{ t_ms: 0, p: [0, 0] }] };
    const d = dir({ "gate.json": gate, "a.landmarks.json": bad, "a.labels.json": labels });
    expect(() => loadExerciseFixtures(d, "ex")).toThrow(/a\.landmarks\.json.*expected 4 numbers/s);
  });

  it("fails on an unpaired file", () => {
    expect(() =>
      loadExerciseFixtures(dir({ "gate.json": gate, "a.landmarks.json": landmarks }), "ex"),
    ).toThrow("has no labels file");
    expect(() =>
      loadExerciseFixtures(dir({ "gate.json": gate, "a.labels.json": labels }), "ex"),
    ).toThrow("has no landmarks file");
  });

  it("fails on a misnamed file instead of ignoring it", () => {
    const d = dir({ "gate.json": gate, "a.landmark.json": landmarks });
    expect(() => loadExerciseFixtures(d, "ex")).toThrow("unexpected file(s) a.landmark.json");
  });

  it("fails without a gate", () => {
    expect(() => loadExerciseFixtures(dir({}), "ex")).toThrow("gate.json");
  });

  it("fails when ids disagree with file names", () => {
    const d = dir({
      "gate.json": gate,
      "a.landmarks.json": landmarks,
      "a.labels.json": { ...labels, exercise_id: "other" },
    });
    expect(() => loadExerciseFixtures(d, "ex")).toThrow("must match");
  });
});
