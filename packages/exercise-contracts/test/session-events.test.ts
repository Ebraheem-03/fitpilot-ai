import { describe, expect, it } from "vitest";
import {
  CUE_RULES,
  MAX_EVENTS_PER_BATCH,
  SessionEvent,
  SessionEventBatch,
  SessionSummary,
} from "../src";

const SESSION = "0b3f6a52-6a0b-4f43-8d4e-5f4a5f6a7b8c";
const base = (n = 1) => ({
  session_id: SESSION,
  exercise_id: "bodyweight_squat",
  occurred_at: "2026-10-29T10:00:00Z",
  idempotency_key: `key-${String(n).padStart(6, "0")}`,
});

const feedback = () => ({
  ...base(),
  type: "feedback_shown" as const,
  rule_id: "squat.depth.shallow",
  ruleset_version: 4,
  message_id: "squat_depth_shallow_v1",
  measurements: { min_knee_angle_deg: 112 },
  tracking_confidence: 0.9,
});

const valid: Record<string, object> = {
  rep_completed: {
    ...base(),
    type: "rep_completed",
    set_index: 0,
    rep_index: 0,
    duration_ms: 2400,
    tracking_confidence: 0.8,
  },
  feedback_shown: feedback(),
  feedback_acknowledged: {
    ...base(),
    type: "feedback_acknowledged",
    rule_id: "squat.depth.shallow",
    message_id: "squat_depth_shallow_v1",
  },
  feedback_dismissed: {
    ...base(),
    type: "feedback_dismissed",
    rule_id: "squat.depth.shallow",
    message_id: "squat_depth_shallow_v1",
  },
  tracking_degraded: {
    ...base(),
    type: "tracking_degraded",
    reason: "slow_device",
    duration_ms: 900,
  },
  set_completed: {
    ...base(),
    type: "set_completed",
    set_index: 0,
    reps: 10,
    perceived_difficulty: 6,
  },
  set_logged: { ...base(), type: "set_logged", set_index: 0, reps: 12, note: "felt fine" },
  exercise_skipped: { ...base(), type: "exercise_skipped", reason: "no_equipment" },
};

const messages = (input: unknown) => {
  const result = SessionEvent.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("SessionEvent", () => {
  it.each(Object.keys(valid))("accepts a %s event", (type) => {
    expect(messages(valid[type])).toEqual([]);
  });

  it("rejects fields outside the contract (nothing can ride along)", () => {
    for (const type of Object.keys(valid)) {
      expect(SessionEvent.safeParse({ ...valid[type], landmarks: [[0, 0, 0]] }).success).toBe(
        false,
      );
    }
  });

  it("rejects ids that are not slugs", () => {
    expect(messages({ ...valid.rep_completed, exercise_id: "Squat; DROP" })).not.toEqual([]);
    expect(messages({ ...valid.feedback_dismissed, rule_id: "no dots" })).not.toEqual([]);
  });

  describe("feedback_shown traces to a declared rule (FR-06, ADR-0011)", () => {
    it("rejects an unknown rule", () => {
      expect(messages({ ...feedback(), rule_id: "squat.made.up" })).toContain(
        'unknown rule_id "squat.made.up"',
      );
    });

    it("rejects a rule that belongs to another exercise", () => {
      expect(messages({ ...feedback(), exercise_id: "push_up" })).toContain(
        'rule_id "squat.depth.shallow" does not belong to exercise "push_up"',
      );
    });

    it("rejects an undeclared measurement key", () => {
      expect(
        messages({ ...feedback(), measurements: { min_knee_angle_deg: 100, left_knee_x: 0.4 } }),
      ).toContain('measurements not declared by "squat.depth.shallow": left_knee_x');
    });

    it("rejects a ruleset_version the rule does not belong to", () => {
      expect(messages({ ...feedback(), ruleset_version: 3 })).toContain(
        'rule_id "squat.depth.shallow" belongs to ruleset_version 4, not 3',
      );
    });

    it("rejects inherited property names as rule ids", () => {
      expect(messages({ ...feedback(), rule_id: "constructor.name" })).toContain(
        'unknown rule_id "constructor.name"',
      );
    });

    it("rejects non-finite and non-numeric measurements", () => {
      expect(messages({ ...feedback(), measurements: { min_knee_angle_deg: "100" } })).not.toEqual(
        [],
      );
      expect(
        messages({ ...feedback(), measurements: { min_knee_angle_deg: Number.NaN } }),
      ).not.toEqual([]);
    });
  });

  describe("set_logged", () => {
    it("takes reps or duration, never both or neither", () => {
      const both = { ...valid.set_logged, duration_s: 30 };
      const { reps: _reps, ...neither } = valid.set_logged as Record<string, unknown>;
      void _reps;
      expect(messages(both)).toContain("set_logged needs exactly one of reps or duration_s");
      expect(messages(neither)).toContain("set_logged needs exactly one of reps or duration_s");
      const { reps: _r, ...rest } = valid.set_logged as Record<string, unknown>;
      void _r;
      expect(messages({ ...rest, duration_s: 45 })).toEqual([]);
    });
  });

  // Optional fields are omitted, never null; the API mirror rejects null the same way
  // (services/api/tests/test_session_schemas.py::test_optional_fields_reject_null).
  it.each([
    ["exercise_skipped", "reason"],
    ["set_completed", "perceived_difficulty"],
    ["set_completed", "note"],
    ["set_logged", "perceived_difficulty"],
    ["set_logged", "note"],
    ["set_logged", "duration_s"],
  ])("%s rejects an explicit null %s", (type, field) => {
    expect(messages(valid[type])).toEqual([]);
    expect(messages({ ...valid[type], [field]: null })).not.toEqual([]);
  });

  it("bounds notes and difficulty", () => {
    expect(messages({ ...valid.set_logged, note: "x".repeat(501) })).not.toEqual([]);
    expect(messages({ ...valid.set_completed, perceived_difficulty: 11 })).not.toEqual([]);
  });
});

describe("SessionEventBatch", () => {
  const events = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ ...valid.rep_completed, ...base(i + 1) }));

  it("accepts up to the cap and rejects beyond it or empty", () => {
    expect(SessionEventBatch.safeParse({ events: events(MAX_EVENTS_PER_BATCH) }).success).toBe(
      true,
    );
    expect(SessionEventBatch.safeParse({ events: events(MAX_EVENTS_PER_BATCH + 1) }).success).toBe(
      false,
    );
    expect(SessionEventBatch.safeParse({ events: [] }).success).toBe(false);
  });

  it("rejects a batch that mixes sessions", () => {
    const mixed = events(2);
    mixed[1] = { ...mixed[1]!, session_id: "7c1f0e2a-0000-4000-8000-000000000000" };
    const result = SessionEventBatch.safeParse({ events: mixed });
    expect(result.success).toBe(false);
  });

  it("rejects extra top-level fields", () => {
    expect(SessionEventBatch.safeParse({ events: events(1), user_id: "x" }).success).toBe(false);
  });
});

