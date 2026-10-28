import type { LandmarkFixture } from "@fitpilot/exercise-contracts";
import { unpackFixtureFrame } from "../../landmarks";
import type { PoseDelegate } from "../../worker/protocol";
import type { PoseSource } from "../engine";

/**
 * Test support (ADR-0010 §8): replays a recorded landmark fixture as if the worker had produced
 * it, so the engine runs end to end in Vitest. Not imported by product code.
 */
export class FixtureReplayPoseSource implements PoseSource {
  crashHandler: ((error: Error) => void) | null = null;
  busy = false;
  closed = false;
  private readonly stepMs: number;

  constructor(private readonly fixture: LandmarkFixture) {
    this.stepMs = 1000 / fixture.source.fps;
  }

  async init(): Promise<{ delegate: PoseDelegate }> {
    return { delegate: "CPU" };
  }

  async detect(frame: ImageBitmap, tMs: number) {
    frame.close?.();
    const i = Math.min(this.fixture.frames.length - 1, Math.floor(tMs / this.stepMs));
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
