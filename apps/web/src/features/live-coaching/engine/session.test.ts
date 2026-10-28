import { describe, expect, it } from "vitest";
import {
  classifyCameraError,
  initialSession,
  type SessionAction,
  sessionReducer,
  type SessionState,
} from "./session";

const run = (...actions: SessionAction[]) =>
  actions.reduce<SessionState>(sessionReducer, initialSession);
const toRunning: SessionAction[] = [{ type: "start" }, { type: "granted" }, { type: "modelReady" }];

describe("live session state machine (FR-04)", () => {
  it("asks for the camera only after an explicit start", () => {
    expect(initialSession.status).toBe("idle");
    expect(run({ type: "start" }).status).toBe("requesting");
  });

  it("goes requesting → loading (model warm-up) → running", () => {
    expect(run({ type: "start" }, { type: "granted" }).status).toBe("loading");
    expect(run(...toRunning).status).toBe("running");
  });

  it("pauses and resumes processing", () => {
    expect(run(...toRunning, { type: "pause" }).status).toBe("paused");
    expect(run(...toRunning, { type: "pause" }, { type: "resume" }).status).toBe("running");
  });

  it.each(["requesting", "loading", "running", "paused"] as const)("can stop from %s", (s) => {
    const path: Record<typeof s, SessionAction[]> = {
      requesting: [{ type: "start" }],
      loading: [{ type: "start" }, { type: "granted" }],
      running: toRunning,
      paused: [...toRunning, { type: "pause" }],
    };
    expect(run(...path[s], { type: "stop" }).status).toBe("stopped");
  });

  it("can start again after stopping", () => {
    expect(run(...toRunning, { type: "stop" }, { type: "start" }).status).toBe("requesting");
  });

  it("reports a camera failure and allows retry when it's recoverable", () => {
    const denied = run({ type: "start" }, { type: "cameraFailed", reason: "denied" });
    expect(denied).toEqual({ status: "error", reason: "denied", retryable: true });
    expect(sessionReducer(denied, { type: "retry" }).status).toBe("requesting");
  });

  it("does not offer retry on an unsupported browser", () => {
    const s = run({ type: "start" }, { type: "cameraFailed", reason: "unsupported" });
    expect(s).toMatchObject({ status: "error", retryable: false });
    expect(sessionReducer(s, { type: "retry" })).toBe(s);
  });

  it("fails clearly when the model can't load", () => {
    expect(run({ type: "start" }, { type: "granted" }, { type: "modelFailed" })).toMatchObject({
      status: "error",
      reason: "model_failed",
      retryable: true,
    });
  });

  it("treats a camera that disappears mid-session as an error, not as 'no person'", () => {
    expect(run(...toRunning, { type: "trackEnded" })).toMatchObject({ reason: "camera_lost" });
  });

  it("restarts a crashed worker once, then gives up", () => {
    const once = run(...toRunning, { type: "workerCrashed" });
    expect(once).toMatchObject({ status: "loading", restarts: 1 });
    const again = [once, { type: "modelReady" }, { type: "workerCrashed" }] as const;
    const s = sessionReducer(sessionReducer(again[0], again[1]), again[2]);
    expect(s).toMatchObject({ status: "error", reason: "worker_crashed" });
  });

  it("ignores actions that don't apply in the current state", () => {
    const idle = initialSession;
    expect(sessionReducer(idle, { type: "pause" })).toBe(idle);
    expect(sessionReducer(idle, { type: "modelReady" })).toBe(idle);
    const running = run(...toRunning);
    expect(sessionReducer(running, { type: "granted" })).toBe(running);
  });
});

describe("classifyCameraError", () => {
  const dom = (name: string) => new DOMException("x", name);
  it.each([
    [dom("NotAllowedError"), "denied"],
    [dom("SecurityError"), "denied"],
    [dom("NotFoundError"), "no_camera"],
    [dom("OverconstrainedError"), "no_camera"],
    [dom("NotReadableError"), "camera_busy"],
    [dom("AbortError"), "camera_busy"],
    [new TypeError("navigator.mediaDevices is undefined"), "unsupported"],
    [new Error("???"), "camera_busy"],
  ])("%s → %s", (error, reason) => expect(classifyCameraError(error)).toBe(reason));
});
