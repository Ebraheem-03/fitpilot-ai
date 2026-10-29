import { SessionEvent } from "@fitpilot/exercise-contracts";
import type { ActiveCue } from "@fitpilot/exercise-rules";
import { describe, expect, it, vi } from "vitest";
import type { TrackingIssue, TrackingSnapshot } from "../engine/tracking";
import { type FrameRecord, MIN_DEGRADED_MS, SessionRecorder } from "./recorder";

const SESSION = "6f1c1f0e-7a52-4c47-9a39-2b7d0e6f3a11";
const EPOCH = Date.UTC(2026, 9, 29, 10, 0, 0);

const ok: TrackingSnapshot = {
  status: "tracking",
  issue: null,
  confidence: 0.9,
  fps: 30,
  slow: false,
};
const bad = (issue: TrackingIssue): TrackingSnapshot => ({
  status: issue === "no_person" ? "searching" : "unreliable",
  issue,
  confidence: 0,
  fps: 30,
  slow: false,
});

const shallowCue = (tMs: number, measurements = { min_knee_angle_deg: 131.2 }): ActiveCue => ({
  rule_id: "squat.depth.shallow",
  ruleset_version: 4,
  message_id: "squat_depth_shallow_v1",
  message: "Try sitting a little deeper if it feels comfortable.",
  measurements,
  priority: 1,
  shown_at_ms: tMs,
  expires_at_ms: tMs + 4000,
});

function frame(tMs: number, over: Partial<FrameRecord> & { phase?: string; rep?: number } = {}) {
  const { phase = "standing", rep, ...rest } = over;
  return {
    tMs,
    analysis: {
      phase,
      reps: rep ?? 0,
      repCompleted: rep !== undefined,
      tracking: { reliable: true, confidence: 0.9 },
    },
    tracking: ok,
    shown: null,
    ...rest,
  } satisfies FrameRecord;
}

function recorder(opts: Partial<ConstructorParameters<typeof SessionRecorder>[0]> = {}) {
  const r = new SessionRecorder({ exerciseId: "bodyweight_squat", sessionId: SESSION, ...opts });
  r.startSet(0, EPOCH);
  return r;
}

/** one squat rep: descend at `from`, back up and counted at `from + 1500` */
function rep(r: SessionRecorder, from: number, n: number, shown: ActiveCue | null = null) {
  r.frame(frame(from - 33));
  r.frame(frame(from, { phase: "descending" }));
  r.frame(frame(from + 700, { phase: "ascending" }));
  r.frame(frame(from + 1500, { rep: n, shown }));
}

