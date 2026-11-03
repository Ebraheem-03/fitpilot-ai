import { describe, expect, it } from "vitest";
import { manualSetEvent, skipEvent, trackedSetRatingEvent } from "./events";

const c = {
  sessionId: "0b0f7a3e-4b1c-4a55-9d63-8f0c8d1c2a11",
  exerciseId: "plank",
  now: () => new Date("2026-10-29T10:00:00.000Z"),
  newKey: () => "key-12345678",
};

describe("runner events", () => {
  it("builds a manual rep set, leaving out unrated difficulty and blank notes", () => {
    expect(manualSetEvent(c, { setIndex: 0, reps: 10, difficulty: null, note: "  " })).toEqual({
      session_id: c.sessionId,
      exercise_id: "plank",
      occurred_at: "2026-10-29T10:00:00.000Z",
      idempotency_key: "key-12345678",
      type: "set_logged",
      set_index: 0,
      reps: 10,
    });
  });

  it("builds a timed set with rating and trimmed note", () => {
    expect(
      manualSetEvent(c, { setIndex: 2, durationS: 45, difficulty: 7, note: " felt strong " }),
    ).toMatchObject({
      type: "set_logged",
      set_index: 2,
      duration_s: 45,
      perceived_difficulty: 7,
      note: "felt strong",
    });
  });

  it("builds a rating for a camera-counted set with the same reps", () => {
    expect(
      trackedSetRatingEvent(
        { ...c, exerciseId: "bodyweight_squat" },
        { setIndex: 1, reps: 8, difficulty: 5 },
      ),
    ).toMatchObject({ type: "set_completed", set_index: 1, reps: 8, perceived_difficulty: 5 });
  });

  it("builds a skip with or without a reason", () => {
    expect(skipEvent(c)).toMatchObject({ type: "exercise_skipped" });
    expect(skipEvent(c)).not.toHaveProperty("reason");
    expect(skipEvent(c, "no_equipment")).toMatchObject({ reason: "no_equipment" });
  });

  it("refuses what the contract refuses, in the browser", () => {
    expect(() => manualSetEvent(c, { setIndex: 0, reps: 0 })).toThrow();
    expect(() => manualSetEvent(c, { setIndex: 0, reps: 5, difficulty: 11 })).toThrow();
    expect(() => manualSetEvent({ ...c, sessionId: "nope" }, { setIndex: 0, reps: 5 })).toThrow();
    expect(() => manualSetEvent(c, { setIndex: 0, reps: 5, note: "x".repeat(501) })).toThrow();
  });

  it("makes a fresh idempotency key per event by default", () => {
    const base = { sessionId: c.sessionId, exerciseId: "plank" };
    const a = skipEvent(base);
    const b = skipEvent(base);
    expect(a.idempotency_key).not.toBe(b.idempotency_key);
  });
});
