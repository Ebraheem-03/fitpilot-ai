import { cueRuleViolation } from "@fitpilot/exercise-contracts";
import { describe, expect, it } from "vitest";
import { type LandmarkFrame, SquatAnalyzer } from "../src";

/**
 * Synthetic side-view frames: hip above knee, ankle below knee; knee angle set by moving the hip.
 * These unit tests prove the state machine logic. They are NOT a substitute for the annotated
 * real-recording regression fixtures required by FR-05 (see data/evaluation-fixtures/vision).
 */
function frameAtKneeAngle(deg: number, visibility = 0.95): LandmarkFrame {
  const knee = { x: 0.5, y: 0.6 };
  const ankle = { x: 0.5, y: 0.85 }; // straight down from knee
  const rad = (deg * Math.PI) / 180;
  // hip placed at `deg` from the knee→ankle vector
  const hip = { x: knee.x + 0.25 * Math.sin(rad), y: knee.y + 0.25 * Math.cos(rad) };
  const shoulder = { x: hip.x, y: hip.y - 0.3 };
  return {
    left_hip: { ...hip, visibility },
    left_knee: { ...knee, visibility },
    left_ankle: { ...ankle, visibility },
    left_shoulder: { ...shoulder, visibility },
  };
}

function runReps(analyzer: SquatAnalyzer, bottom: number, reps: number, startMs = 0) {
  let t = startMs;
  const out = [];
  for (let r = 0; r < reps; r++) {
    for (let a = 175; a >= bottom; a -= 3) out.push(analyzer.step(frameAtKneeAngle(a), (t += 33)));
    for (let a = bottom; a <= 175; a += 3) out.push(analyzer.step(frameAtKneeAngle(a), (t += 33)));
    for (let i = 0; i < 5; i++) out.push(analyzer.step(frameAtKneeAngle(175), (t += 33)));
  }
  return out;
}

describe("SquatAnalyzer", () => {
  it("counts full-depth reps exactly once each", () => {
    const a = new SquatAnalyzer();
    const out = runReps(a, 85, 3);
    expect(out.at(-1)!.reps).toBe(3);
    expect(out.filter((r) => r.repCompleted)).toHaveLength(3);
  });

  it("does not double count from jitter while standing", () => {
    const a = new SquatAnalyzer();
    let t = 0;
    for (let i = 0; i < 100; i++) a.step(frameAtKneeAngle(170 + (i % 2 ? 2 : -2)), (t += 33));
    expect(a.step(frameAtKneeAngle(170), (t += 33)).reps).toBe(0);
  });

  it("emits a traceable shallow-depth cue with its measurements", () => {
    const a = new SquatAnalyzer();
    const done = runReps(a, 130, 1).find((r) => r.repCompleted)!;
    expect(done).toBeDefined();
    expect(done.cues[0]?.rule_id).toBe("squat.depth.shallow");
    expect(done.cues[0]?.measurements.min_knee_angle_deg).toBeGreaterThan(120);
  });

  it("only emits cues the session-event contract accepts (declared rule + measurement keys)", () => {
    const cues = runReps(new SquatAnalyzer(), 130, 1).flatMap((r) => r.cues);
    expect(cues.length).toBeGreaterThan(0);
    for (const cue of cues) {
      expect(
        cueRuleViolation(
          cue.rule_id,
          "bodyweight_squat",
          Object.keys(cue.measurements),
          cue.ruleset_version,
        ),
      ).toBeNull();
    }
  });

  it("withholds analysis and cues when landmarks are not visible", () => {
    const a = new SquatAnalyzer();
    const r = a.step(frameAtKneeAngle(90, 0.2), 0);
    expect(r.tracking.reliable).toBe(false);
    expect(r.features).toBeNull();
    expect(r.cues).toEqual([]);
  });
});
