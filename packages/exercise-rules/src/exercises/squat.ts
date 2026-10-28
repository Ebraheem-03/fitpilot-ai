import type { LandmarkName } from "@fitpilot/exercise-contracts";
import { assessTracking, type LandmarkFrame } from "../core/confidence";
import { jointAngle, type Landmark } from "../core/geometry";
import type { AnalysisResult, CueRule, FeedbackCue, TrackingReason } from "../core/types";

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
 * - Rule squat.depth.shallow (priority 1): min knee angle > shallowDepthKneeAngle on a counted rep
 *   → "Try sitting a little deeper if it feels comfortable." (squat_depth_shallow_v1).
 *   Measurements: min_knee_angle_deg. Fixture evidence (v4 cue gate): 0 cues on 53 reps judged
 *   full depth (lite); there are no shallow reps in the set, so it has never been seen to fire on
 *   a real clip. The threshold is v1's and stays _uncalibrated_ for cueing.
 * - Rule squat.torso.forward_lean (priority 2, v4): on a counted rep, the trunk lean at the bottom
 *   (hip → shoulder line against image vertical, smoothed like the knee, taken on the frame where
 *   the knee angle is smallest) > maxTrunkLeanDeg → "Try keeping your chest a little more upright
 *   as you lower." (squat_torso_forward_lean_v1). Measurements: trunk_lean_deg,
 *   min_knee_angle_deg. Only a *forward* lean counts: the shoulder must be on the same side of the
 *   hip as the knee (a backward tilt at the bottom of a squat is a landmark error). Withheld when:
 *   any v3 withhold condition; the rep isn't counted; the knee isn't clearly in front of the hip
 *   (no forward direction to judge). Assumes an upright camera: a rolled or pitched camera adds
 *   its tilt to the measured lean, and no landmark here can detect that.
 *   _Uncalibrated._ 60° is a starting point, not fitted: real side-view squats (lite) measured
 *   16–51° at the bottom (mannequin 29°, authored), so no fixture rep triggers it, and no clip
 *   has a by-eye lean judgement (the source videos are gone). Calibrate on recordings with
 *   annotated lean before trusting it.
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
 *
 * v4 (M3 S2) — adds squat.torso.forward_lean; counting and the depth rule are unchanged
 * (v3 = this ruleset with `version: 3, maxTrunkLeanDeg: Infinity`, tested).
 */
export interface SquatRuleset {
  readonly version: number;
  readonly minVisibility: number;
  readonly smoothingTauMs: number;
  readonly standingKneeAngle: number;
  readonly bottomKneeAngle: number;
  readonly directionDeadbandDegPerS: number;
  readonly minRepMs: number;
  readonly shallowDepthKneeAngle: number;
  readonly maxTrunkLeanDeg: number;
  readonly leanDirectionMinToTorso: number;
  readonly segmentToTorso: readonly [number, number];
  readonly maxShoulderToTorso: number;
  readonly minYawDeg: number;
  readonly countMaxKneeAngle: number;
  readonly maxAnkleDriftToTorso: number;
  readonly maxGapMs: number;
}

export const SQUAT_RULESET: SquatRuleset = {
  version: 4,
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
  /**
   * forward trunk lean from vertical at the bottom of a rep above this ⇒ forward-lean cue (v4,
   * _uncalibrated_: see the rule notes above)
   */
  maxTrunkLeanDeg: 60,
  /**
   * lean is only measured once the knee is this × torso length ahead of the hip, so "forward"
   * has a direction (v4; standing straight it doesn't)
   */
  leanDirectionMinToTorso: 0.1,
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
};

/** The squat's feedback rules (blueprint §8 rule contract); cues are built from these. */
export const SQUAT_RULES = [
  {
    rule_id: "squat.depth.shallow",
    message_id: "squat_depth_shallow_v1",
    priority: 1,
    message: "Try sitting a little deeper if it feels comfortable.",
    explanation:
      "At the lowest point of that rep your knees stayed fairly straight, so it was a shallow " +
      "squat. The camera estimates the angle at your knee, between your thigh and your shin, on " +
      "the side facing it. Going lower is optional: only go as deep as feels comfortable for you.",
    measurements: {
      min_knee_angle_deg: { label: "Smallest knee angle in the rep", unit: "deg" },
    },
  },
  {
    rule_id: "squat.torso.forward_lean",
    message_id: "squat_torso_forward_lean_v1",
    priority: 2,
    message: "Try keeping your chest a little more upright as you lower.",
    explanation:
      "At the bottom of that rep your upper body tipped further forward than this check " +
      "expects. The camera compares the line from your hip to your shoulder with straight up. " +
      "Some forward lean is normal in a squat and how much depends on your build, so treat this " +
      "as a suggestion: lifting your chest a little as you sit down may help, if it feels natural.",
    measurements: {
      trunk_lean_deg: { label: "Upper-body lean from vertical at the bottom", unit: "deg" },
      min_knee_angle_deg: { label: "Smallest knee angle in the rep", unit: "deg" },
    },
  },
] as const satisfies readonly CueRule[];

