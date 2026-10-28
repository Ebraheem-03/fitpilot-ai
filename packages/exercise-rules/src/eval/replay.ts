import {
  type ClipLabels,
  FIXTURE_LANDMARK_STRIDE,
  type LandmarkFixture,
} from "@fitpilot/exercise-contracts";
import type { LandmarkFrame } from "../core/confidence";
import type { FeedbackCue } from "../core/types";

/**
 * Vision regression (FR-05, FR-06, blueprint §14): replays recorded landmark sequences through an
 * analyzer and scores its rep counting and its cues against human annotations. Pure — runs in
 * Vitest.
 */

/** The part of an analyzer the regression needs (every exercise analyzer satisfies it). */
export interface RepCounter {
  step(
    frame: LandmarkFrame,
    tMs: number,
  ): { repCompleted: boolean; tracking: { reliable: boolean }; cues: readonly FeedbackCue[] };
}

/** How one rule's cues on one clip compare with the clip's `cue_labels`. */
export interface CueScore {
  rule_id: string;
  method: string;
  /** reps labelled as warranting the cue */
  expected: number;
  /** reps labelled as not warranting it: the chances to be wrong on a labelled rep */
  judgedNegatives: number;
  truePositives: number;
  /** cues on not-expected reps + stray cues */
  falsePositives: number;
  falseNegatives: number;
  /** cues outside every labelled rep (or a second cue on one rep): no squat there to judge */
  stray: number;
  /** cues on reps the labels leave unjudged for this rule (not scored) */
  unjudged: number;
}

/**
 * Fixture frames → analyzer frames. Fixtures store MediaPipe's normalised coordinates (x / width,
 * y / height); analyzers need true geometry, so x is rescaled to image-height units (see
 * `LandmarkFrame`). Without this, portrait clips measure stretched angles (calibration finding).
 */
export function decodeFrames(fixture: LandmarkFixture): { tMs: number; frame: LandmarkFrame }[] {
  const aspect = fixture.source.width / fixture.source.height;
  return fixture.frames.map(({ t_ms, p }) => {
    const frame: LandmarkFrame = {};
    if (p) {
      fixture.landmark_names.forEach((name, i) => {
        const o = i * FIXTURE_LANDMARK_STRIDE;
        frame[name] = {
          x: p[o]! * aspect,
          y: p[o + 1]!,
          z: p[o + 2]! * aspect,
          visibility: p[o + 3]!,
        };
      });
    }
    return { tMs: t_ms, frame };
  });
}

export interface ClipEvaluation {
  clip_id: string;
  supported: boolean;
  labelled: number;
  counted: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** counted reps that completed inside an annotated untrackable span (also false positives) */
  repsInUntrackable: number;
  /** indices into labels.reps that no counted rep matched */
  missedLabels: number[];
  countedAtMs: number[];
  unreliableFrameRatio: number;
  /** every raw cue the analyzer emitted (before any cooldown), with its frame time */
  cuesEmitted: { tMs: number; cue: FeedbackCue }[];
  /** cues emitted inside an annotated untrackable span (must be 0) */
  cuesInUntrackable: number;
  /** one entry per rule in the clip's `cue_labels` (none when the clip has no cue labels) */
  cueScores: CueScore[];
}

export function evaluateClip(
  counter: RepCounter,
  fixture: LandmarkFixture,
  labels: ClipLabels,
  toleranceMs: number,
): ClipEvaluation {
  const countedAtMs: number[] = [];
  const cuesEmitted: ClipEvaluation["cuesEmitted"] = [];
  let unreliable = 0;
  const frames = decodeFrames(fixture);
  for (const { tMs, frame } of frames) {
    const r = counter.step(frame, tMs);
    if (!r.tracking.reliable) unreliable += 1;
    if (r.repCompleted) countedAtMs.push(tMs);
    for (const cue of r.cues) cuesEmitted.push({ tMs, cue });
  }

  const inUntrackable = (t: number) =>
    labels.untrackable_ranges_ms.some(([a, b]) => t >= a && t <= b);
  const matched = new Set<number>();
  let truePositives = 0;
  let repsInUntrackable = 0;
  for (const t of countedAtMs) {
    if (inUntrackable(t)) {
      repsInUntrackable += 1;
      continue;
    }
    if (!labels.supported) continue;
    // greedy in time order: earliest unmatched label whose window contains the completion
    const i = labels.reps.findIndex(
      (rep, idx) =>
        !matched.has(idx) && t >= rep.start_ms - toleranceMs && t <= rep.end_ms + toleranceMs,
    );
    if (i >= 0) {
      matched.add(i);
      truePositives += 1;
    }
  }

  // On an unsupported setup withholding is the correct outcome, so labels are not owed.
  const missedLabels = labels.supported
    ? labels.reps.map((_, i) => i).filter((i) => !matched.has(i))
    : [];
  return {
    clip_id: labels.clip_id,
    supported: labels.supported,
    labelled: labels.supported ? labels.reps.length : 0,
    counted: countedAtMs.length,
    truePositives,
    falsePositives: countedAtMs.length - truePositives,
    falseNegatives: missedLabels.length,
    repsInUntrackable,
    missedLabels,
    countedAtMs,
    unreliableFrameRatio: frames.length ? unreliable / frames.length : 0,
    cuesEmitted,
    cuesInUntrackable: cuesEmitted.filter((c) => inUntrackable(c.tMs)).length,
    cueScores: scoreCues(cuesEmitted, labels, toleranceMs),
  };
}

