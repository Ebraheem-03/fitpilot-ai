import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cueRuleViolation } from "@fitpilot/exercise-contracts";
import { describe, expect, it } from "vitest";
import {
  CUE_RULE_DEFINITIONS,
  explainCue,
  type FeedbackCue,
  type LandmarkFrame,
  SQUAT_RULES,
  SQUAT_RULESET,
  SquatAnalyzer,
  type SquatRuleset,
} from "../src";

/**
 * Ruleset v4 (M3 S2): squat.torso.forward_lean, rule declarations and plain-language explanations.
 * Synthetic side view facing right (+x): ankle fixed, knee in front of it, hip behind; the torso
 * (hip → shoulder) leans forward from vertical by `lean` degrees.
 */
function frame(kneeDeg: number, lean: number, vis = 0.95): LandmarkFrame {
  // x = 0.6 keeps a backward-tilted shoulder inside the image (x ≥ 0) for that test
  const knee = { x: 0.6, y: 0.62 };
  const ankle = { x: 0.6, y: 0.87 };
  const r = (kneeDeg * Math.PI) / 180;
  // thigh rotated back from the shin by the knee angle: hip behind (−x) the knee at depth
  const hip = { x: knee.x - 0.25 * Math.sin(r), y: knee.y + 0.25 * Math.cos(r) };
  const l = (lean * Math.PI) / 180;
  const shoulder = { x: hip.x + 0.3 * Math.sin(l), y: hip.y - 0.3 * Math.cos(l) };
  return {
    left_hip: { ...hip, visibility: vis },
    left_knee: { ...knee, visibility: vis },
    left_ankle: { ...ankle, visibility: vis },
    left_shoulder: { ...shoulder, visibility: vis },
  };
}

/** One rep: knee 175° → bottom → 175°, torso leaning `lean(knee)` degrees; returns every result. */
function rep(a: SquatAnalyzer, { bottom = 80, leanAtBottom = 30, t0 = 0, dt = 33 } = {}) {
  const leanAt = (k: number) => 5 + ((175 - k) / (175 - bottom)) * (leanAtBottom - 5);
  const out = [];
  let t = t0;
  for (let k = 175; k >= bottom; k -= 3) out.push(a.step(frame(k, leanAt(k)), (t += dt)));
  for (let k = bottom; k <= 175; k += 3) out.push(a.step(frame(k, leanAt(k)), (t += dt)));
  for (let i = 0; i < 10; i++) out.push(a.step(frame(175, 5), (t += dt)));
  return { out, t, done: out.find((r) => r.repCompleted) };
}

const leanCue = (cues: FeedbackCue[]) => cues.find((c) => c.rule_id === "squat.torso.forward_lean");

