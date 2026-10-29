---
name: synthetic-cue-feed
description: How the shallow-squat mannequin feed triggers squat.depth.shallow deterministically (clip-time remap, peak 1033 ms ≈ 130° on lite), the narrow 120–140° window, and cooldown-driven feed timing
metadata:
  type: project
---

The full-depth mannequin never fires a cue (min knee ~69°, lean ~29°). M3 S3 (2026-10-29) added a **shallow** feed by re-timing the authored clip instead of authoring a new one (`bench/feed-timeline.ts`, `SHALLOW_MOTION`): stand 0–0.5 s, play the clip's own descent to `peakMs`, hold, play the same poses back up. Every frame is an authored pose with feet planted.

- Lite-model knee angle vs clip time on `mannequin_side_lite` (aspect-corrected, left leg): 967 ms 140°, 1000 ms 134.6°, **1033 ms 130.6°**, 1067 ms 124.6°, 1100 ms 120.1°. Peak 1033 ms sits mid-window.
- The window is narrow. A rep must reach ≤ 140° to count (`countMaxKneeAngle`) and stay > 120° to cue (`shallowDepthKneeAngle`). If either threshold moves, re-pick `peakMs`, or the cue e2e breaks.
- The same remap drives the Vitest replay (`FixtureReplayPoseSource(fixture, timeline)`) and the e2e Y4M, so engine and component tests check exactly what the e2e feeds the real model.
- Feed timing follows the cue policy: a 20 s cooldown with 3.5 s loops gives cues on rep 1 and rep 7 (21 s). With 4 s loops, the second cue lands exactly on 20 s and becomes a race. Hidden loop 1 comes right after rep 1, so the first cue is withdrawn by "nobody in view" about 1 s after it appears.
- Measured locally (M1 Pro, dev server, headless): analysis result → cue in the DOM, run medians 5–7 ms over 4 runs (2 cues each). Every run showed 2/2 cues.

**Why:** the cue e2e depends on these numbers, and they aren't obvious from the code.
**How to apply:** when changing squat thresholds, `DEFAULT_CUE_POLICY`, or the avatar clip, re-check this window and the loop timing. See [[squat-cue-threshold-findings]].
