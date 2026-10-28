# ADR-0011: What workout-session data leaves the device, when, and with whose consent

- **Status:** accepted (coordinator decision at M3 kickoff; owner may revise the consent copy)
- **Date:** 2026-10-28
- **Requirements:** FR-05 (record session metrics), FR-06, FR-07, FR-13, NFR-Privacy, NFR-Availability, principle 5
- **Builds on:** ADR-0002 (browser-side vision), ADR-0010 §9 (no third-party requests from the worker)

## Context

M2 shipped with a strong promise. The camera page tells the member their camera "is processed on this device only", and the live-coaching EXIT e2e fails on any non-GET request during a session. M2 S8 deferred client diagnostics because they would break that promise.

M3's exit condition needs a **saved** session summary that survives a reload (FR-07). FR-05 also asks us to "record session metrics and confidence information for later review". So some derived data now has to leave the device. The open questions are which data, at what moment, and on what basis.

Constraints:

- Blueprint §6: "Raw video should not be stored"; "store only the movement metrics needed for feedback and evaluation".
- Architecture boundary 1: "Nothing below the worker line leaves the device except `SessionEvent`s."
- The browser reaches the API only through server actions (M0); tokens stay server-side.
- FR-07: "Recover gracefully from temporary network loss"; "Update progress only from valid session events".

## Options considered

| Option                                                                                       | Pros                                                                                                                                                      | Cons                                                                                                                                         |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Do nothing (keep everything on device; summary in IndexedDB only)                            | Strongest privacy story; no API work                                                                                                                      | Fails FR-07 (history lost on another device or after clearing storage); trainers can never review (principle 4); progress (FR-10) impossible |
| Stream events live while the camera runs                                                     | Simplest server-side state; nothing lost on a crash                                                                                                       | Data leaves while the camera is on, so the M2 promise and its test are weakened; per-rep network chatter on weak connections                 |
| **Buffer derived events on device; send only after the camera stops, with one-time consent** | Camera-on period stays network-silent (still testable); outbox gives offline recovery for free; consent is explicit and auditable; payload is allowlisted | Crash before flush loses nothing (outbox persists) but delays history until the next visit; needs an outbox and a consent record             |
| Upload a session summary only (no events)                                                    | Smallest payload                                                                                                                                          | Server can't verify the summary, which breaks "update progress only from valid session events"; cue traceability (FR-06) lost                |

## Decision

1. **What may leave the device: `SessionEvent`s only**, as defined in `packages/exercise-contracts/src/session-events.ts`. Never frames, images, landmarks, per-frame features or angles. A `feedback_shown` event carries only the measurements its rule declares (e.g. `min_knee_angle_deg`). The API schemas use `extra="forbid"`. The API rejects unknown `rule_id`s and measurement keys the rule doesn't declare, so landmark data can't be smuggled in a free-form record.
2. **When: never while the camera is running.** The live engine appends events to an on-device **outbox** (IndexedDB, keyed by `idempotency_key`). The outbox flushes when a set ends (camera stopped), when the workout is completed, and on reconnect or the next app load. While a camera session runs, the page sends no non-GET requests (the M2 EXIT assertion keeps holding for that window).
3. **Transport:** server action → `POST /api/v1/workout-sessions/{id}/events` (batch). There is a batch cap (≤ 500 events, ≤ 64 KiB), and duplicates by `idempotency_key` are stored once. Completion is `POST …/complete`. It is idempotent, and the summary is computed **server-side from stored events only**.
4. **Consent: one-time, explicit, recorded.** Before a member's first tracked set, the live page explains in plain words what is saved: "rep counts, rep timing, tracking quality and the measurements behind each cue; never video or body points". It asks the member to agree. The API stores `tracking_data_consent_at` and `tracking_data_consent_version` on `member_profiles`. Without consent, live tracking still works exactly as in M2, and nothing tracked is saved. The member can still log sets by hand. Consent can be withdrawn on the profile page, and withdrawing stops future uploads.
5. **Retention and deletion:** session events and summaries live as long as the account, under the same RLS + API authorization as profiles. A member can delete one of their sessions (`DELETE /workout-sessions/{id}`), which removes its events and its summary.
6. **Logging (FR-13):** the API logs event counts, types and validation outcomes, never measurement values or free-text notes.

## Consequences

- The M2 privacy copy changes from "nothing leaves this device" to the precise statement above. The EXIT e2e changes to: zero non-GET requests while the camera runs; after it stops, only own-origin POSTs whose bodies parse as a `SessionEvent` batch, with no image or landmark fields.
- `tracking_degraded` events (deferred from M2 S8) can now be recorded, because they travel in the same outbox under the same consent.
- New tests: outbox offline → reload → flush stored once; consent missing ⇒ no event POSTs; API rejects undeclared measurement keys and unknown rule ids; delete removes events.
- History can lag if a member closes the tab before the flush. The next app load flushes it. That's acceptable for a portfolio MVP. Monitor how many sessions are left uncompleted in M5.
