---
name: squat-cue-threshold-findings
description: Measured trunk-lean and knee-depth distributions on the bodyweight_squat fixtures, lean threshold sweep, and why both squat cue rules are still uncalibrated (no positive examples)
metadata:
  type: project
---

Squat cue rules (ruleset v4, M3 S2, 2026-10-29): `squat.depth.shallow` (min knee > 120°) and `squat.torso.forward_lean` (lean from vertical at the bottom > 60°). Both are **uncalibrated**: the fixture set has no positive examples.

- Trunk lean at the bottom (hip to shoulder against image vertical, smoothed, on the min-knee frame): real side-view reps measure 16–51° (lite) and up to about 49° (full). The mannequin measures about 29°; its authored hinge is pelvis 18 + spine 10 + chest 8.
- Lean-threshold sweep, lean cues on real supported reps (lite / full): 35° gives 27/29, 40° 14/20, 45° 3/1, 50° 1/0, 55° and 60° 0/0. At 35–40° the **full** model also fires 3–4 cues on unsupported clips. Lite fires none on unsupported clips at any threshold.
- Depth: lite min knee on real reps is about 43–80°, except pexels_7117089 at 107–113°. That clip is slow, backlit and labelled full depth; the full model measures 122.7° there and emits a false shallow cue.
- All 48 by-eye reps are `full_depth: true`. Lean was never judged by eye, because the Pexels videos were deleted and there's no ffmpeg in the environment.

**Why:** a lower lean threshold can't be justified without by-eye lean labels. Every cue below 45° would land on an unjudged rep.
**How to apply:** before changing either threshold, get recordings with by-eye `cue_labels` (shallow reps, deliberate forward lean), then bump the ruleset version and cite the gate numbers. See [[worktree-tooling-pitfalls]] for how to edit labels.