describe("SessionRecorder (FR-06/FR-07 events from the live engine, ADR-0011)", () => {
  it("records a counted rep with its duration, and every event validates as a SessionEvent", () => {
    const r = recorder();
    rep(r, 1000, 1);
    rep(r, 3000, 2);
    r.endSet(5000, 2);
    const events = r.setEvents;
    expect(events.map((e) => e.type)).toEqual(["rep_completed", "rep_completed", "set_completed"]);
    for (const e of events) expect(SessionEvent.safeParse(e).success).toBe(true);
    expect(events[0]).toMatchObject({
      session_id: SESSION,
      exercise_id: "bodyweight_squat",
      set_index: 0,
      rep_index: 0,
      duration_ms: 1500,
      tracking_confidence: 0.9,
      occurred_at: new Date(EPOCH + 2500).toISOString(),
    });
    expect(events[1]).toMatchObject({ rep_index: 1 });
    expect(events[2]).toMatchObject({ type: "set_completed", set_index: 0, reps: 2 });
    expect(r.rejected).toEqual([]);
  });

  it("records exactly one feedback_shown per shown cue, with the rule's measurements", () => {
    const r = recorder();
    const cue = shallowCue(2500);
    rep(r, 1000, 1, cue);
    // the cue stays active on later frames, but `shown` is only set on the step it appeared
    for (let t = 2533; t < 4000; t += 33) r.frame(frame(t));
    const shown = r.setEvents.filter((e) => e.type === "feedback_shown");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      rule_id: "squat.depth.shallow",
      ruleset_version: 4,
      message_id: "squat_depth_shallow_v1",
      measurements: { min_knee_angle_deg: 131.2 },
      tracking_confidence: 0.9,
      occurred_at: new Date(EPOCH + 2500).toISOString(),
    });
  });

  it("records nothing but the tracking_degraded span while tracking is unreliable", () => {
    const r = recorder();
    for (let t = 0; t < 3000; t += 33) {
      r.frame({
        tMs: t,
        analysis: {
          phase: "standing",
          reps: 0,
          repCompleted: false,
          tracking: { reliable: false, confidence: 0.2 },
        },
        tracking: bad("low_visibility"),
        shown: null,
      });
    }
    r.frame(frame(3000));
    expect(r.setEvents).toEqual([
      expect.objectContaining({
        type: "tracking_degraded",
        reason: "low_visibility",
        occurred_at: new Date(EPOCH).toISOString(),
        duration_ms: 3000,
      }),
    ]);
  });

  it("maps every tracking issue onto the contract's reasons (a stall counts as slow_device)", () => {
    const cases: [TrackingIssue, string][] = [
      ["no_person", "no_person"],
      ["out_of_frame", "out_of_frame"],
      ["low_visibility", "low_visibility"],
      ["low_light", "low_light"],
      ["slow_device", "slow_device"],
      ["unsupported_view", "unsupported_view"],
      ["no_frames", "slow_device"],
    ];
    for (const [issue, reason] of cases) {
      const r = recorder();
      r.frame({ tMs: 0, analysis: null, tracking: bad(issue), shown: null });
      r.frame(frame(2000));
      const [e] = r.setEvents;
      expect(e).toMatchObject({ type: "tracking_degraded", reason, duration_ms: 2000 });
      expect(SessionEvent.safeParse(e).success).toBe(true);
    }
  });

  it("splits a span when the reason changes, and ignores blips shorter than the minimum", () => {
    const r = recorder();
    r.frame({ tMs: 0, analysis: null, tracking: bad("no_person"), shown: null });
    r.frame({ tMs: 1500, analysis: null, tracking: bad("out_of_frame"), shown: null });
    r.frame(frame(4000));
    r.frame({ tMs: 5000, analysis: null, tracking: bad("low_light"), shown: null });
    r.frame(frame(5000 + MIN_DEGRADED_MS - 1)); // a blip: not worth a record
    expect(
      r.setEvents.map((e) => e.type === "tracking_degraded" && [e.reason, e.duration_ms]),
    ).toEqual([
      ["no_person", 1500],
      ["out_of_frame", 2500],
    ]);
  });

  it("closes an open span when the set ends or the member pauses", () => {
    const r = recorder();
    r.frame({ tMs: 0, analysis: null, tracking: bad("no_person"), shown: null });
    r.pause(2000); // paused: not a tracking problem
    r.frame({ tMs: 9000, analysis: null, tracking: bad("low_light"), shown: null });
    r.endSet(12_000, 0);
    expect(
      r.setEvents.map((e) => e.type === "tracking_degraded" && [e.reason, e.duration_ms]),
    ).toEqual([["no_person", 2000], ["low_light", 3000], false]);
  });

  it("records acknowledge and dismiss against the cue they answer", () => {
    const r = recorder();
    r.respond("acknowledged", shallowCue(2500), 3000);
    r.respond("dismissed", shallowCue(9000), 9500);
    expect(r.setEvents).toEqual([
      expect.objectContaining({
        type: "feedback_acknowledged",
        rule_id: "squat.depth.shallow",
        message_id: "squat_depth_shallow_v1",
        occurred_at: new Date(EPOCH + 3000).toISOString(),
      }),
      expect.objectContaining({ type: "feedback_dismissed", rule_id: "squat.depth.shallow" }),
    ]);
    for (const e of r.setEvents) expect(SessionEvent.safeParse(e).success).toBe(true);
  });

  it("gives every event its own idempotency key", () => {
    const r = recorder();
    for (let i = 0; i < 20; i++)
      rep(r, 1000 + i * 2000, i + 1, i % 5 ? null : shallowCue(2500 + i * 2000));
    r.respond("acknowledged", shallowCue(2500), 2600);
    r.endSet(50_000, 20);
    const keys = r.setEvents.map((e) => e.idempotency_key);
    expect(keys.length).toBe(20 + 4 + 1 + 1);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("refuses an event the contract rejects instead of emitting it", () => {
    const sink = vi.fn();
    const r = recorder({ sink });
    rep(r, 1000, 1, shallowCue(2500, { min_knee_angle_deg: 131, hip_x: 0.4 } as never));
    expect(r.setEvents.map((e) => e.type)).toEqual(["rep_completed"]);
    expect(r.rejected).toHaveLength(1);
    expect(sink.mock.calls.flat(2).map((e: SessionEvent) => e.type)).toEqual(["rep_completed"]);
  });

  it("numbers sets and starts each with an empty record", () => {
    const r = recorder({ firstSetIndex: 2 });
    rep(r, 1000, 1);
    r.endSet(3000, 1);
    r.endSet(3100, 1); // ending twice records once
    expect(r.setEvents.filter((e) => e.type === "set_completed")).toHaveLength(1);
    r.startSet(0, EPOCH + 60_000);
    expect(r.setEvents).toEqual([]);
    r.endSet(1000, 0);
    expect(r.setEvents).toEqual([expect.objectContaining({ type: "set_completed", set_index: 3 })]);
    expect(r.events).toHaveLength(3);
  });

  it("records nothing outside a set", () => {
    const r = new SessionRecorder({ exerciseId: "bodyweight_squat", sessionId: SESSION });
    r.frame(frame(0, { rep: 1 }));
    r.respond("dismissed", shallowCue(0), 10);
    r.endSet(100, 1);
    expect(r.events).toEqual([]);
  });

  it("sends each batch to the sink when the session is a real one", () => {
    const sink = vi.fn();
    const r = recorder({ sink });
    rep(r, 1000, 1, shallowCue(2500));
    r.endSet(3000, 1);
    expect(sink.mock.calls.flat(2)).toEqual(r.events);
  });

  it("practice mode (no session id): a local id, and the sink is never called", () => {
    const sink = vi.fn();
    const r = new SessionRecorder({ exerciseId: "bodyweight_squat", sink });
    expect(r.practice).toBe(true);
    r.startSet(0, EPOCH);
    rep(r, 1000, 1, shallowCue(2500));
    r.endSet(3000, 1);
    expect(sink).not.toHaveBeenCalled();
    expect(r.events).toHaveLength(3);
    for (const e of r.events) expect(SessionEvent.safeParse(e).success).toBe(true);
  });
});