/**
 * The labelled rep a cue at `t` belongs to: of the reps whose [start − tol, end + tol] window
 * contains it, the one whose end is nearest (cues fire as a rep finishes). -1 when none.
 */
function repAt(labels: ClipLabels, t: number, toleranceMs: number): number {
  let best = -1;
  labels.reps.forEach((rep, i) => {
    if (t < rep.start_ms - toleranceMs || t > rep.end_ms + toleranceMs) return;
    if (best < 0 || Math.abs(t - rep.end_ms) < Math.abs(t - labels.reps[best]!.end_ms)) best = i;
  });
  return best;
}

function scoreCues(
  emitted: ClipEvaluation["cuesEmitted"],
  labels: ClipLabels,
  toleranceMs: number,
): CueScore[] {
  if (!labels.supported || !labels.cue_labels) return [];
  return labels.cue_labels.rules.map((rule) => {
    const expected = new Set(rule.expected_reps);
    const notExpected = new Set(rule.not_expected_reps);
    const cued = new Set<number>();
    let stray = 0;
    let unjudged = 0;
    for (const { tMs, cue } of emitted) {
      if (cue.rule_id !== rule.rule_id) continue;
      const i = repAt(labels, tMs, toleranceMs);
      if (i < 0 || cued.has(i)) stray += 1;
      else {
        cued.add(i);
        if (!expected.has(i) && !notExpected.has(i)) unjudged += 1;
      }
    }
    const truePositives = [...expected].filter((i) => cued.has(i)).length;
    const onNegatives = [...notExpected].filter((i) => cued.has(i)).length;
    return {
      rule_id: rule.rule_id,
      method: rule.method,
      expected: expected.size,
      judgedNegatives: notExpected.size,
      truePositives,
      falsePositives: onNegatives + stray,
      falseNegatives: expected.size - truePositives,
      stray,
      unjudged,
    };
  });
}

export interface CueTotals {
  judgedNegatives: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  stray: number;
  /** false cues ÷ (not-expected reps + stray cues); 0 when there was no chance to be wrong */
  falsePositiveRate: number;
  /** null when no rep was labelled as warranting the cue: no evidence either way */
  recall: number | null;
}

export interface CueSummary extends CueTotals {
  /** raw cues emitted across all clips */
  emitted: number;
  inUntrackable: number;
  /** cues emitted on `supported: false` clips (must be 0) */
  onUnsupported: number;
  byRule: Record<string, CueTotals>;
}

function totals(scores: CueScore[]): CueTotals {
  const sum = (k: keyof Omit<CueScore, "rule_id" | "method">) =>
    scores.reduce((n, s) => n + s[k], 0);
  const judgedNegatives = sum("judgedNegatives");
  const tp = sum("truePositives");
  const fp = sum("falsePositives");
  const fn = sum("falseNegatives");
  const stray = sum("stray");
  const chances = judgedNegatives + stray;
  return {
    judgedNegatives,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    stray,
    falsePositiveRate: chances === 0 ? 0 : fp / chances,
    recall: tp + fn === 0 ? null : tp / (tp + fn),
  };
}

export function aggregateCues(evals: ClipEvaluation[]): CueSummary {
  const scores = evals.flatMap((e) => e.cueScores);
  const byRule: Record<string, CueTotals> = {};
  for (const id of new Set(scores.map((s) => s.rule_id))) {
    byRule[id] = totals(scores.filter((s) => s.rule_id === id));
  }
  return {
    ...totals(scores),
    emitted: evals.reduce((n, e) => n + e.cuesEmitted.length, 0),
    inUntrackable: evals.reduce((n, e) => n + e.cuesInUntrackable, 0),
    onUnsupported: evals.filter((e) => !e.supported).reduce((n, e) => n + e.cuesEmitted.length, 0),
    byRule,
  };
}

export interface RegressionSummary {
  clips: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  repsInUntrackable: number;
  /** tp / counted — 1 when nothing was counted */
  precision: number;
  /** tp / labelled — 1 when nothing was labelled */
  recall: number;
}

export function aggregate(evals: ClipEvaluation[]): RegressionSummary {
  const sum = (k: "truePositives" | "falsePositives" | "falseNegatives" | "repsInUntrackable") =>
    evals.reduce((n, e) => n + e[k], 0);
  const tp = sum("truePositives");
  const fp = sum("falsePositives");
  const fn = sum("falseNegatives");
  return {
    clips: evals.length,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    repsInUntrackable: sum("repsInUntrackable"),
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
  };
}
