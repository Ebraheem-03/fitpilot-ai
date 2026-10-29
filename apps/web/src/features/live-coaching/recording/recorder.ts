import { SessionEvent, type TrackingDegradedReason } from "@fitpilot/exercise-contracts";
import type { ActiveCue } from "@fitpilot/exercise-rules";
import type { TrackingIssue, TrackingSnapshot } from "../engine/tracking";

/**
 * Turns what the live engine observed into contract `SessionEvent`s (FR-06 traceability, FR-07
 * "update progress only from valid session events", ADR-0011). Pure: no DOM, no network, no
 * clock of its own; the engine passes analysis time and the wall-clock time a set started.
 *
 * What is recorded, and only this (ADR-0011 §1: derived events, never frames or landmarks):
 * - `rep_completed` when the analyzer counts a rep (duration: the frame the rep left standing →
 *   the frame it was counted).
 * - `feedback_shown` once per cue the cue selector shows (`CueDecision.shown`), with the rule's
 *   measurements; `feedback_acknowledged` / `feedback_dismissed` when the member answers it.
 * - `tracking_degraded` per span of unreliable tracking as the member saw it (the tracking
 *   monitor's settled status), emitted when the span ends; spans under `MIN_DEGRADED_MS` aren't.
 * - `set_completed` when the set ends.
 *
 * Every event is validated against the zod `SessionEvent` before it is kept; one that fails is
 * a bug and goes to `rejected`, never to the sink. Nothing here sends anything: the injected
 * `sink` decides (S7: the IndexedDB outbox, flushed only after the camera stops). In practice
 * mode (no session id) the sink is never called, so practice events can't leave the device.
 */
export type EventSink = (events: readonly SessionEvent[]) => void;

export interface RecorderOptions {
  exerciseId: string;
  /** the server's workout session; absent ⇒ practice mode, events stay in memory */
  sessionId?: string;
  /** receives each batch of new events (only with a `sessionId`) */
  sink?: EventSink;
  /** set index of the first set this recorder records (a workout's earlier sets came before) */
  firstSetIndex?: number;
  /** idempotency keys (and the practice session id); `crypto.randomUUID` by default */
  newId?: () => string;
  minDegradedMs?: number;
}

/** What the engine knows after one frame. `analysis` is null when analysis was skipped. */
export interface FrameRecord {
  tMs: number;
  analysis: {
    phase: string;
    reps: number;
    repCompleted: boolean;
    tracking: { reliable: boolean; confidence: number };
  } | null;
  tracking: TrackingSnapshot;
  /** `CueDecision.shown` for this frame */
  shown: ActiveCue | null;
}

/**
 * Shorter unreliable spans aren't recorded. A UX choice, uncalibrated: the tracking monitor
 * already waits 300 ms before showing a change, and a sub-second blip says little about a set.
 */
export const MIN_DEGRADED_MS = 1000;

/**
 * Tracking issues → the contract's reasons. `no_frames` (nothing analysed for 2 s: frozen camera,
 * background tab, a struggling device) has no reason of its own; `slow_device` is the closest.
 */
export const DEGRADED_REASON: Record<TrackingIssue, TrackingDegradedReason> = {
  no_person: "no_person",
  out_of_frame: "out_of_frame",
  low_visibility: "low_visibility",
  low_light: "low_light",
  slow_device: "slow_device",
  unsupported_view: "unsupported_view",
  no_frames: "slow_device",
};

type Draft = { type: SessionEvent["type"] } & Record<string, unknown>;

export class SessionRecorder {
  readonly sessionId: string;
  readonly practice: boolean;
  private readonly exerciseId: string;
  private readonly sink: EventSink | undefined;
  private readonly newId: () => string;
  private readonly minDegradedMs: number;
  private all: readonly SessionEvent[] = [];
  private set: readonly SessionEvent[] = [];
  private failed: { event: Draft; error: string }[] = [];
  private setIndex: number;
  private open = false;
  /** wall-clock ms at analysis time 0 */
  private epochAtZero = 0;
  private repStartMs: number | null = null;
  private lastPhase: string | null = null;
  private span: { reason: TrackingDegradedReason; startMs: number } | null = null;

  constructor(opts: RecorderOptions) {
    this.newId = opts.newId ?? (() => crypto.randomUUID());
    this.exerciseId = opts.exerciseId;
    this.practice = opts.sessionId === undefined;
    this.sessionId = opts.sessionId ?? this.newId();
    this.sink = this.practice ? undefined : opts.sink;
    this.setIndex = opts.firstSetIndex ?? 0;
    this.minDegradedMs = opts.minDegradedMs ?? MIN_DEGRADED_MS;
  }

