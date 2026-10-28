/** Output of one analysis step. Feedback is only ever produced from a defined rule (FR-06). */
export interface FeedbackCue {
  rule_id: string;
  ruleset_version: number;
  message_id: string;
  message: string;
  /** measurements that justified the cue — logged with the FeedbackShownEvent */
  measurements: Record<string, number>;
  priority: number;
}

/** Why a frame was withheld; maps onto the UI's tracking issues and TrackingDegradedEvent. */
export type TrackingReason = "low_visibility" | "unsupported_view";

export interface AnalysisResult<Phase extends string> {
  phase: Phase;
  reps: number;
  repCompleted: boolean;
  tracking: { reliable: boolean; confidence: number; reason?: TrackingReason };
  /** null when tracking is unreliable — never guess (principle 1, 3) */
  features: Record<string, number> | null;
  cues: FeedbackCue[];
}
