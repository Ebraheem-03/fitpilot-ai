---
name: trace
description: Audit requirements traceability — check each FR row in docs/requirements/traceability.md against the actual code and tests, and report gaps, stale rows and acceptance criteria without tests.
argument-hint: "[optional FR-XX]"
context: fork
agent: Explore
---

Audit traceability for: $ARGUMENTS (all FRs if empty).

For each FR row in `docs/requirements/traceability.md`:

1. Do the listed code paths exist? Find where the FR is actually implemented if the paths are wrong.
2. For each acceptance criterion in `docs/requirements/fitpilot-blueprint-v1.md`, find the test(s) that prove it. Mark: proven / partially / missing.
3. Does the status emoji match reality?

Return a compact table: FR · criterion · evidence (test file:name) · verdict, then a short list of the highest-value missing tests. Do not edit files.
