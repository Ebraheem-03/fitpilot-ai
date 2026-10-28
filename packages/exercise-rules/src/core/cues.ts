import type { FeedbackCue } from "./types";

/**
 * Stage 5 of the analysis pipeline (blueprint §8, FR-06): which of the analyzer's candidate cues
 * reaches the screen. Exercise-agnostic: it only reads the cue fields every rule carries.
 *
 * - At most one cue is active. A cue arriving while one is showing is dropped, not queued and not
 *   allowed to pre-empt: cues are about the rep just finished, so a late one would describe the
 *   wrong rep, and swapping text mid-read is the flicker hysteresis exists to prevent.
 * - Several candidates on one step: the lowest `priority` number wins.
 * - Cooldown per `rule_id`, in analysis time (the frame timestamps), from the moment a cue was
 *   shown. Dismissing or withdrawing a cue doesn't end its cooldown: no nagging.
 * - Unreliable tracking: nothing new is shown, and the cue on screen is withdrawn (principle 3).
 * - A cue without a rule id, message id, positive ruleset version and at least one finite
 *   measurement is refused (principle 1: no feedback that can't be traced to a measurement).
 */
export interface CuePolicy {
  /** how long a shown cue stays on screen unless dismissed or withdrawn */
  displayMs: number;
  /** after a rule's cue is shown, that rule stays silent for this long */
  cooldownMs: number;
  /** per-rule cooldown overrides, by rule_id */
  cooldownMsByRule?: Readonly<Record<string, number>>;
}

/**
 * Starting values, not measured against members yet (M3 S3 shows them in the UI): long enough to
 * read a one-line cue, and a cooldown of several reps so the same advice isn't repeated each rep.
 */
export const DEFAULT_CUE_POLICY: Readonly<CuePolicy> = {
  displayMs: 4000,
  cooldownMs: 20_000,
};

export type CueSuppression = "unreliable" | "untraceable" | "cooldown" | "busy" | "lower_priority";

export interface ActiveCue extends FeedbackCue {
  shown_at_ms: number;
  expires_at_ms: number;
}

export interface CueDecision {
  /** what the UI shows right now (null: nothing) */
  active: ActiveCue | null;
  /** set only on the step a cue appears: record exactly one `feedback_shown` event for it */
  shown: ActiveCue | null;
  /** candidates not shown this step and why, for diagnostics and tests */
  suppressed: { cue: FeedbackCue; reason: CueSuppression }[];
}

/** The part of an analysis result the selector reads (`AnalysisResult` satisfies it). */
export interface CueInput {
  tracking: { reliable: boolean };
  cues: readonly FeedbackCue[];
}

export function isTraceable(cue: FeedbackCue): boolean {
  const values = Object.values(cue.measurements ?? {});
  return (
    cue.rule_id.length > 0 &&
    cue.message_id.length > 0 &&
    Number.isInteger(cue.ruleset_version) &&
    cue.ruleset_version > 0 &&
    values.length > 0 &&
    values.every(Number.isFinite)
  );
}

export class CueSelector {
  private readonly policy: CuePolicy;
  private active: ActiveCue | null = null;
  /** rule_id → analysis time until which the rule stays silent */
  private silentUntil = new Map<string, number>();

  constructor(policy: Partial<CuePolicy> = {}) {
    this.policy = { ...DEFAULT_CUE_POLICY, ...policy };
  }

  /**
   * Feed every analysed frame, including withheld ones. When the live engine skips analysis
   * altogether (no person, too slow), pass `{ tracking: { reliable: false }, cues: [] }`.
   */
  step(input: CueInput, tMs: number): CueDecision {
    if (this.active && tMs >= this.active.expires_at_ms) this.active = null;
    const suppressed: CueDecision["suppressed"] = [];

    if (!input.tracking.reliable) {
      this.active = null;
      for (const cue of input.cues) suppressed.push({ cue, reason: "unreliable" });
      return { active: null, shown: null, suppressed };
    }

    let shown: ActiveCue | null = null;
    // stable sort: equal priorities keep the analyzer's order
    const ranked = [...input.cues].sort((a, b) => a.priority - b.priority);
    for (const cue of ranked) {
      if (!isTraceable(cue)) suppressed.push({ cue, reason: "untraceable" });
      else if (tMs < (this.silentUntil.get(cue.rule_id) ?? -Infinity)) {
        suppressed.push({ cue, reason: "cooldown" });
      } else if (shown) suppressed.push({ cue, reason: "lower_priority" });
      else if (this.active) suppressed.push({ cue, reason: "busy" });
      else {
        shown = { ...cue, shown_at_ms: tMs, expires_at_ms: tMs + this.policy.displayMs };
        const cooldown = this.policy.cooldownMsByRule?.[cue.rule_id] ?? this.policy.cooldownMs;
        this.silentUntil.set(cue.rule_id, tMs + cooldown);
      }
    }
    if (shown) this.active = shown;
    return { active: this.active, shown, suppressed };
  }

  /** The member dismissed or acknowledged the cue (FR-06). Its rule still cools down. */
  dismiss(): void {
    this.active = null;
  }

  /** A new set: forget the cue on screen and every cooldown. */
  reset(): void {
    this.active = null;
    this.silentUntil.clear();
  }
}
