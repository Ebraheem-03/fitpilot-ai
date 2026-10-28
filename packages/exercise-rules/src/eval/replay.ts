import {
  type ClipLabels,
  FIXTURE_LANDMARK_STRIDE,
  type LandmarkFixture,
} from "@fitpilot/exercise-contracts";
import type { LandmarkFrame } from "../core/confidence";

/**
 * Vision regression (FR-05, blueprint §14): replays recorded landmark sequences through an
 * analyzer and scores its rep counting against human annotations. Pure — runs in Vitest.
 */

/** The part of an analyzer the regression needs (every exercise analyzer satisfies it). */
export interface RepCounter {
  step(
    frame: LandmarkFrame,
    tMs: number,
  ): { repCompleted: boolean; tracking: { reliable: boolean } };
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
}

export function evaluateClip(
  counter: RepCounter,
  fixture: LandmarkFixture,
  labels: ClipLabels,
  toleranceMs: number,
): ClipEvaluation {
  const countedAtMs: number[] = [];
  let unreliable = 0;
  const frames = decodeFrames(fixture);
  for (const { tMs, frame } of frames) {
    const r = counter.step(frame, tMs);
    if (!r.tracking.reliable) unreliable += 1;
    if (r.repCompleted) countedAtMs.push(tMs);
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
