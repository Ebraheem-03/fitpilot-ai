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
 * - Withhold: no plausible side; a required landmark outside the image (out_of_frame: top,
 *   bottom and left edges; the right edge depends on the aspect ratio, which only the live engine
 *   knows and checks); front-on
 *   or three-quarter view (shoulder width / torso > maxShoulderToTorso, or yaw < minYawDeg);
 *   a rep interrupted by > maxGapMs of unreliable tracking is abandoned, never guessed.
 * - Count: back to standing after ≥ minRepMs, with the knee at ≤ countMaxKneeAngle at some point
 *   and the measured ankle within maxAnkleDriftToTorso of where the rep started (feet planted).
 * - Rule squat.depth.shallow: min knee angle > shallowDepthKneeAngle at the end of a rep →
 *   "Try sitting a little deeper if it feels comfortable." (squat_depth_shallow_v1).
 *
 * v3 — calibrated 2026-10-28 on data/evaluation-fixtures/vision/bodyweight_squat: 25 Pexels clips
 * (11 side-view, 13 unsupported) + 2 mannequin clips, lite model, labels from frame sheets.
 * Counting (supported): 48/48 reps, 0 false (precision 1.00, recall 1.00). Refusal (unsupported):
 * 12/14 clips count nothing; the 2 leaks are a rear three-quarter view and a three-quarter view
 * with a panning camera (6 false counts), which no landmark feature here separates from side-on.
 * What changed and why: frames are aspect-corrected (portrait clips measured stretched angles:
 * recall 0.83 → 0.94); depth-to-count and feet-planted (a bend-and-step pickup and a Smith-machine
 * shot counted); out-of-frame (feet cut off counted); yaw view check (three-quarter views).
 * minYawDeg 60–70 and maxAnkleDriftToTorso ≥ 0.6 give the same result; < 0.35 drops real reps
 * (the ankle estimate moves as the shins tilt). The angle thresholds are v1's and held up. No
 * held-out set yet: re-check on the next recordings before trusting these as general. v1/v2 are
 * reproducible from git (#36, #39).
 */
export const SQUAT_RULESET = {
  version: 3,
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
  /**
   * body rotation from the camera axis, from shoulder and hip depth (z): 90° = side-on, 0° =
   * facing the camera. Below this ⇒ three-quarter or front view (v3, calibrated on the Pexels set).
   */
  minYawDeg: 65,
  /** a dip only counts as a rep if the knee got at least this bent (v3: bends/steps aren't reps) */
  countMaxKneeAngle: 140,
  /**
   * feet stay planted in a squat: if the measured ankle travels more than this × torso length
   * between the start and end of a rep, it was a step, lunge or camera move, not a squat (v3)
   */
  maxAnkleDriftToTorso: 0.6,
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
  /** ankle position and torso length, for the feet-planted check */
  ankle: { x: number; y: number };
  torso: number;
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
  private outOfFrame = false;
  /** ankle at the start of the rep and the furthest it has moved since, in torso lengths */
  private repAnkle: { x: number; y: number } | null = null;
  private ankleDrift = 0;

  constructor(private readonly cfg: Ruleset = SQUAT_RULESET) {}

  step(frame: LandmarkFrame, tMs: number): AnalysisResult<SquatPhase> {
    if (this.facingCamera(frame) || this.turnedTowardCamera(frame)) {
      return this.withhold("unsupported_view", 0);
    }

    const m = this.measure(frame);
    if (!m) {
      const best = Math.max(
        assessTracking(frame, SIDE_LANDMARKS.left, this.cfg.minVisibility).confidence,
        assessTracking(frame, SIDE_LANDMARKS.right, this.cfg.minVisibility).confidence,
      );
      return this.withhold(this.outOfFrame ? "out_of_frame" : "low_visibility", best);
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
    if (this.repAnkle && this.phase !== "standing" && m.torso > 1e-6) {
      const moved = Math.hypot(m.ankle.x - this.repAnkle.x, m.ankle.y - this.repAnkle.y);
      this.ankleDrift = Math.max(this.ankleDrift, moved / m.torso);
    }

    switch (this.phase) {
      case "standing":
        if (knee < this.cfg.standingKneeAngle && down) {
          this.phase = "descending";
          this.repStartedAt = tMs;
          this.minKneeThisRep = knee;
          this.repAnkle = m.ankle;
          this.ankleDrift = 0;
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
          // too quick, or never got near squat depth (a bend, a step, a fidget): not a rep
          const planted = this.ankleDrift <= this.cfg.maxAnkleDriftToTorso;
          if (
            dur >= this.cfg.minRepMs &&
            this.minKneeThisRep <= this.cfg.countMaxKneeAngle &&
            planted
          ) {
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
    this.repAnkle = null;
    this.ankleDrift = 0;
    this.outOfFrame = false;
  }

  /** Keeps the current side while it stays usable, so the angle doesn't hop between legs. */
  private measure(frame: LandmarkFrame): SideMeasure | null {
    this.outOfFrame = false;
    const order: Side[] = this.side ? [this.side, other(this.side)] : ["left", "right"];
    const candidates = order
      .map((side) => this.measureSide(frame, side))
      .filter((m): m is SideMeasure => m !== null);
    if (candidates.length === 0) return null;
    const keep = candidates.find((c) => c.side === this.side);
    const chosen = keep ?? candidates.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    if (chosen.side !== this.side && this.side !== null) {
      this.knee = null; // a different leg: restart smoothing, keep the phase
      this.repAnkle = this.repAnkle && chosen.ankle; // and measure drift from the new ankle
    }
    this.side = chosen.side;
    return chosen;
  }

  private measureSide(frame: LandmarkFrame, side: Side): SideMeasure | null {
    const quality = assessTracking(frame, SIDE_LANDMARKS[side], this.cfg.minVisibility);
    if (!quality.reliable) return null;
    const [shoulder, hip, knee, ankle] = SIDE_LANDMARKS[side].map((n) => frame[n]!) as Landmark[];
    // the model extrapolates cut-off limbs with high "visibility": outside the image is a guess
    if ([shoulder, hip, knee, ankle].some((p) => p!.y < 0 || p!.y > 1 || p!.x < 0)) {
      this.outOfFrame = true;
      return null;
    }
    if (!this.plausible(shoulder!, hip!, knee!, ankle!)) return null;
    const angle = jointAngle(hip!, knee!, ankle!);
    if (angle === null) return null;
    return {
      side,
      knee: angle,
      confidence: quality.confidence,
      ankle: { x: ankle!.x, y: ankle!.y },
      torso: dist(shoulder!, hip!),
    };
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

  /**
   * Yaw from depth: side-on puts the left/right pairs one behind the other (large Δz, small Δx);
   * facing the camera puts them side by side. Skipped when the model gives no depth.
   */
  private turnedTowardCamera(frame: LandmarkFrame): boolean {
    const yaws: number[] = [];
    for (const [l, r] of [
      [frame.left_shoulder, frame.right_shoulder],
      [frame.left_hip, frame.right_hip],
    ] as const) {
      if (l?.z === undefined || r?.z === undefined) continue;
      const dx = Math.abs(l.x - r.x);
      const dz = Math.abs(l.z - r.z);
      if (Math.hypot(dx, dz) < 1e-3) continue;
      yaws.push((Math.atan2(dz, dx) * 180) / Math.PI);
    }
    if (yaws.length === 0) return false;
    return yaws.reduce((a, b) => a + b, 0) / yaws.length < this.cfg.minYawDeg;
  }

  private abandonRep() {
    this.repAnkle = null;
    this.ankleDrift = 0;
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
