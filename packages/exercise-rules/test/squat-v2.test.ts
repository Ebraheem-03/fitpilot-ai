import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LandmarkFixture } from "@fitpilot/exercise-contracts";
import { describe, expect, it } from "vitest";
import { decodeFrames, type LandmarkFrame, SQUAT_RULESET, SquatAnalyzer } from "../src";

/**
 * Ruleset v2 robustness (M2 S4): side selection, geometric plausibility, wrong-view detection,
 * mid-rep tracking loss and frame-rate independence. Synthetic side view: knee fixed, ankle
 * straight below, hip rotated by the knee angle, shoulder above the hip.
 */
type Side = "left" | "right";
function leg(
  deg: number,
  side: Side,
  opts: { vis?: number; dx?: number; fold?: boolean; facing?: Side } = {},
) {
  const v = opts.vis ?? 0.95;
  const dx = opts.dx ?? 0;
  const knee = { x: 0.5 + dx, y: 0.6 };
  const ankle = opts.fold ? { x: 0.5 + dx, y: 0.55 } : { x: 0.5 + dx, y: 0.85 };
  const rad = (deg * Math.PI) / 180;
  // both legs bend the same way in a side view; it depends on which way the person faces
  const dir = (opts.facing ?? side) === "left" ? 1 : -1;
  const hip = { x: knee.x + dir * 0.25 * Math.sin(rad), y: knee.y + 0.25 * Math.cos(rad) };
  const shoulder = { x: hip.x, y: hip.y - 0.3 };
  return {
    [`${side}_hip`]: { ...hip, visibility: v },
    [`${side}_knee`]: { ...knee, visibility: v },
    [`${side}_ankle`]: { ...ankle, visibility: v },
    [`${side}_shoulder`]: { ...shoulder, visibility: v },
  } as LandmarkFrame;
}

/** Runs `reps` squats from 175° down to `bottom` and back at `fps`; returns rep count. */
function squats(
  a: SquatAnalyzer,
  frame: (deg: number) => LandmarkFrame,
  { reps = 3, bottom = 85, fps = 30, start = 0 } = {},
) {
  const dt = 1000 / fps;
  const stepDeg = (90 * dt) / 1000 / 0.9; // ~0.9 s down, 0.9 s up regardless of fps
  let t = start;
  for (let r = 0; r < reps; r++) {
    for (let d = 175; d >= bottom; d -= stepDeg) a.step(frame(d), (t += dt));
    for (let d = bottom; d <= 175; d += stepDeg) a.step(frame(d), (t += dt));
    for (let i = 0; i < fps / 2; i++) a.step(frame(175), (t += dt));
  }
  return { reps: a.step(frame(175), (t += dt)).reps, t };
}

