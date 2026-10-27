---
name: implement-fr
description: Implement one slice of a functional requirement end to end with test-first discipline, on a feature branch, ending with verify + review + traceability update.
argument-hint: "[FR-XX] [slice description]"
disable-model-invocation: true
---

Implement: **$ARGUMENTS**

1. **Branch.** If on `main`, create `feat/<fr-lowercase>-<slug>` (e.g. `feat/fr05-squat-depth`).
2. **Understand.** Read the FR text and acceptance criteria in `docs/requirements/fitpilot-blueprint-v1.md`, its row in `docs/requirements/traceability.md`, and the nearest CLAUDE.md for each folder you will touch. Restate the slice's acceptance criteria as a checklist.
3. **Contracts first.** If shapes change: edit `packages/exercise-contracts`, run `pnpm --filter @fitpilot/exercise-contracts export:jsonschema`, update `services/api/app/schemas`, keep the parity test green.
4. **Red.** Write the failing tests that prove each acceptance item (include the denial test for any new endpoint, the low-confidence test for any new cue).
5. **Green.** Implement the minimum to pass. Delegate specialist parts to the matching subagent when it is large.
6. **Verify.** Run `make verify`. Fix everything; never weaken a test to pass.
7. **Review.** Run the `code-reviewer` subagent on the diff; also `security-privacy-reviewer` if auth, data, logging, LLM context or camera handling changed. Address blockers.
8. **Trace.** Update the FR row in `docs/requirements/traceability.md` (code, tests, status) and tick the slice in `docs/roadmap/PROGRESS.md`.
9. **Commit** with a conventional message referencing the FR. Suggest `/ship` when the slice is complete.
