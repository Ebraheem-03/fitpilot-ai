import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoseRunner } from "./pose-runner";

const mp = vi.hoisted(() => ({
  created: [] as { delegate: string; closed: boolean; failDetect: boolean }[],
  failCreate: new Set<string>(),
  failDetect: new Set<string>(),
}));

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  PoseLandmarker: {
    createFromOptions: async (_: unknown, o: { baseOptions: { delegate: string } }) => {
      const delegate = o.baseOptions.delegate;
      if (mp.failCreate.has(delegate)) throw new Error(`${delegate} create failed`);
      const lm = { delegate, closed: false, failDetect: mp.failDetect.has(delegate) };
      mp.created.push(lm);
      return {
        detectForVideo: () => {
          if (lm.failDetect) throw new Error(`${delegate} inference failed`);
          return { landmarks: [] };
        },
        close: () => (lm.closed = true),
      };
    },
  },
}));

const options = { model: "lite", wasmBase: "/w", modelBase: "/m" } as const;

describe("PoseRunner.init (ADR-0010 §4–5)", () => {
  beforeEach(() => {
    mp.created = [];
    mp.failCreate.clear();
    mp.failDetect.clear();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return null;
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses GPU when it creates and warms up", async () => {
    expect(await new PoseRunner().init({ ...options, delegate: "GPU" })).toBe("GPU");
  });

  it("falls back to CPU when GPU creation fails", async () => {
    mp.failCreate.add("GPU");
    expect(await new PoseRunner().init({ ...options, delegate: "GPU" })).toBe("CPU");
  });

  it("falls back to CPU, closing the GPU task, when the GPU warm-up inference fails", async () => {
    mp.failDetect.add("GPU");
    expect(await new PoseRunner().init({ ...options, delegate: "GPU" })).toBe("CPU");
    expect(mp.created.map((c) => [c.delegate, c.closed])).toEqual([
      ["GPU", true],
      ["CPU", false],
    ]);
  });

  it("surfaces a CPU failure (nothing left to fall back to)", async () => {
    mp.failCreate.add("CPU");
    await expect(new PoseRunner().init({ ...options, delegate: "CPU" })).rejects.toThrow(
      "CPU create failed",
    );
  });

  it("auto picks CPU without hardware WebGL2", async () => {
    expect(await new PoseRunner().init({ ...options, delegate: "auto" })).toBe("CPU");
    expect(mp.created.map((c) => c.delegate)).toEqual(["CPU"]);
  });
});
