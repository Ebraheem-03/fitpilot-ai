import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { limbRotation, solveTwoBone } from "../src";

describe("solveTwoBone", () => {
  const root = new Vector3(0, 1, 0);
  const pole = new Vector3(0, 0, 1);

  it("keeps both segment lengths and reaches a reachable target", () => {
    const target = new Vector3(0.1, 0.3, 0.05);
    const { joint, end } = solveTwoBone(root, target, 0.42, 0.4, pole);
    expect(joint.distanceTo(root)).toBeCloseTo(0.42, 6);
    expect(joint.distanceTo(end)).toBeCloseTo(0.4, 6);
    expect(end.distanceTo(target)).toBeCloseTo(0, 6);
  });

  it("bends towards the pole", () => {
    const { joint } = solveTwoBone(root, new Vector3(0, 0.4, 0), 0.42, 0.4, pole);
    expect(joint.z).toBeGreaterThan(0.2);
  });

  it("never stretches past full extension", () => {
    const { joint, end } = solveTwoBone(root, new Vector3(0, -2, 0), 0.42, 0.4, pole);
    expect(joint.distanceTo(root)).toBeCloseTo(0.42, 6);
    expect(end.distanceTo(joint)).toBeCloseTo(0.4, 3);
  });
});

describe("limbRotation", () => {
  it("maps the bone's -Y onto the from→to direction", () => {
    const from = new Vector3(0, 1, 0);
    const to = new Vector3(0.3, 0.6, 0.2);
    const q = limbRotation(from, to, new Vector3(0, 0, 1));
    const down = new Vector3(0, -1, 0).applyQuaternion(q);
    expect(down.distanceTo(to.clone().sub(from).normalize())).toBeCloseTo(0, 6);
  });
});
