import { describe, expect, it } from "vitest";
import { type FrameObservation, TrackingMonitor } from "./tracking";

const good = (tMs: number, extra: Partial<FrameObservation> = {}): FrameObservation => ({
  tMs,
  personDetected: true,
  analysisReliable: true,
  confidence: 0.9,
  outOfFrame: false,
  luma: 0.5,
  ...extra,
});

/** Feeds frames at `fps` from `from` for `ms`, returning the last snapshot. */
function feed(m: TrackingMonitor, from: number, ms: number, fps: number, obs = good) {
  let snap = m.snapshot;
  for (let t = from; t < from + ms; t += 1000 / fps) snap = m.observe(obs(Math.round(t)));
  return snap;
}

describe("TrackingMonitor (FR-04 tracking status)", () => {
  it("starts out searching", () => {
    expect(new TrackingMonitor().snapshot).toMatchObject({
      status: "searching",
      issue: "no_person",
    });
  });

  it("reports tracking once reliable frames persist past the settle time", () => {
    const m = new TrackingMonitor();
    expect(feed(m, 0, 200, 30).status).toBe("searching");
    expect(feed(m, 200, 400, 30)).toMatchObject({ status: "tracking", issue: null });
  });

  it("doesn't flicker on a single bad frame", () => {
    const m = new TrackingMonitor();
    feed(m, 0, 1000, 30);
    m.observe(good(1010, { personDetected: false }));
    expect(feed(m, 1040, 100, 30).status).toBe("tracking");
  });

  it.each([
    [{ personDetected: false }, "searching", "no_person"],
    [{ analysisReliable: false, outOfFrame: true }, "unreliable", "out_of_frame"],
    [{ analysisReliable: false, luma: 0.08 }, "unreliable", "low_light"],
    [{ analysisReliable: false }, "unreliable", "low_visibility"],
  ] as const)("explains why: %o → %s/%s", (extra, status, issue) => {
    const m = new TrackingMonitor();
    feed(m, 0, 1000, 30);
    expect(feed(m, 1000, 600, 30, (t) => good(t, extra))).toMatchObject({ status, issue });
  });

  it("measures processed fps over a rolling window", () => {
    const m = new TrackingMonitor();
    expect(feed(m, 0, 3000, 24).fps).toBeCloseTo(24, 0);
  });

  it("flags a slow device but keeps tracking between the two thresholds", () => {
    const m = new TrackingMonitor();
    expect(feed(m, 0, 3000, 12)).toMatchObject({ status: "tracking", slow: true });
  });

  it("withholds analysis below the minimum fps (ADR-0010)", () => {
    const m = new TrackingMonitor();
    const snap = feed(m, 0, 3000, 6);
    expect(snap).toMatchObject({ status: "unreliable", issue: "slow_device" });
    expect(m.analysisAllowed).toBe(false);
  });

  it("doesn't judge fps before a full window", () => {
    const m = new TrackingMonitor();
    feed(m, 0, 600, 5);
    expect(m.analysisAllowed).toBe(true);
    expect(m.snapshot.fps).toBeNull();
  });

  it("resets to searching", () => {
    const m = new TrackingMonitor();
    feed(m, 0, 1000, 30);
    m.reset();
    expect(m.snapshot).toMatchObject({ status: "searching", fps: null });
  });
});
