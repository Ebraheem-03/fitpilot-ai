---
name: vision-rule-contract
description: Reference for writing or changing movement-analysis rules, thresholds, state machines or feedback cues in packages/exercise-rules. Load whenever editing exercise analysis logic.
user-invocable: false
paths: packages/exercise-rules/**
---

# FitPilot rule contract (blueprint §8)

Every rule declares, in code comments next to its ruleset:

| Field                     | Example (squat depth)                                                             |
| ------------------------- | --------------------------------------------------------------------------------- |
| exercise + rule version   | `bodyweight_squat`, ruleset v1                                                    |
| required landmarks + view | left hip/knee/ankle/shoulder; side view, ~90° to camera                           |
| features                  | knee angle (deg, 2D), min knee angle per rep                                      |
| validity conditions       | all required visibility ≥ 0.6; rep duration ≥ 600 ms                              |
| observable condition      | min knee angle > 120° at end of rep                                               |
| permitted message         | "Try sitting a little deeper if it feels comfortable." (`squat_depth_shallow_v1`) |
| withhold when             | tracking unreliable during the rep; wrong camera view detected                    |
| tests                     | synthetic shallow rep emits cue; deep rep doesn't; low visibility emits nothing   |

Message style: describe an observable movement and an optional adjustment. Never diagnose injury, pain or medical risk; never imply certainty beyond the measurement. If something sounds like a safety concern, the cue suggests stopping and consulting a professional and the session logs an escalation candidate.

Threshold changes: bump `ruleset_version`, note the fixture set + metrics that justify it, keep the old version's behaviour reproducible in tests.

Cue selection (stage 5): at most one cue at a time, highest priority first, cooldown per `message_id` (don't nag), never during unreliable tracking.
