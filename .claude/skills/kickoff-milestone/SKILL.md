---
name: kickoff-milestone
description: Plan a FitPilot milestone (M0–M5) into small, FR-traced, testable work slices before any code is written.
argument-hint: "[M0|M1|M2|M3|M4|M5]"
disable-model-invocation: true
---

Plan milestone **$ARGUMENTS** for FitPilot AI. Do not write application code in this step.

1. Read `docs/roadmap/PROGRESS.md`, the milestone in `docs/requirements/fitpilot-blueprint-v1.md` §11, every FR it touches, `docs/requirements/traceability.md`, and relevant ADRs.
2. State the milestone's exit condition verbatim and list what already exists in the repo toward it (check the code, don't assume).
3. Identify the riskiest unknown and propose a spike that answers it first (e.g. worker fps on the target devices, GLB rig quality).
4. Break the rest into 4–10 vertical slices. For each: title, FR ids, acceptance test(s) that will prove it, files/modules touched, which subagent owns it (`vision-engineer`, `threed-engineer`, `backend-engineer`, `ai-engineer`, `test-engineer`), estimate (S/M/L), dependencies.
5. Flag anything out of scope for this milestone and any decision that needs an ADR.
6. Write the plan into the milestone section of `docs/roadmap/PROGRESS.md` as checkboxes, and update "Current milestone".
7. Ask whether to create GitHub issues for the slices (`gh issue create` using `.github/ISSUE_TEMPLATE/requirement-task.md`). Only create them after a yes.
