import { describe, expect, it } from "vitest";
import { CueSelector, DEFAULT_CUE_POLICY, type FeedbackCue } from "../src";

/**
 * Stage 5 (blueprint §8): feedback selection. Exercise-agnostic: these tests use made-up rules so
 * nothing here depends on the squat.
 */
const cue = (rule_id: string, priority: number, over: Partial<FeedbackCue> = {}): FeedbackCue => ({
  rule_id,
  ruleset_version: 1,
  message_id: `${rule_id.replace(/\./g, "_")}_v1`,
  message: `Message for ${rule_id}`,
  measurements: { value: 1 },
  priority,
  ...over,
});
const A = cue("x.a", 1); // more important (lower number first)
const B = cue("x.b", 2);
const ok = (cues: FeedbackCue[] = []) => ({ tracking: { reliable: true }, cues });
const bad = (cues: FeedbackCue[] = []) => ({ tracking: { reliable: false }, cues });
const policy = { displayMs: 3000, cooldownMs: 10_000 };

describe("CueSelector", () => {
  it("shows a cue once, with its traceability fields and display window", () => {
    const s = new CueSelector(policy);
    const d = s.step(ok([A]), 1000);
    expect(d.shown).toMatchObject({
      rule_id: "x.a",
      ruleset_version: 1,
      message_id: "x_a_v1",
      measurements: { value: 1 },
      shown_at_ms: 1000,
      expires_at_ms: 4000,
    });
    expect(d.active).toEqual(d.shown);
    // still on screen next frame, but `shown` fires only on the frame it appeared
    const next = s.step(ok(), 1033);
    expect(next.shown).toBeNull();
    expect(next.active?.rule_id).toBe("x.a");
  });

  it("expires the active cue after displayMs", () => {
    const s = new CueSelector(policy);
    s.step(ok([A]), 0);
    expect(s.step(ok(), 2999).active).not.toBeNull();
    expect(s.step(ok(), 3000).active).toBeNull();
  });

  it("picks the most important cue (lowest priority number) when several arrive together", () => {
    const s = new CueSelector(policy);
    const d = s.step(ok([B, A]), 0);
    expect(d.shown?.rule_id).toBe("x.a");
    expect(d.suppressed).toEqual([{ cue: B, reason: "lower_priority" }]);
  });

  it("keeps at most one cue active: a new cue while one is showing is dropped, not queued", () => {
    const s = new CueSelector(policy);
    s.step(ok([B]), 0);
    const d = s.step(ok([A]), 1000); // even a more important one doesn't pre-empt (no flicker)
    expect(d.shown).toBeNull();
    expect(d.active?.rule_id).toBe("x.b");
    expect(d.suppressed).toEqual([{ cue: A, reason: "busy" }]);
    // dropped means dropped: it does not appear later from a queue
    expect(s.step(ok(), 3000).shown).toBeNull();
    // and it was never shown, so it isn't in cooldown either
    expect(s.step(ok([A]), 3100).shown?.rule_id).toBe("x.a");
  });

  it("holds a rule in cooldown after it was shown (time-based, analysis time)", () => {
    const s = new CueSelector(policy);
    s.step(ok([A]), 0);
    expect(s.step(ok([A]), 5000).suppressed).toEqual([{ cue: A, reason: "cooldown" }]);
    expect(s.step(ok([A]), 9999).shown).toBeNull();
    expect(s.step(ok([A]), 10_000).shown?.rule_id).toBe("x.a");
  });

  it("cools down per rule: another rule can show while the first is cooling down", () => {
    const s = new CueSelector(policy);
    s.step(ok([A]), 0);
    const d = s.step(ok([A, B]), 4000);
    expect(d.shown?.rule_id).toBe("x.b");
    expect(d.suppressed).toEqual([{ cue: A, reason: "cooldown" }]);
  });

  it("lets a rule override the default cooldown", () => {
    const s = new CueSelector({ ...policy, cooldownMsByRule: { "x.a": 4000 } });
    s.step(ok([A]), 0);
    expect(s.step(ok([A]), 4000).shown?.rule_id).toBe("x.a");
  });

  it("never shows a cue while tracking is unreliable, and withdraws the one on screen", () => {
    const s = new CueSelector(policy);
    expect(s.step(bad([A]), 0)).toEqual({
      active: null,
      shown: null,
      suppressed: [{ cue: A, reason: "unreliable" }],
    });
    s.step(ok([A]), 100);
    expect(s.step(bad(), 200).active).toBeNull();
    // a withdrawn cue doesn't come back when tracking recovers: it was shown, so it cools down
    expect(s.step(ok(), 300).active).toBeNull();
    expect(s.step(ok([A]), 400).shown).toBeNull();
  });

  it("refuses a cue that can't be traced to a rule and its measurements", () => {
    const s = new CueSelector(policy);
    const untraceable = [
      cue("x.a", 1, { measurements: {} }),
      cue("x.a", 1, { measurements: { value: Number.NaN } }),
      cue("", 1),
      cue("x.a", 1, { message_id: "" }),
      cue("x.a", 1, { ruleset_version: 0 }),
    ];
    for (const c of untraceable) {
      expect(s.step(ok([c]), 0)).toMatchObject({
        shown: null,
        suppressed: [{ cue: c, reason: "untraceable" }],
      });
    }
  });

  it("dismiss clears the cue on screen; the rule still cools down", () => {
    const s = new CueSelector(policy);
    s.step(ok([A]), 0);
    s.dismiss();
    expect(s.step(ok(), 33).active).toBeNull();
    expect(s.step(ok([A]), 1000).shown).toBeNull();
    expect(s.step(ok([B]), 1000).shown?.rule_id).toBe("x.b");
  });

  it("reset forgets the active cue and every cooldown (new set)", () => {
    const s = new CueSelector(policy);
    s.step(ok([A]), 0);
    s.reset();
    expect(s.step(ok([A]), 100).shown?.rule_id).toBe("x.a");
  });

  it("has defaults that leave a cue readable and don't nag", () => {
    expect(DEFAULT_CUE_POLICY.displayMs).toBeGreaterThanOrEqual(2000);
    expect(DEFAULT_CUE_POLICY.cooldownMs).toBeGreaterThan(DEFAULT_CUE_POLICY.displayMs);
    expect(new CueSelector().step(ok([A]), 0).shown?.expires_at_ms).toBe(
      DEFAULT_CUE_POLICY.displayMs,
    );
  });

  describe("jitter", () => {
    it("tracking flapping every frame never re-shows a cue or shows one on a bad frame", () => {
      const s = new CueSelector(policy);
      let shown = 0;
      for (let i = 0; i < 300; i++) {
        const t = i * 33;
        const reliable = i % 2 === 0; // worst case: alternating good/bad frames for ~10 s
        const d = s.step(reliable ? ok([A]) : bad([A]), t);
        if (d.shown) shown += 1;
        if (!reliable) expect(d.active).toBeNull();
      }
      // ~10 s of a rule firing on every good frame: once at t=0, once after the 10 s cooldown
      expect(shown).toBe(1);
    });

    it("a rule firing on every frame is shown once per cooldown", () => {
      const s = new CueSelector(policy);
      const times: number[] = [];
      for (let t = 0; t < 30_000; t += 33) {
        const d = s.step(ok([A]), t);
        if (d.shown) times.push(t);
      }
      expect(times).toHaveLength(3);
      for (let i = 1; i < times.length; i++) {
        expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(policy.cooldownMs);
      }
    });
  });
});
