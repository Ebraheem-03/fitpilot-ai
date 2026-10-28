import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ANKLE_HEIGHT, forwardKinematics, SQUAT_PARAMS, squatPose, type WorldPose } from "../src";

/**
 * Joint-range review for the generated squat (risk §15: "validate joint motion and floor
 * contact"). Ranges are plausibility bounds for a bodyweight demo, not coaching thresholds.
 */
const depths = Array.from({ length: 21 }, (_, i) => i / 20);
const deg = (rad: number) => (rad * 180) / Math.PI;
const world = (d: number) => forwardKinematics(squatPose(d));
const angleAt = (a: Vector3, b: Vector3, c: Vector3) =>
  deg(a.clone().sub(b).angleTo(c.clone().sub(b)));

// Approximate segment mass fractions (Dempster/Winter), applied at segment midpoints.
function centreOfMass(w: WorldPose): Vector3 {
  const p = w.position;
  const mid = (a: Vector3, b: Vector3) => a.clone().add(b).multiplyScalar(0.5);
  const parts: [Vector3, number][] = [
    [mid(p.hips, p.neck), 0.497],
    [mid(p.neck, p.head).add(new Vector3(0, 0.08, 0)), 0.081],
  ];
  for (const s of ["l", "r"] as const) {
    parts.push(
      [mid(p[`upper_arm_${s}`], p[`forearm_${s}`]), 0.028],
      [mid(p[`forearm_${s}`], p[`hand_${s}`]), 0.016],
      [p[`hand_${s}`], 0.006],
      [mid(p[`thigh_${s}`], p[`shin_${s}`]), 0.1],
      [mid(p[`shin_${s}`], p[`foot_${s}`]), 0.0465],
      [p[`foot_${s}`].clone().add(new Vector3(0, 0, 0.055)), 0.0145],
    );
  }
  const total = parts.reduce((sum, [, m]) => sum + m, 0);
  return parts
    .reduce((acc, [pos, m]) => acc.add(pos.clone().multiplyScalar(m)), new Vector3())
    .divideScalar(total);
}

describe("squat motion", () => {
  it.each(depths)("keeps both ankles pinned and feet flat at depth %s", (d) => {
    const w = world(d);
    for (const s of ["l", "r"] as const) {
      const x = s === "l" ? 1 : -1;
      const pinned = new Vector3(SQUAT_PARAMS.stanceHalfWidth * x, ANKLE_HEIGHT, 0);
      expect(w.position[`foot_${s}`].distanceTo(pinned)).toBeLessThan(1e-6);
      const up = new Vector3(0, 1, 0).applyQuaternion(w.rotation[`foot_${s}`]);
      expect(up.y).toBeGreaterThan(0.9999);
    }
  });

  it("stands with nearly straight knees", () => {
    const p = world(0).position;
    expect(angleAt(p.thigh_l, p.shin_l, p.foot_l)).toBeGreaterThan(165);
  });

  it("reaches about thighs-parallel at the bottom", () => {
    const p = world(1).position;
    expect(Math.abs(p.thigh_l.y - p.shin_l.y)).toBeLessThan(0.05);
    const knee = angleAt(p.thigh_l, p.shin_l, p.foot_l);
    expect(knee).toBeGreaterThan(60);
    expect(knee).toBeLessThan(100);
  });

  it.each(depths)("keeps the trunk lean within 45° and knees over the toes at depth %s", (d) => {
    const p = world(d).position;
    const trunk = p.neck.clone().sub(p.hips);
    expect(deg(trunk.angleTo(new Vector3(0, 1, 0)))).toBeLessThan(45);
    // no valgus: in the frontal plane the knee never drifts inside the hip→ankle line
    for (const [s, outward] of [
      ["l", 1],
      ["r", -1],
    ] as const) {
      const hip = p[`thigh_${s}`];
      const knee = p[`shin_${s}`];
      const ankle = p[`foot_${s}`];
      const along = (hip.y - knee.y) / (hip.y - ankle.y);
      const lineX = hip.x + (ankle.x - hip.x) * along;
      expect((knee.x - lineX) * outward).toBeGreaterThan(-0.005);
    }
  });

  it.each(depths)("keeps the centre of mass over the feet at depth %s", (d) => {
    const com = centreOfMass(world(d));
    // heel ≈ 6 cm behind the ankle, toes ≈ 17 cm in front (foot mesh in mesh.ts)
    expect(com.z).toBeGreaterThan(-0.06);
    expect(com.z).toBeLessThan(0.17);
  });
});
