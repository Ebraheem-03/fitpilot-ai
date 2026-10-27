import { describe, expect, it } from "vitest";
import { Ema, jointAngle } from "../src";

describe("jointAngle", () => {
  it("is 90° for a right angle", () => {
    expect(jointAngle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90);
  });
  it("is 180° for a straight line", () => {
    expect(jointAngle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180);
  });
  it("returns null for degenerate input instead of NaN", () => {
    expect(jointAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
});

describe("Ema", () => {
  it("skips null samples without decaying", () => {
    const e = new Ema(0.5);
    e.push(10);
    expect(e.push(null)).toBe(10);
    expect(e.push(20)).toBe(15);
  });
});