describe("SessionSummary", () => {
  const summary = () => ({
    session_id: SESSION,
    started_at: "2026-10-29T10:00:00Z",
    completed_at: "2026-10-29T10:20:00Z",
    perceived_difficulty: 7,
    note: null,
    exercises: [
      {
        exercise_id: "bodyweight_squat",
        status: "completed",
        skip_reason: null,
        prescription: "reps",
        tracked: true,
        sets: [
          { set_index: 0, source: "tracked", reps: 10, duration_s: null, perceived_difficulty: 6 },
        ],
        total_reps: 10,
        total_duration_s: 0,
        cues: [
          {
            rule_id: "squat.depth.shallow",
            ruleset_version: 4,
            message_id: "squat_depth_shallow_v1",
            shown_at: "2026-10-29T10:05:00Z",
            measurements: { min_knee_angle_deg: 112 },
            response: "acknowledged",
          },
        ],
        tracking_degraded: [
          { reason: "low_light", started_at: "2026-10-29T10:06:00Z", duration_ms: 1200 },
        ],
        perceived_difficulty: 6,
        note: null,
      },
      {
        exercise_id: "plank",
        status: "completed",
        skip_reason: null,
        prescription: "duration",
        tracked: false,
        sets: [
          {
            set_index: 0,
            source: "manual",
            reps: null,
            duration_s: 40,
            perceived_difficulty: null,
          },
        ],
        total_reps: 0,
        total_duration_s: 40,
        cues: [],
        tracking_degraded: [],
        perceived_difficulty: null,
        note: "Held it longer than last week",
      },
    ],
  });

  it("accepts a summary with tracked and manual exercises", () => {
    const result = SessionSummary.safeParse(summary());
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("is closed to extra fields at every level", () => {
    const s = summary();
    expect(SessionSummary.safeParse({ ...s, user_id: "x" }).success).toBe(false);
    (s.exercises[0]!.cues[0] as Record<string, unknown>).landmarks = [];
    expect(SessionSummary.safeParse(s).success).toBe(false);
  });

  it("only lists cues that name a rule id", () => {
    const s = summary();
    s.exercises[0]!.cues[0]!.rule_id = "not a rule";
    expect(SessionSummary.safeParse(s).success).toBe(false);
  });
});

describe("CUE_RULES", () => {
  it("declares at least one measurement per rule, with slug keys", () => {
    for (const [ruleId, rule] of Object.entries(CUE_RULES)) {
      expect(ruleId).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
      expect(rule.measurements.length).toBeGreaterThan(0);
      for (const key of rule.measurements) expect(key).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
