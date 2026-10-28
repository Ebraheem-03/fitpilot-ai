/** Output of one analysis step. Feedback is only ever produced from a defined rule (FR-06). */
export interface FeedbackCue {
  rule_id: string;
  ruleset_version: number;
  message_id: string;
  message: string;
  /** measurements that justified the cue — logged with the FeedbackShownEvent */
  measurements: Record<string, number>;
  /** lower = more important (1 before 2), like P0 > P1; the cue selector shows the lowest first */
  priority: number;
}

/**
 * Declaration of one feedback rule (blueprint §8 rule contract). Analyzers build their cues from
 * these, so a cue's text, priority and measurement keys can't drift from what is documented, and
 * the UI explains a cue from its `message_id` instead of making text up.
 */
export interface CueRule {
  rule_id: string;
  message_id: string;
  priority: number;
  /** the cue itself: an observable movement and an optional adjustment */
  message: string;
  /**
   * "What this cue means" (FR-06): what was measured and what it suggests, in plain language.
   * Never an injury, pain or safety judgement; no thresholds (they change with the ruleset).
   */
  explanation: string;
  /** every measurement key the cue carries, with a label the UI can show next to the value */
  measurements: Readonly<Record<string, { label: string; unit: "deg" | "ms" | "ratio" }>>;
}

/** Why a frame was withheld; maps onto the UI's tracking issues and TrackingDegradedEvent. */
export type TrackingReason = "low_visibility" | "out_of_frame" | "unsupported_view";

export interface AnalysisResult<Phase extends string> {
  phase: Phase;
  reps: number;
  repCompleted: boolean;
  tracking: { reliable: boolean; confidence: number; reason?: TrackingReason };
  /** null when tracking is unreliable — never guess (principle 1, 3) */
  features: Record<string, number> | null;
  /**
   * Candidate cues from this step's rules, all of them. Showing them is the cue selector's job
   * (`CueSelector`: priority, cooldown, one at a time); never display these directly.
   */
  cues: FeedbackCue[];
}
