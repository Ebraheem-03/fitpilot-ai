import type { LandmarkName } from "@fitpilot/exercise-contracts";
import { assessTracking, type LandmarkFrame } from "../core/confidence";
import { jointAngle, type Landmark } from "../core/geometry";
import type { AnalysisResult, FeedbackCue, TrackingReason } from "../core/types";

export type SquatPhase = "standing" | "descending" | "bottom" | "ascending";
type Side = "left" | "right";

/**
 * Ruleset for bodyweight_squat (blueprint §8 rule contract).
 *
 * - View: side-on (~90° to the camera), whole body in frame. Either side may face the camera.
 * - Landmarks: shoulder, hip, knee, ankle of the measured side (and both shoulders for the view
 *   check). Feature: 2D knee angle hip–knee–ankle, smoothed over time; min knee angle per rep.
 * - Validity: required landmarks visible ≥ minVisibility AND anatomically plausible (ankle below
 *   knee; thigh and shin within segmentToTorso × torso length). v2: pose models can place a
 *   fully "visible" near-side leg on top of the far one when the legs overlap side-on (S2 finding:
 *   full model, 5–40° knee angles while standing), so visibility alone isn't evidence.
 * - Withhold: no plausible side; front-on view (shoulder width / torso > maxShoulderToTorso);
 *   a rep interrupted by > maxGapMs of unreliable tracking is abandoned, never guessed.
 * - Rule squat.depth.shallow: min knee angle > shallowDepthKneeAngle at the end of a rep →
 *   "Try sitting a little deeper if it feels comfortable." (squat_depth_shallow_v1).
 *
 * ALL thresholds are initial, uncalibrated values. v2 changed behaviour (side selection,
 * plausibility, view check, gap handling, time-based smoothing/velocity) with v1's angle
 * thresholds; calibration against recorded clips (data/evaluation-fixtures/vision/
 * bodyweight_squat, M2 S3) comes next. v1 is reproducible from git (#36 merge).
 */
export const SQUAT_RULESET = {
  version: 2,
  minVisibility: 0.6,
  /** EMA time constant; v1's alpha 0.4 at 30 fps ≈ 65 ms */
  smoothingTauMs: 65,
  /** hysteresis band: must go above STAND to count as standing, below BOTTOM to count as bottom */
  standingKneeAngle: 160,
  bottomKneeAngle: 100,
  /** knee angular speed dead-zone separating descending/ascending from jitter (v1: 0.8°/frame) */
  directionDeadbandDegPerS: 24,
  minRepMs: 600,
  shallowDepthKneeAngle: 120,
  /** plausible thigh and shin length as a multiple of shoulder–hip length (2D, side view) */
  segmentToTorso: [0.45, 1.4] as const,
  /** shoulder width above this × torso length ⇒ facing the camera, not side-on */
  maxShoulderToTorso: 0.45,
  /** longer unreliable stretches abandon an in-progress rep */
  maxGapMs: 1000,
} as const;

type Ruleset = typeof SQUAT_RULESET;

const SIDE_LANDMARKS = {
  left: ["left_shoulder", "left_hip", "left_knee", "left_ankle"],
  right: ["right_shoulder", "right_hip", "right_knee", "right_ankle"],
} as const satisfies Record<Side, readonly LandmarkName[]>;

interface SideMeasure {
  side: Side;
  knee: number;
  confidence: number;
}

export class SquatAnalyzer {
  private phase: SquatPhase = "standing";
  private reps = 0;
  private side: Side | null = null;
  private knee: number | null = null;
  private prevT: number | null = null;
  private lastReliableT: number | null = null;
  private minKneeThisRep = Infinity;
  private repStartedAt: number | null = null;

  constructor(private readonly cfg: Ruleset = SQUAT_RULESET) {}

