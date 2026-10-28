---
name: recurring-async-lifecycle-gaps
description: Recurring defects in async camera/worker engine code (live-coaching); check these first in future reviews
metadata:
  type: feedback
---

In `apps/web/src/features/live-coaching/engine` (PR #38) the generation-counter pattern was applied after some awaits but not all (missed after `video.play()`), and no stale-result watchdog existed.

**Why:** stop/dispose during an un-guarded await leaks a worker; stalled frames leave a stale "tracking" status (violates principle 3).

**How to apply:** in async engine code, check every `await` for a generation check, every create-resource path for a terminate path, bitmap close on error paths, double-start guard, focus management when buttons unmount, and that e2e does not only prove the happy path.