describe("SquatAnalyzer ruleset v2", () => {
  // v4 (squat-v4.test.ts) only adds a cue rule: everything below still holds
  it("is version 3 or later", () => expect(SQUAT_RULESET.version).toBeGreaterThanOrEqual(3));

  it("counts a person facing the other way (right side towards the camera)", () => {
    expect(squats(new SquatAnalyzer(), (d) => leg(d, "right")).reps).toBe(3);
  });

  it("uses the plausible side when the near leg's landmarks fold (ankle above knee)", () => {
    const frame = (d: number) => ({
      ...leg(d, "right", { vis: 0.7, facing: "left" }),
      ...leg(d, "left", { fold: d > 150 }), // collapses while standing, like the full model
    });
    expect(squats(new SquatAnalyzer(), frame).reps).toBe(3);
  });

  it("withholds when no side is plausible", () => {
    const r = new SquatAnalyzer().step(leg(170, "left", { fold: true }), 0);
    expect(r.tracking.reliable).toBe(false);
    expect(r.features).toBeNull();
  });

  it("flags a front-on view as unsupported and counts nothing", () => {
    const front = (d: number) => {
      const l = leg(d, "left", { dx: -0.12 });
      const r = leg(d, "right", { dx: 0.12 });
      // facing the camera: both shoulders fully visible and far apart
      r.right_shoulder = { ...r.right_shoulder!, x: l.left_shoulder!.x + 0.24 };
      return { ...l, ...r };
    };
    const a = new SquatAnalyzer();
    const out = a.step(front(170), 0);
    expect(out.tracking).toMatchObject({ reliable: false, reason: "unsupported_view" });
    expect(squats(a, front).reps).toBe(0);
  });

  it("abandons a rep when tracking is lost mid-rep for longer than the gap limit", () => {
    const a = new SquatAnalyzer();
    let t = 0;
    for (let d = 175; d >= 90; d -= 3) a.step(leg(d, "left"), (t += 33));
    t += SQUAT_RULESET.maxGapMs + 200; // person left the frame at the bottom
    for (let d = 120; d <= 175; d += 3) a.step(leg(d, "left"), (t += 33));
    for (let i = 0; i < 10; i++) a.step(leg(175, "left"), (t += 33));
    expect(a.step(leg(175, "left"), (t += 33)).reps).toBe(0);
  });

  it("keeps a rep through a short dropout", () => {
    const a = new SquatAnalyzer();
    let t = 0;
    for (let d = 175; d >= 90; d -= 3) a.step(leg(d, "left"), (t += 33));
    for (let i = 0; i < 5; i++) a.step({}, (t += 33)); // 165 ms of nothing
    for (let d = 90; d <= 175; d += 3) a.step(leg(d, "left"), (t += 33));
    for (let i = 0; i < 10; i++) a.step(leg(175, "left"), (t += 33));
    expect(a.step(leg(175, "left"), (t += 33)).reps).toBe(1);
  });

  it("doesn't mistake a deep, forward-leaning side-view squat for a front view", () => {
    // bottom of a squat, torso leaning forward: shoulders well ahead of the hips and only a
    // little above them; the far shoulder is (wrongly) reported visible, slightly offset
    const frame: LandmarkFrame = {
      ...leg(85, "left"),
      left_shoulder: { x: 0.62, y: 0.47, visibility: 0.95 },
      right_shoulder: { x: 0.69, y: 0.47, visibility: 0.9 },
      left_hip: {
        x: 0.75 - 0.25 * Math.sin((85 * Math.PI) / 180) + 0.0,
        y: 0.62,
        visibility: 0.95,
      },
      right_hip: { x: 0.5, y: 0.62, visibility: 0.5 },
    };
    const r = new SquatAnalyzer().step(frame, 0);
    expect(r.tracking.reason).not.toBe("unsupported_view");
  });

  it("rejects a leg whose segments are implausibly short or long for the torso", () => {
    const short = leg(170, "left");
    short.left_ankle = { ...short.left_knee!, y: short.left_knee!.y + 0.05 }; // shin 0.05 vs torso 0.3
    expect(new SquatAnalyzer().step(short, 0).tracking.reliable).toBe(false);
    const long = leg(170, "left");
    long.left_ankle = { ...long.left_knee!, y: long.left_knee!.y + 0.5 }; // shin 0.5 vs torso 0.3
    expect(new SquatAnalyzer().step(long, 0).tracking.reliable).toBe(false);
  });

  it("rejects a shoulder drawn below the hip", () => {
    const f = leg(170, "left");
    f.left_shoulder = { ...f.left_shoulder!, y: f.left_hip!.y + 0.1 };
    expect(new SquatAnalyzer().step(f, 0).tracking.reliable).toBe(false);
  });

  it("keeps counting when the measured side switches mid-rep", () => {
    const a = new SquatAnalyzer();
    let t = 0;
    // descend on the left leg; at the bottom the left leg disappears and only the right remains
    for (let d = 175; d >= 90; d -= 3) a.step(leg(d, "left"), (t += 33));
    for (let d = 90; d <= 175; d += 3) a.step(leg(d, "right", { facing: "left" }), (t += 33));
    for (let i = 0; i < 10; i++) a.step(leg(175, "right", { facing: "left" }), (t += 33));
    expect(a.step(leg(175, "right", { facing: "left" }), (t += 33)).reps).toBe(1);
  });

  it("doesn't infer a direction of movement across a long gap", () => {
    const a = new SquatAnalyzer();
    let t = 0;
    for (let i = 0; i < 20; i++) a.step(leg(175, "left"), (t += 33));
    t += SQUAT_RULESET.maxGapMs + 500;
    // back in view already bent: we never saw the descent, so this frame alone can't start a rep
    const r = a.step(leg(95, "left"), (t += 33));
    expect(r.phase).toBe("standing");
    expect(r.features?.knee_angle_deg).toBeCloseTo(95, 0);
  });

  it("doesn't count a dip that never gets near squat depth (v3)", () => {
    expect(squats(new SquatAnalyzer(), (d) => leg(d, "left"), { bottom: 150 }).reps).toBe(0);
    expect(squats(new SquatAnalyzer(), (d) => leg(d, "left"), { bottom: 125 }).reps).toBe(3); // smoothing keeps the counted minimum a little above the raw one
  });

  it("doesn't count a knee bend whose feet travel (a step or lunge, v3)", () => {
    let shift = 0;
    const walking = (d: number) => leg(d, "left", { dx: (shift += 0.004) });
    expect(squats(new SquatAnalyzer(), walking, { reps: 1 }).reps).toBe(0);
  });

  it("withholds with out_of_frame when a required landmark is outside the image (v3)", () => {
    const f = leg(170, "left");
    f.left_ankle = { ...f.left_ankle!, y: 1.08 }; // feet cut off: the model extrapolates
    expect(new SquatAnalyzer().step(f, 0).tracking).toMatchObject({
      reliable: false,
      reason: "out_of_frame",
    });
  });

  it("withholds a three-quarter view detected from depth (yaw, v3)", () => {
    const f: LandmarkFrame = {
      ...leg(170, "left"),
      // side-on would put one shoulder/hip behind the other (Δz ≫ Δx); 45° gives Δz ≈ Δx
      left_shoulder: { x: 0.5, y: 0.3, z: 0, visibility: 0.95 },
      right_shoulder: { x: 0.56, y: 0.3, z: 0.06, visibility: 0.4 },
      left_hip: { ...leg(170, "left").left_hip!, z: 0 },
      right_hip: { x: leg(170, "left").left_hip!.x + 0.05, y: 0.6, z: 0.05, visibility: 0.4 },
    };
    expect(new SquatAnalyzer().step(f, 0).tracking.reason).toBe("unsupported_view");
  });

  it.each([10, 15, 30, 60])("counts the same squats at %i fps", (fps) => {
    expect(squats(new SquatAnalyzer(), (d) => leg(d, "left"), { fps }).reps).toBe(3);
  });

  it("counts the full model's mannequin clip that v1 scored 0/5 on", () => {
    const dir = join(__dirname, "../../../data/evaluation-fixtures/vision/bodyweight_squat");
    const fixture = LandmarkFixture.parse(
      JSON.parse(readFileSync(join(dir, "mannequin_side_full.landmarks.json"), "utf8")),
    );
    const a = new SquatAnalyzer();
    let reps = 0;
    for (const { tMs, frame } of decodeFrames(fixture)) reps = a.step(frame, tMs).reps;
    expect(reps).toBe(5);
  });
});
