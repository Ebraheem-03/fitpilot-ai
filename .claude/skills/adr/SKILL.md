---
name: adr
description: Record an architecture decision as the next numbered ADR in docs/decisions, with options, trade-offs and consequences. Use when choosing between technologies or changing a boundary from docs/architecture/overview.md.
argument-hint: "[decision title]"
---

Write an ADR for: **$ARGUMENTS**

1. List `docs/decisions/` and pick the next number (4 digits). Use `docs/decisions/0000-template.md`.
2. Fill Context with the concrete forcing constraint (FR/NFR ids, a measurement, a cost). Compare at least two real options in the table — include "do nothing" when plausible.
3. If the decision needs current facts (pricing, free-tier limits, library versions), look them up rather than relying on memory, and cite the source URL in the ADR.
4. Status `proposed` unless the user has already decided. If it supersedes an ADR, update the old one's status line.
5. If it changes a boundary, update `docs/architecture/overview.md` in the same change.
