import { describe, expect, it } from "vitest";
import { feedDurationMs, feedFrameAt, type FeedPlan, SHALLOW_MOTION } from "./feed-timeline";

const base: FeedPlan = {
  width: 320,
  height: 240,
  fps: 15,
  leadInMs: 1000,
  loops: 3,
  hiddenLoops: [1],
};
const shallow: FeedPlan = { ...base, motion: SHALLOW_MOTION };

describe("feed timeline (ADR-0010 §8 synthetic camera)", () => {
  it("full motion: stands through the lead-in, then loops the clip with hidden loops empty", () => {
    expect(feedFrameAt(base, 4000, 500)).toEqual({ clipMs: 0, hidden: false });
    expect(feedFrameAt(base, 4000, 1000 + 2200)).toEqual({ clipMs: 2200, hidden: false });
    expect(feedFrameAt(base, 4000, 1000 + 4000 + 100)).toEqual({ clipMs: 100, hidden: true });
    expect(feedDurationMs(base, 4000)).toBe(13_000);
  });

  it("shallow motion never goes past the peak pose and comes back up the same poses", () => {
    const clip = (t: number) => feedFrameAt(shallow, 4000, t).clipMs;
    const samples = Array.from({ length: 350 }, (_, i) => clip(1000 + i * 10));
    expect(Math.max(...samples)).toBe(SHALLOW_MOTION.peakMs);
    expect(Math.min(...samples)).toBe(0);
    // symmetric: halfway down equals halfway up
    const { descentMs, holdMs } = SHALLOW_MOTION;
    const half = 1000 + 500 + descentMs / 2;
    expect(clip(half)).toBeCloseTo(clip(half + descentMs + holdMs), 6);
    // held at the peak
    expect(clip(1000 + 500 + descentMs + holdMs / 2)).toBe(SHALLOW_MOTION.peakMs);
    expect(feedDurationMs(shallow, 4000)).toBe(1000 + 3 * SHALLOW_MOTION.loopMs);
  });

  it("shallow motion hides whole loops", () => {
    const loop1 = 1000 + SHALLOW_MOTION.loopMs + 10;
    expect(feedFrameAt(shallow, 4000, loop1).hidden).toBe(true);
    expect(feedFrameAt(shallow, 4000, loop1 + SHALLOW_MOTION.loopMs).hidden).toBe(false);
  });
});