describe("SquatAnalyzer ruleset v4", () => {
  it("is version 4, and the catalogue entry declares the same version", () => {
    expect(SQUAT_RULESET.version).toBe(4);
    const catalog = JSON.parse(
      readFileSync(join(__dirname, "../../../data/exercise-catalog/bodyweight_squat.json"), "utf8"),
    );
    expect(catalog.ruleset_version).toBe(SQUAT_RULESET.version);
  });

  it("emits a forward-lean cue when the torso leans past the limit at the bottom", () => {
    const lean = SQUAT_RULESET.maxTrunkLeanDeg + 10;
    const { done } = rep(new SquatAnalyzer(), { leanAtBottom: lean });
    const c = leanCue(done!.cues);
    expect(c).toMatchObject({
      rule_id: "squat.torso.forward_lean",
      ruleset_version: 4,
      message_id: "squat_torso_forward_lean_v1",
    });
    // measured at the bottom (smoothed), so close to the scripted lean there
    expect(c!.measurements.trunk_lean_deg).toBeGreaterThan(SQUAT_RULESET.maxTrunkLeanDeg);
    expect(c!.measurements.trunk_lean_deg).toBeCloseTo(lean, -1);
    expect(c!.measurements.min_knee_angle_deg).toBeLessThan(90);
  });

  it("doesn't cue a lean within the limit (some forward lean is normal in a squat)", () => {
    const { done } = rep(new SquatAnalyzer(), { leanAtBottom: SQUAT_RULESET.maxTrunkLeanDeg - 10 });
    expect(done).toBeDefined();
    expect(done!.cues).toEqual([]);
  });

  it("judges the lean at the bottom of the rep, not a brief lean on the way up", () => {
    const a = new SquatAnalyzer();
    let t = 0;
    const out = [];
    for (let k = 175; k >= 80; k -= 3) out.push(a.step(frame(k, 30), (t += 33)));
    // leans far forward only in the upper half of the ascent
    for (let k = 80; k <= 175; k += 3) out.push(a.step(frame(k, k > 130 ? 80 : 30), (t += 33)));
    for (let i = 0; i < 10; i++) out.push(a.step(frame(175, 5), (t += 33)));
    const done = out.find((r) => r.repCompleted);
    expect(done).toBeDefined();
    expect(done!.cues).toEqual([]);
  });

  it("doesn't call a backward-tilted torso a forward lean (implausible for a squat)", () => {
    const { done } = rep(new SquatAnalyzer(), {
      leanAtBottom: -(SQUAT_RULESET.maxTrunkLeanDeg + 10),
    });
    expect(done).toBeDefined();
    expect(leanCue(done!.cues)).toBeUndefined();
  });

  it("emits no lean cue for a rep that isn't counted", () => {
    // too shallow to count (v3 depth-to-count) yet leaning far forward
    const { out } = rep(new SquatAnalyzer(), { bottom: 150, leanAtBottom: 85 });
    expect(out.every((r) => r.cues.length === 0)).toBe(true);
  });

  it("emits nothing while tracking is unreliable", () => {
    const a = new SquatAnalyzer();
    const r = a.step(frame(80, 85, 0.2), 0);
    expect(r.tracking.reliable).toBe(false);
    expect(r.cues).toEqual([]);
  });

  it("can emit both rules on one rep; the cue selector then picks by priority", () => {
    // shallow (> 120°) but still deep enough to count (≤ 140°), leaning far forward
    const { done } = rep(new SquatAnalyzer(), { bottom: 128, leanAtBottom: 85 });
    expect(done!.cues.map((c) => c.rule_id).sort()).toEqual([
      "squat.depth.shallow",
      "squat.torso.forward_lean",
    ]);
  });

  it("keeps v3's behaviour reproducible: lean rule off, same counts, only depth cues", () => {
    const v3: SquatRuleset = { ...SQUAT_RULESET, version: 3, maxTrunkLeanDeg: Infinity };
    const a = new SquatAnalyzer(v3);
    const { done } = rep(a, { leanAtBottom: 85 });
    expect(done!.reps).toBe(1);
    expect(done!.cues).toEqual([]);
  });

  it("reports the trunk lean as a feature while tracking", () => {
    const r = new SquatAnalyzer().step(frame(100, 40), 0);
    expect(r.features?.trunk_lean_deg).toBeCloseTo(40, 0);
  });
});

describe("cue rule declarations and explanations", () => {
  it("declares every squat rule with a unique rule_id and message_id", () => {
    expect(SQUAT_RULES.map((r) => r.rule_id).sort()).toEqual([
      "squat.depth.shallow",
      "squat.torso.forward_lean",
    ]);
    const ids = CUE_RULE_DEFINITIONS.map((r) => r.message_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("emitted cues use exactly the declared message, priority and measurements", () => {
    const { done } = rep(new SquatAnalyzer(), { bottom: 128, leanAtBottom: 85 });
    expect(done!.cues).toHaveLength(2);
    for (const c of done!.cues) {
      // accepted by the session-event contract (declared rule + measurement keys, ADR-0011)
      expect(
        cueRuleViolation(
          c.rule_id,
          "bodyweight_squat",
          Object.keys(c.measurements),
          c.ruleset_version,
        ),
      ).toBeNull();
      const def = SQUAT_RULES.find((r) => r.rule_id === c.rule_id)!;
      expect(c).toMatchObject({
        message_id: def.message_id,
        message: def.message,
        priority: def.priority,
      });
      expect(Object.keys(c.measurements).sort()).toEqual(Object.keys(def.measurements).sort());
    }
  });

  it.each(CUE_RULE_DEFINITIONS.map((r) => [r.message_id, r] as const))(
    "%s has a plain-language explanation and labelled measurements",
    (messageId, rule) => {
      const e = explainCue(messageId);
      expect(e).toBeDefined();
      expect(e!.message).toBe(rule.message);
      expect(e!.explanation.length).toBeGreaterThan(60);
      for (const m of Object.values(rule.measurements)) expect(m.label.length).toBeGreaterThan(3);
    },
  );

  it.each(CUE_RULE_DEFINITIONS.map((r) => [r.message_id, r] as const))(
    "%s describes movement, never a medical or safety conclusion",
    (_id, rule) => {
      const text = `${rule.message} ${rule.explanation}`;
      expect(text).not.toMatch(
        /injur|pain|hurt|danger|unsafe|\bsafe|risk|damage|harm|diagnos|medical|wrong|bad form|strain/i,
      );
    },
  );

  it("returns undefined for an unknown message_id (the UI must not invent one)", () => {
    expect(explainCue("squat_made_up_v9")).toBeUndefined();
  });
});
