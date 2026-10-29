/**
 * Timeline of a synthetic camera feed (ADR-0010 §8): which moment of the mannequin's squat clip a
 * feed frame shows. Pure, so the same mapping builds the e2e video (fake-camera.ts) and replays a
 * recorded landmark fixture in Vitest (engine/testing/fixture-source.ts).
 *
 * - `full`: the authored clip, looped (standing 0–0.5 s, bottom 2.0–2.4 s, standing again 3.6 s).
 * - `shallow`: a partial squat built from the clip's own descent. It plays standing → `peakMs` of
 *   the clip → back up the same poses, holding at `peakMs`, so every frame is an authored pose
 *   with the feet planted. The default peak is where the lite model measures a knee angle of about
 *   130° on the mannequin (`mannequin_side_lite.landmarks.json`, 1033 ms: 130.6°): deep enough to
 *   count (≤ 140°), shallow enough for `squat.depth.shallow` (> 120°).
 */
export type FeedMotion =
  | { kind: "full" }
  | {
      kind: "shallow";
      /** clip time of the lowest pose */
      peakMs: number;
      /** feed time spent going down (and again coming up) */
      descentMs: number;
      /** feed time held at the lowest pose */
      holdMs: number;
      /** one shallow rep, standing time included */
      loopMs: number;
    };

export interface FeedPlan {
  width: number;
  height: number;
  fps: number;
  /** standing still before the first loop (covers model download + warm-up) */
  leadInMs: number;
  loops: number;
  /** loops that show an empty room */
  hiddenLoops: number[];
  /** default `full` */
  motion?: FeedMotion;
}

/** The clip's standing pose lasts until here; a shallow rep starts its descent from it. */
const CLIP_STAND_MS = 500;

export const SHALLOW_MOTION: Extract<FeedMotion, { kind: "shallow" }> = {
  kind: "shallow",
  peakMs: 1033,
  descentMs: 1000,
  holdMs: 400,
  loopMs: 3500,
};

export function loopMsOf(plan: FeedPlan, clipDurationMs: number): number {
  return plan.motion?.kind === "shallow" ? plan.motion.loopMs : clipDurationMs;
}

export function feedDurationMs(plan: FeedPlan, clipDurationMs: number): number {
  return plan.leadInMs + plan.loops * loopMsOf(plan, clipDurationMs);
}

/** What the feed shows at feed time `tMs`: a clip time, and whether the room is empty. */
export function feedFrameAt(
  plan: FeedPlan,
  clipDurationMs: number,
  tMs: number,
): { clipMs: number; hidden: boolean } {
  const t = tMs - plan.leadInMs;
  if (t < 0) return { clipMs: 0, hidden: false };
  const loopMs = loopMsOf(plan, clipDurationMs);
  const loop = Math.floor(t / loopMs);
  const hidden = plan.hiddenLoops.includes(loop);
  const u = t - loop * loopMs;
  const motion = plan.motion ?? { kind: "full" };
  if (motion.kind === "full") return { clipMs: u % clipDurationMs, hidden };

  const { peakMs, descentMs, holdMs } = motion;
  const down = CLIP_STAND_MS + descentMs;
  const held = down + holdMs;
  const up = held + descentMs;
  const along = (f: number) => CLIP_STAND_MS + (peakMs - CLIP_STAND_MS) * f;
  let clipMs: number;
  if (u < CLIP_STAND_MS) clipMs = u;
  else if (u < down) clipMs = along((u - CLIP_STAND_MS) / descentMs);
  else if (u < held) clipMs = peakMs;
  else if (u < up) clipMs = along(1 - (u - held) / descentMs);
  else clipMs = CLIP_STAND_MS;
  return { clipMs, hidden };
}
