/**
 * Live camera session (FR-04): explicit start → permission → model warm-up → running ⇄ paused →
 * stopped, with every failure named so the UI can explain it (principle 3). Pure, like the M1
 * playback machine; the engine performs the side effects.
 */
export type SessionFailure =
  | "denied"
  | "unsupported"
  | "no_camera"
  | "camera_busy"
  | "camera_lost"
  | "model_failed"
  | "worker_crashed";

export type SessionState =
  | { status: "idle" | "requesting" | "stopped" }
  | { status: "loading" | "running" | "paused"; restarts: number }
  | { status: "error"; reason: SessionFailure; retryable: boolean };

export type SessionAction =
  | { type: "start" | "retry" | "stop" | "pause" | "resume" }
  | { type: "granted" | "modelReady" | "modelFailed" | "trackEnded" | "workerCrashed" }
  | { type: "cameraFailed"; reason: SessionFailure };

export const initialSession: SessionState = { status: "idle" };

/** Crashed workers are restarted this many times before the session gives up. */
export const MAX_WORKER_RESTARTS = 1;

const fail = (reason: SessionFailure): SessionState => ({
  status: "error",
  reason,
  retryable: reason !== "unsupported",
});

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (state.status) {
    case "idle":
    case "stopped":
      return action.type === "start" ? { status: "requesting" } : state;
    case "error":
      return (action.type === "retry" || action.type === "start") && state.retryable
        ? { status: "requesting" }
        : state;
    case "requesting":
      if (action.type === "granted") return { status: "loading", restarts: 0 };
      if (action.type === "cameraFailed") return fail(action.reason);
      if (action.type === "stop") return { status: "stopped" };
      return state;
  }

  // loading | running | paused: camera is live
  switch (action.type) {
    case "stop":
      return { status: "stopped" };
    case "trackEnded":
      return fail("camera_lost");
    case "workerCrashed":
      return state.restarts < MAX_WORKER_RESTARTS
        ? { status: "loading", restarts: state.restarts + 1 }
        : fail("worker_crashed");
    case "modelReady":
      return state.status === "loading" ? { ...state, status: "running" } : state;
    case "modelFailed":
      return state.status === "loading" ? fail("model_failed") : state;
    case "pause":
      return state.status === "running" ? { ...state, status: "paused" } : state;
    case "resume":
      return state.status === "paused" ? { ...state, status: "running" } : state;
    default:
      return state;
  }
}

/** getUserMedia rejections → the reason we show (names per the Media Capture spec). */
export function classifyCameraError(error: unknown): SessionFailure {
  if (error instanceof TypeError) return "unsupported"; // no mediaDevices / insecure context
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no_camera";
  return "camera_busy"; // NotReadableError, AbortError, anything unexpected
}
