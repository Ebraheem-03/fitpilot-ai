import type { LandmarkName } from "@fitpilot/exercise-contracts";
import { assessTracking, type LandmarkFrame } from "../core/confidence";
import { jointAngle } from "../core/geometry";
import { Ema } from "../core/smoothing";
import type { AnalysisResult, FeedbackCue } from "../core/types";

export type SquatPhase = "standing" | "descending" | "bottom" | "ascending";

/**
 * Ruleset v1 for bodyweight_squat, side view. ALL thresholds are initial, uncalibrated values —
 * they must be tuned against annotated fixtures in data/evaluation-fixtures/vision/squat before
 * any cue ships (blueprint §8: "an angle threshold alone is not a universal standard").
 */
export const SQUAT_RULESET = {
  version: 1,
  side: "left" as "left" | "right",
  minVisibility: 0.6,
  emaAlpha: 0.4,
  /** hysteresis band: must go above STAND to count as standing, below BOTTOM to count as bottom */
  standingKneeAngle: 160,
  bottomKneeAngle: 100,
  /** derivative dead-zone (deg/frame) to separate descending vs ascending from jitter */
  directionDeadband: 0.8,
  minRepMs: 600,
  shallowDepthKneeAngle: 120,
} as const;

const REQUIRED: readonly LandmarkName[] = ["left_hip", "left_knee", "left_ankle", "left_shoulder"];

export class SquatAnalyzer {
  private phase: SquatPhase = "standing";
  private reps = 0;
  private knee = new Ema(SQUAT_RULESET.emaAlpha);
  private prevKnee: number | null = null;
  private minKneeThisRep = Infinity;
  private repStartedAt: number | null = null;

  constructor(private readonly cfg = SQUAT_RULESET) {}

  step(frame: LandmarkFrame, tMs: number): AnalysisResult<SquatPhase> {
    const tracking = assessTracking(frame, REQUIRED, this.cfg.minVisibility);
    if (!tracking.reliable) {
      // Do not advance the state machine on unreliable data; do not emit cues.
      return this.result(false, tracking, null, []);
    }

    const hip = frame.left_hip!;
    const kneeLm = frame.left_knee!;
    const ankle = frame.left_ankle!;
    const raw = jointAngle(hip, kneeLm, ankle);
    const knee = this.knee.push(raw);
    if (knee === null) return this.result(false, tracking, null, []);

    const delta = this.prevKnee === null ? 0 : knee - this.prevKnee;
    this.prevKnee = knee;

    let repCompleted = false;
    const cues: FeedbackCue[] = [];

    switch (this.phase) {
      case "standing":
        if (knee < this.cfg.standingKneeAngle && delta < -this.cfg.directionDeadband) {
          this.phase = "descending";
          this.repStartedAt = tMs;
          this.minKneeThisRep = knee;
        }
        break;
      case "descending":
        this.minKneeThisRep = Math.min(this.minKneeThisRep, knee);
        if (knee <= this.cfg.bottomKneeAngle) this.phase = "bottom";
        else if (delta > this.cfg.directionDeadband) this.phase = "ascending"; // turned early
        break;
      case "bottom":
        this.minKneeThisRep = Math.min(this.minKneeThisRep, knee);
        if (delta > this.cfg.directionDeadband) this.phase = "ascending";
        break;
      case "ascending":
        if (knee >= this.cfg.standingKneeAngle) {
          const dur = this.repStartedAt === null ? 0 : tMs - this.repStartedAt;
          if (dur >= this.cfg.minRepMs) {
            this.reps += 1;
            repCompleted = true;
            if (this.minKneeThisRep > this.cfg.shallowDepthKneeAngle) {
              cues.push({
                rule_id: "squat.depth.shallow",
                ruleset_version: this.cfg.version,
                message_id: "squat_depth_shallow_v1",
                message: "Try sitting a little deeper if it feels comfortable.",
                measurements: { min_knee_angle_deg: round(this.minKneeThisRep) },
                priority: 1,
              });
            }
          }
          this.phase = "standing";
          this.minKneeThisRep = Infinity;
          this.repStartedAt = null;
        } else if (delta < -this.cfg.directionDeadband) {
          this.phase = "descending";
        }
        break;
    }

    return this.result(repCompleted, tracking, { knee_angle_deg: round(knee) }, cues);
  }

  reset(): void {
    this.phase = "standing";
    this.reps = 0;
    this.knee.reset();
    this.prevKnee = null;
    this.minKneeThisRep = Infinity;
    this.repStartedAt = null;
  }

  private result(
    repCompleted: boolean,
    tracking: { reliable: boolean; confidence: number },
    features: Record<string, number> | null,
    cues: FeedbackCue[],
  ): AnalysisResult<SquatPhase> {
    return {
      phase: this.phase,
      reps: this.reps,
      repCompleted,
      tracking: { reliable: tracking.reliable, confidence: tracking.confidence },
      features,
      cues,
    };
  }
}

const round = (n: number) => Math.round(n * 10) / 10;