type SquatRuleId = (typeof SQUAT_RULES)[number]["rule_id"];

function cueFor(
  ruleId: SquatRuleId,
  version: number,
  measurements: Record<string, number>,
): FeedbackCue {
  const r: CueRule = SQUAT_RULES.find((rule) => rule.rule_id === ruleId)!;
  return {
    rule_id: r.rule_id,
    ruleset_version: version,
    message_id: r.message_id,
    message: r.message,
    measurements,
    priority: r.priority,
  };
}

type Ruleset = SquatRuleset;

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
  /** forward trunk lean from vertical, deg (negative = backward); null with no forward direction */
  lean: number | null;
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
  /** smoothed trunk lean, and its value on the frame of the rep's smallest knee angle */
  private lean: number | null = null;
  private leanAtBottom: number | null = null;

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
      this.lean = null;
      this.prevT = null;
    }
    this.lastReliableT = tMs;

    const dt = this.prevT === null ? 0 : Math.max(1, tMs - this.prevT);
    const smooth = (prior: number | null, sample: number) =>
      prior === null || dt === 0
        ? sample
        : prior + (1 - Math.exp(-dt / this.cfg.smoothingTauMs)) * (sample - prior);
    const prev = this.knee;
    this.knee = smooth(prev, m.knee);
    this.lean = m.lean === null ? null : smooth(this.lean, m.lean);
    this.prevT = tMs;
    const knee = this.knee;
    const lean = this.lean;
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
          this.trackBottom(knee, lean);
          this.repAnkle = m.ankle;
          this.ankleDrift = 0;
        }
        break;
      case "descending":
        this.trackBottom(knee, lean);
        if (knee <= this.cfg.bottomKneeAngle) this.phase = "bottom";
        else if (up) this.phase = "ascending"; // turned early
        break;
      case "bottom":
        this.trackBottom(knee, lean);
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
            cues.push(...this.evaluateRep());
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
      features: {
        knee_angle_deg: round(knee),
        side: m.side === "left" ? 0 : 1,
        ...(lean === null ? {} : { trunk_lean_deg: round(lean) }),
      },
      cues,
    };
  }

  /** The bottom of the rep is the frame with the smallest knee angle; lean is judged there. */
  private trackBottom(knee: number, lean: number | null) {
    if (knee < this.minKneeThisRep) {
      this.minKneeThisRep = knee;
      this.leanAtBottom = lean;
    }
  }

  /** Stage 4: the versioned rules, on a counted rep only. */
  private evaluateRep(): FeedbackCue[] {
    const v = this.cfg.version;
    const minKnee = round(this.minKneeThisRep);
    const cues: FeedbackCue[] = [];
    if (this.minKneeThisRep > this.cfg.shallowDepthKneeAngle) {
      cues.push(cueFor("squat.depth.shallow", v, { min_knee_angle_deg: minKnee }));
    }
    if (this.leanAtBottom !== null && this.leanAtBottom > this.cfg.maxTrunkLeanDeg) {
      cues.push(
        cueFor("squat.torso.forward_lean", v, {
          trunk_lean_deg: round(this.leanAtBottom),
          min_knee_angle_deg: minKnee,
        }),
      );
    }
    return cues;
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
    this.lean = null;
    this.leanAtBottom = null;
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
      this.lean = null;
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
    const torso = dist(shoulder!, hip!);
    return {
      side,
      knee: angle,
      confidence: quality.confidence,
      ankle: { x: ankle!.x, y: ankle!.y },
      torso,
      lean: this.trunkLean(shoulder!, hip!, knee!, torso),
    };
  }

  /**
   * Trunk lean from image vertical (deg), signed: + when the shoulder is on the knee's side of
   * the hip (forward, as in a squat), − when behind it. y grows downwards and plausibility has
   * already put the shoulder above the hip. Null when the knee isn't clearly ahead of the hip
   * (standing straight): there is no forward direction to measure against.
   */
  private trunkLean(shoulder: Landmark, hip: Landmark, knee: Landmark, torso: number) {
    const ahead = knee.x - hip.x;
    if (Math.abs(ahead) < this.cfg.leanDirectionMinToTorso * torso) return null;
    const dx = shoulder.x - hip.x;
    const deg = (Math.atan2(Math.abs(dx), hip.y - shoulder.y) * 180) / Math.PI;
    return Math.sign(dx) === Math.sign(ahead) ? deg : -deg;
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
    this.leanAtBottom = null;
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
