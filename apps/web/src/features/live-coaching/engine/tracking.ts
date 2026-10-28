/**
 * Turns per-frame tracking facts into what the member sees (FR-04: "receive tracking-status
 * feedback"; principle 3: say when analysis isn't reliable, and why). Thresholds are UX choices,
 * uncalibrated; the fps floor comes from ADR-0010 §7.
 */
export type TrackingStatus = "searching" | "tracking" | "unreliable";
export type TrackingIssue =
  | "no_person"
  | "out_of_frame"
  | "low_visibility"
  | "low_light"
  | "slow_device"
  | "unsupported_view";

export interface FrameObservation {
  tMs: number;
  personDetected: boolean;
  /** the analyzer's own verdict for this frame (required landmarks visible) */
  analysisReliable: boolean;
  confidence: number;
  /** a required landmark lies outside the image */
  outOfFrame: boolean;
  /** mean luma 0–1 from the latest sample, null if not sampled yet */
  luma: number | null;
  /** analyzer says the camera angle isn't one the exercise supports (S4) */
  unsupportedView?: boolean;
}

export interface TrackingSnapshot {
  status: TrackingStatus;
  issue: TrackingIssue | null;
  confidence: number;
  /** processed frames per second over the window; null until the window fills */
  fps: number | null;
  /** below the comfortable rate: tell the member, keep going */
  slow: boolean;
}

export const TRACKING_CONFIG = {
  /** a new status must persist this long before it's shown (no flicker) */
  settleMs: 300,
  fpsWindowMs: 2000,
  slowFps: 15,
  minFps: 8,
  lowLuma: 0.15,
};

const INITIAL: TrackingSnapshot = {
  status: "searching",
  issue: "no_person",
  confidence: 0,
  fps: null,
  slow: false,
};

export class TrackingMonitor {
  private times: number[] = [];
  private shown: TrackingSnapshot = INITIAL;
  private pending: { status: TrackingStatus; issue: TrackingIssue | null; since: number } | null =
    null;

  constructor(private readonly cfg = TRACKING_CONFIG) {}

  get snapshot(): TrackingSnapshot {
    return this.shown;
  }

  /** false while the device is too slow for the state machine's timing to mean anything */
  get analysisAllowed(): boolean {
    const fps = this.fps();
    return fps === null || fps >= this.cfg.minFps;
  }

  observe(obs: FrameObservation): TrackingSnapshot {
    this.times.push(obs.tMs);
    while (this.times[0]! < obs.tMs - this.cfg.fpsWindowMs) this.times.shift();
    const fps = this.fps();

    let status: TrackingStatus;
    let issue: TrackingIssue | null;
    if (!obs.personDetected) [status, issue] = ["searching", "no_person"];
    else if (!this.analysisAllowed) [status, issue] = ["unreliable", "slow_device"];
    else if (obs.unsupportedView) [status, issue] = ["unreliable", "unsupported_view"];
    else if (!obs.analysisReliable) {
      status = "unreliable";
      issue = obs.outOfFrame
        ? "out_of_frame"
        : obs.luma !== null && obs.luma < this.cfg.lowLuma
          ? "low_light"
          : "low_visibility";
    } else [status, issue] = ["tracking", null];

    if (status === this.shown.status && issue === this.shown.issue) this.pending = null;
    else if (!this.pending || this.pending.status !== status || this.pending.issue !== issue) {
      this.pending = { status, issue, since: obs.tMs };
    }
    const settled = this.pending && obs.tMs - this.pending.since >= this.cfg.settleMs;
    this.shown = {
      status: settled ? this.pending!.status : this.shown.status,
      issue: settled ? this.pending!.issue : this.shown.issue,
      confidence: obs.personDetected ? obs.confidence : 0,
      fps: fps === null ? null : Math.round(fps * 10) / 10,
      slow: fps !== null && fps < this.cfg.slowFps,
    };
    if (settled) this.pending = null;
    return this.shown;
  }

  reset(): void {
    this.times = [];
    this.pending = null;
    this.shown = INITIAL;
  }

  private fps(): number | null {
    const n = this.times.length;
    if (n < 2) return null;
    const span = this.times[n - 1]! - this.times[0]!;
    // judge only over (nearly) a full window, so start-up doesn't look slow
    if (span < this.cfg.fpsWindowMs * 0.9) return null;
    return ((n - 1) / span) * 1000;
  }
}