  /** every event recorded so far, all sets */
  get events(): readonly SessionEvent[] {
    return this.all;
  }

  /** the current (or last ended) set's events; a new array whenever one is added */
  get setEvents(): readonly SessionEvent[] {
    return this.set;
  }

  get rejected(): readonly { event: Draft; error: string }[] {
    return this.failed;
  }

  get setOpen(): boolean {
    return this.open;
  }

  /** A set starts: `tMs` in analysis time, `epochMs` the wall clock at that moment. */
  startSet(tMs: number, epochMs: number): void {
    if (this.open) return;
    this.open = true;
    this.epochAtZero = epochMs - tMs;
    this.set = [];
    this.repStartMs = null;
    this.lastPhase = null;
    this.span = null;
  }

  frame(f: FrameRecord): void {
    if (!this.open) return;
    const batch: Draft[] = [];
    this.trackSpan(f.tracking, f.tMs, batch);
    const a = f.analysis;
    if (a) {
      if (a.phase !== "standing" && (this.lastPhase === "standing" || this.lastPhase === null)) {
        this.repStartMs = f.tMs;
      }
      this.lastPhase = a.phase;
      if (a.repCompleted) {
        const started = this.repStartMs ?? f.tMs;
        batch.push({
          type: "rep_completed",
          occurred_at: this.iso(f.tMs),
          set_index: this.setIndex,
          rep_index: Math.max(0, a.reps - 1),
          duration_ms: clamp(Math.round(f.tMs - started), 1, 60_000),
          tracking_confidence: clamp(a.tracking.confidence, 0, 1),
        });
        this.repStartMs = null;
      }
    }
    const cue = f.shown;
    if (cue) {
      batch.push({
        type: "feedback_shown",
        occurred_at: this.iso(cue.shown_at_ms),
        rule_id: cue.rule_id,
        ruleset_version: cue.ruleset_version,
        message_id: cue.message_id,
        measurements: { ...cue.measurements },
        tracking_confidence: clamp(a?.tracking.confidence ?? f.tracking.confidence, 0, 1),
      });
    }
    this.emit(batch);
  }

  /** The member answered the cue on screen (FR-06). */
  respond(kind: "acknowledged" | "dismissed", cue: ActiveCue, tMs: number): void {
    if (!this.open) return;
    this.emit([
      {
        type: kind === "acknowledged" ? "feedback_acknowledged" : "feedback_dismissed",
        occurred_at: this.iso(tMs),
        rule_id: cue.rule_id,
        message_id: cue.message_id,
      },
    ]);
  }

  /** Paused by the member: an open unreliable span ends here (pausing isn't a tracking fault). */
  pause(tMs: number): void {
    if (!this.open) return;
    const batch: Draft[] = [];
    this.closeSpan(tMs, batch);
    this.emit(batch);
  }

  /** The set ended (stop, or the camera failed): close the open span, record the set. */
  endSet(tMs: number, reps: number): void {
    if (!this.open) return;
    const batch: Draft[] = [];
    this.closeSpan(tMs, batch);
    batch.push({
      type: "set_completed",
      occurred_at: this.iso(tMs),
      set_index: this.setIndex,
      reps,
    });
    this.emit(batch);
    this.open = false;
    this.setIndex += 1;
  }

  private trackSpan(t: TrackingSnapshot, tMs: number, batch: Draft[]) {
    const reason = t.status === "tracking" ? null : DEGRADED_REASON[t.issue ?? "low_visibility"];
    if (this.span?.reason === reason) return;
    this.closeSpan(tMs, batch);
    if (reason) this.span = { reason, startMs: tMs };
  }

  private closeSpan(tMs: number, batch: Draft[]) {
    const span = this.span;
    this.span = null;
    if (!span) return;
    const duration = Math.round(tMs - span.startMs);
    if (duration < this.minDegradedMs) return;
    batch.push({
      type: "tracking_degraded",
      occurred_at: this.iso(span.startMs),
      reason: span.reason,
      duration_ms: Math.min(duration, 3_600_000),
    });
  }

  private emit(batch: Draft[]) {
    if (batch.length === 0) return;
    const valid: SessionEvent[] = [];
    for (const draft of batch) {
      const event = {
        ...draft,
        session_id: this.sessionId,
        exercise_id: this.exerciseId,
        idempotency_key: this.newId(),
      };
      const parsed = SessionEvent.safeParse(event);
      if (parsed.success) valid.push(parsed.data);
      else this.failed.push({ event, error: parsed.error.message });
    }
    if (valid.length === 0) return;
    this.all = [...this.all, ...valid];
    this.set = [...this.set, ...valid];
    this.sink?.(valid);
  }

  private iso(tMs: number): string {
    return new Date(this.epochAtZero + tMs).toISOString();
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