  step(frame: LandmarkFrame, tMs: number): AnalysisResult<SquatPhase> {
    if (this.facingCamera(frame)) return this.withhold("unsupported_view", 0);

    const m = this.measure(frame);
    if (!m) {
      const best = Math.max(
        assessTracking(frame, SIDE_LANDMARKS.left, this.cfg.minVisibility).confidence,
        assessTracking(frame, SIDE_LANDMARKS.right, this.cfg.minVisibility).confidence,
      );
      return this.withhold("low_visibility", best);
    }

    if (this.lastReliableT !== null && tMs - this.lastReliableT > this.cfg.maxGapMs) {
      this.abandonRep(); // we didn't see the middle of it: don't count it
      // and don't smooth or take a velocity across the gap: that would invent a movement
      this.knee = null;
      this.prevT = null;
    }
    this.lastReliableT = tMs;

    const dt = this.prevT === null ? 0 : Math.max(1, tMs - this.prevT);
    const prev = this.knee;
    this.knee =
      prev === null || dt === 0
        ? m.knee
        : prev + (1 - Math.exp(-dt / this.cfg.smoothingTauMs)) * (m.knee - prev);
    this.prevT = tMs;
    const knee = this.knee;
    const velocity = prev === null || dt === 0 ? 0 : ((knee - prev) / dt) * 1000;
    const down = velocity < -this.cfg.directionDeadbandDegPerS;
    const up = velocity > this.cfg.directionDeadbandDegPerS;

    let repCompleted = false;
    const cues: FeedbackCue[] = [];

    switch (this.phase) {
      case "standing":
        if (knee < this.cfg.standingKneeAngle && down) {
          this.phase = "descending";
          this.repStartedAt = tMs;
          this.minKneeThisRep = knee;
        }
        break;
      case "descending":
        this.minKneeThisRep = Math.min(this.minKneeThisRep, knee);
        if (knee <= this.cfg.bottomKneeAngle) this.phase = "bottom";
        else if (up) this.phase = "ascending"; // turned early
        break;
      case "bottom":
        this.minKneeThisRep = Math.min(this.minKneeThisRep, knee);
        if (up) this.phase = "ascending";
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
          this.abandonRep();
        } else if (down) {
          this.phase = "descending";
        }
        break;
    }

    return {
      phase: this.phase,
      reps: this.reps,
      repCompleted,
      tracking: { reliable: true, confidence: m.confidence },
      features: { knee_angle_deg: round(knee), side: m.side === "left" ? 0 : 1 },
      cues,
    };
  }

  reset(): void {
    this.phase = "standing";
    this.reps = 0;
    this.side = null;
    this.knee = null;
    this.prevT = null;
    this.lastReliableT = null;
    this.minKneeThisRep = Infinity;
    this.repStartedAt = null;
  }

  /** Keeps the current side while it stays usable, so the angle doesn't hop between legs. */
  private measure(frame: LandmarkFrame): SideMeasure | null {
    const order: Side[] = this.side ? [this.side, other(this.side)] : ["left", "right"];
    const candidates = order
      .map((side) => this.measureSide(frame, side))
      .filter((m): m is SideMeasure => m !== null);
    if (candidates.length === 0) return null;
    const keep = candidates.find((c) => c.side === this.side);
    const chosen = keep ?? candidates.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    if (chosen.side !== this.side && this.side !== null) {
      this.knee = null; // a different leg: restart smoothing, keep the phase
    }
    this.side = chosen.side;
    return chosen;
  }

  private measureSide(frame: LandmarkFrame, side: Side): SideMeasure | null {
    const quality = assessTracking(frame, SIDE_LANDMARKS[side], this.cfg.minVisibility);
    if (!quality.reliable) return null;
    const [shoulder, hip, knee, ankle] = SIDE_LANDMARKS[side].map((n) => frame[n]!) as Landmark[];
    if (!this.plausible(shoulder!, hip!, knee!, ankle!)) return null;
    const angle = jointAngle(hip!, knee!, ankle!);
    return angle === null ? null : { side, knee: angle, confidence: quality.confidence };
  }

  private plausible(shoulder: Landmark, hip: Landmark, knee: Landmark, ankle: Landmark) {
    const torso = dist(shoulder, hip);
    if (torso < 1e-6 || ankle.y <= knee.y || shoulder.y >= hip.y) return false;
    const [lo, hi] = this.cfg.segmentToTorso;
    const within = (len: number) => len >= lo * torso && len <= hi * torso;
    return within(dist(hip, knee)) && within(dist(knee, ankle));
  }

  private facingCamera(frame: LandmarkFrame): boolean {
    const { left_shoulder: ls, right_shoulder: rs, left_hip: lh, right_hip: rh } = frame;
    const v = this.cfg.minVisibility;
    // a side view hides the far shoulder, so both clearly visible is required evidence
    if (!ls || !rs || !lh || !rh || Math.min(ls.visibility, rs.visibility) < v) return false;
    // full shoulder–hip length, not its vertical part: a forward lean at the bottom of a squat
    // shrinks the vertical part and would make a side view look front-on
    const torso = Math.hypot(
      (ls.x + rs.x) / 2 - (lh.x + rh.x) / 2,
      (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2,
    );
    return torso > 1e-6 && Math.abs(ls.x - rs.x) / torso > this.cfg.maxShoulderToTorso;
  }

  private abandonRep() {
    this.phase = "standing";
    this.minKneeThisRep = Infinity;
    this.repStartedAt = null;
  }

  private withhold(reason: TrackingReason, confidence: number): AnalysisResult<SquatPhase> {
    // Unreliable: don't advance the state machine, don't emit cues (principles 1, 3).
    return {
      phase: this.phase,
      reps: this.reps,
      repCompleted: false,
      tracking: { reliable: false, confidence, reason },
      features: null,
      cues: [],
    };
  }
}

const other = (s: Side): Side => (s === "left" ? "right" : "left");
const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);
const round = (n: number) => Math.round(n * 10) / 10;
