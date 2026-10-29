import { SummaryCue, SummaryTrackingSpan } from "@fitpilot/exercise-contracts";
import type { ActiveCue } from "@fitpilot/exercise-rules";
import { describe, expect, it } from "vitest";
import type { TrackingSnapshot } from "../engine/tracking";
import { SessionRecorder } from "./recorder";
import { summariseSet } from "./summary";

const EPOCH = Date.UTC(2026, 9, 29, 10, 0, 0);
const ok: TrackingSnapshot = {
  status: "tracking",
  issue: null,
  confidence: 0.9,
  fps: 30,
  slow: false,
};
const nobody: TrackingSnapshot = { ...ok, status: "searching", issue: "no_person", confidence: 0 };

const cue = (tMs: number, rule: "depth" | "lean" = "depth"): ActiveCue =>
  rule === "depth"
    ? {
        rule_id: "squat.depth.shallow",
        ruleset_version: 4,
        message_id: "squat_depth_shallow_v1",
        message: "Try sitting a little deeper if it feels comfortable.",
        measurements: { min_knee_angle_deg: 128.4 },
        priority: 1,
        shown_at_ms: tMs,
        expires_at_ms: tMs + 4000,
      }
    : {
        rule_id: "squat.torso.forward_lean",
        ruleset_version: 4,
        message_id: "squat_torso_forward_lean_v1",
        message: "Try keeping your chest a little more upright as you lower.",
        measurements: { trunk_lean_deg: 63.1, min_knee_angle_deg: 88 },
        priority: 2,
        shown_at_ms: tMs,
        expires_at_ms: tMs + 4000,
      };

const analysis = (phase: string, reps: number, repCompleted = false) => ({
  phase,
  reps,
  repCompleted,
  tracking: { reliable: true, confidence: 0.9 },
});

function recordSet() {
  const r = new SessionRecorder({ exerciseId: "bodyweight_squat" });
  r.startSet(0, EPOCH);
  let reps = 0;
  const rep = (from: number, shown: ActiveCue | null = null) => {
    r.frame({ tMs: from, analysis: analysis("descending", reps), tracking: ok, shown: null });
    reps += 1;
    r.frame({ tMs: from + 1500, analysis: analysis("standing", reps, true), tracking: ok, shown });
  };
  rep(1000, cue(2500));
  r.respond("acknowledged", cue(2500), 3000);
  r.frame({ tMs: 4000, analysis: null, tracking: nobody, shown: null });
  r.frame({ tMs: 7500, analysis: analysis("standing", reps), tracking: ok, shown: null });
  rep(8000, cue(9500, "lean"));
  rep(30_000, cue(31_500));
  r.respond("dismissed", cue(31_500), 32_000);
  rep(33_000);
  r.endSet(36_000, reps);
  return r;
}

describe("summariseSet (FR-06 post-set summary, from recorded events only)", () => {
  it("summarises reps, each cue with its measurements and answer, and unreliable spans", () => {
    const s = summariseSet(recordSet().setEvents)!;
    expect(s).toMatchObject({
      exercise_id: "bodyweight_squat",
      set_index: 0,
      reps: 4,
      completed: true,
    });
    expect(s.cues.map((c) => [c.rule_id, c.response])).toEqual([
      ["squat.depth.shallow", "acknowledged"],
      ["squat.torso.forward_lean", null],
      ["squat.depth.shallow", "dismissed"],
    ]);
    expect(s.cues[1]).toMatchObject({
      ruleset_version: 4,
      message_id: "squat_torso_forward_lean_v1",
      measurements: { trunk_lean_deg: 63.1, min_knee_angle_deg: 88 },
      shown_at: new Date(EPOCH + 9500).toISOString(),
    });
    expect(s.tracking_degraded).toEqual([
      { reason: "no_person", started_at: new Date(EPOCH + 4000).toISOString(), duration_ms: 3500 },
    ]);
    expect(s.degraded_ms).toBe(3500);
  });

  it("produces the contract's summary cue and span shapes", () => {
    const s = summariseSet(recordSet().setEvents)!;
    for (const c of s.cues) expect(SummaryCue.safeParse(c).success).toBe(true);
    for (const t of s.tracking_degraded)
      expect(SummaryTrackingSpan.safeParse(t).success).toBe(true);
  });

  it("counts reps from rep events while the set is still running", () => {
    const events = recordSet().setEvents.filter((e) => e.type !== "set_completed");
    expect(summariseSet(events)).toMatchObject({ reps: 4, completed: false });
  });

  it("is null for a set with nothing recorded", () => {
    expect(summariseSet([])).toBeNull();
  });

  it("ignores an answer that matches no shown cue", () => {
    const r = new SessionRecorder({ exerciseId: "bodyweight_squat" });
    r.startSet(0, EPOCH);
    r.respond("dismissed", cue(0), 100);
    r.endSet(1000, 0);
    expect(summariseSet(r.setEvents)).toMatchObject({ reps: 0, cues: [], completed: true });
  });
});
