import type { LandmarkFixture } from "@fitpilot/exercise-contracts";
import { unpackFixtureFrame } from "../../landmarks";
import type { PoseDelegate } from "../../worker/protocol";
import type { PoseSource } from "../engine";

/** Maps engine time to a fixture time; `hidden` ⇒ nobody detected (e.g. `feedFrameAt`). */
export type ReplayTimeline = (tMs: number) => { tMs: number; hidden: boolean };

/**
 * Test support (ADR-0010 §8): replays a recorded landmark fixture as if the worker had produced
 * it, so the engine runs end to end in Vitest. Not imported by product code.
 */
export class FixtureReplayPoseSource implements PoseSource {
  crashHandler: ((error: Error) => void) | null = null;
  busy = false;
  closed = false;
  private readonly stepMs: number;

  /**
   * `timeline` re-times the replay: e.g. a shallow squat built from the fixture's first descent
   * (`bench/feed-timeline.ts`, the same mapping the e2e camera feed uses).
   */
  constructor(
    private readonly fixture: LandmarkFixture,
    private readonly timeline?: ReplayTimeline,
  ) {
    this.stepMs = 1000 / fixture.source.fps;
  }

  async init(): Promise<{ delegate: PoseDelegate }> {
    return { delegate: "CPU" };
  }

  async detect(frame: ImageBitmap, tMs: number) {
    frame.close?.();
    const at = this.timeline?.(tMs) ?? { tMs, hidden: false };
    if (at.hidden) return { landmarks: null };
    const i = Math.min(this.fixture.frames.length - 1, Math.floor(at.tMs / this.stepMs));
    return { landmarks: unpackFixtureFrame(this.fixture, i) };
  }

  /** simulate the worker dying */
  crash(message = "worker crashed") {
    this.crashHandler?.(new Error(message));
  }

  terminate(): void {
    this.closed = true;
  }
}
