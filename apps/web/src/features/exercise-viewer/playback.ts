import type { AnimationPhase } from "@fitpilot/exercise-contracts";

/**
 * Exercise-demo playback (FR-03: play, pause, replay, reset). Pure state so it is tested without
 * WebGL; the 3D layer only reads `time` and the controls only dispatch actions.
 */
export type PlaybackState =
  | { status: "loading" | "ready" | "playing" | "paused" | "ended"; time: number; duration: number }
  | { status: "error"; time: number; duration: number; reason: ViewerFailure };

export type ViewerFailure = "missing" | "corrupt" | "incompatible" | "webgl" | "render";

export type PlaybackAction =
  | { type: "loaded"; autoplay: boolean; reducedMotion: boolean }
  | { type: "failed"; reason: ViewerFailure }
  | { type: "play" | "pause" | "toggle" | "replay" | "reset" | "retry" }
  | { type: "seek"; time: number }
  | { type: "seekBy"; delta: number }
  | { type: "tick"; dt: number };

export const initialPlayback = (duration: number): PlaybackState => ({
  status: "loading",
  time: 0,
  duration,
});

const clamp = (t: number, duration: number) => Math.min(Math.max(t, 0), duration);

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  const { duration } = state;
  if (action.type === "failed")
    return { status: "error", time: 0, duration, reason: action.reason };
  if (state.status === "error") return action.type === "retry" ? initialPlayback(duration) : state;
  if (state.status === "loading") {
    if (action.type !== "loaded") return state;
    const autoplay = action.autoplay && !action.reducedMotion;
    return { status: autoplay ? "playing" : "ready", time: 0, duration };
  }

  switch (action.type) {
    case "loaded":
    case "retry":
      return state;
    case "play":
      if (state.status === "playing") return state;
      return { status: "playing", time: state.status === "ended" ? 0 : state.time, duration };
    case "pause":
      return state.status === "playing" ? { ...state, status: "paused" } : state;
    case "toggle":
      return playbackReducer(state, { type: state.status === "playing" ? "pause" : "play" });
    case "replay":
      return { status: "playing", time: 0, duration };
    case "reset":
      return { status: "paused", time: 0, duration };
    case "seek":
    case "seekBy": {
      const time = clamp(
        action.type === "seek" ? action.time : state.time + action.delta,
        duration,
      );
      const status = state.status === "ended" ? "paused" : state.status;
      return time === state.time && status === state.status ? state : { status, time, duration };
    }
    case "tick": {
      if (state.status !== "playing" || action.dt <= 0) return state;
      const time = state.time + action.dt;
      return time >= duration
        ? { status: "ended", time: duration, duration }
        : { status: "playing", time, duration };
    }
  }
}

/** The span playing at time t; the end of the clip belongs to the last span. */
export function phaseAt(
  timeline: readonly AnimationPhase[],
  t: number,
): { index: number; span: AnimationPhase } {
  const found = timeline.findIndex((s) => t >= s.start_s && t < s.end_s);
  const index = found === -1 ? (t < 0 ? 0 : timeline.length - 1) : found;
  return { index, span: timeline[index]! };
}

/**
 * Keyboard shortcuts for the viewer region (NFR-Accessibility). Chords with Ctrl/Cmd/Alt belong
 * to the browser (reload, history), so they are never captured.
 */
export function keyToAction(
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
): PlaybackAction | null {
  if (modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey) return null;
  switch (key.length === 1 ? key.toLowerCase() : key) {
    case " ":
    case "k":
      return { type: "toggle" };
    case "r":
      return { type: "replay" };
    case "Home":
      return { type: "reset" };
    case "ArrowLeft":
      return { type: "seekBy", delta: -0.5 };
    case "ArrowRight":
      return { type: "seekBy", delta: 0.5 };
    default:
      return null;
  }
}

/** The canvas renders continuously only while playing on screen; paused it renders on demand. */
export function frameloopFor(onScreen: boolean, playing: boolean): "always" | "demand" | "never" {
  if (!onScreen) return "never";
  return playing ? "always" : "demand";
}

export interface PlaybackStore {
  getState(): PlaybackState;
  dispatch(action: PlaybackAction): void;
  subscribe(listener: () => void): () => void;
}

/** Minimal external store so the render loop can read time without re-rendering React. */
export function createPlaybackStore(duration: number): PlaybackStore {
  let state = initialPlayback(duration);
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = playbackReducer(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Snapshot getter for React UI: returns the same object until the status or the 0.1 s time step
 * changes, so controls re-render ~10×/s while playing instead of every frame.
 */
export function coarseSnapshot(store: PlaybackStore): () => PlaybackState {
  let key = "";
  let snapshot = store.getState();
  return () => {
    const state = store.getState();
    const next = `${state.status}|${Math.round(state.time * 10)}`;
    if (next !== key) {
      key = next;
      snapshot = state;
    }
    return snapshot;
  };
}
