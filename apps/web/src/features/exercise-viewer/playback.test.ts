import type { AnimationPhase } from "@fitpilot/exercise-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createPlaybackStore,
  initialPlayback,
  keyToAction,
  phaseAt,
  playbackReducer,
  type PlaybackAction,
  type PlaybackState,
} from "./playback";

const timeline: AnimationPhase[] = [
  { phase: "standing", start_s: 0, end_s: 0.5, instruction_indices: [0] },
  { phase: "descending", start_s: 0.5, end_s: 2, instruction_indices: [1] },
  { phase: "bottom", start_s: 2, end_s: 2.4, instruction_indices: [2] },
  { phase: "ascending", start_s: 2.4, end_s: 3.6, instruction_indices: [3] },
  { phase: "standing", start_s: 3.6, end_s: 4, instruction_indices: [0] },
];

const run = (actions: PlaybackAction[], state: PlaybackState = initialPlayback(4)) =>
  actions.reduce(playbackReducer, state);
const ready = (opts: { autoplay?: boolean; reducedMotion?: boolean } = {}) =>
  run([{ type: "loaded", autoplay: false, reducedMotion: false, ...opts }]);

describe("playbackReducer (FR-03 controls)", () => {
  it("starts loading at time 0", () => {
    expect(initialPlayback(4)).toEqual({ status: "loading", time: 0, duration: 4 });
  });

  it("becomes ready, or plays when autoplay is on", () => {
    expect(ready().status).toBe("ready");
    expect(ready({ autoplay: true }).status).toBe("playing");
  });

  it("never autoplays when the user prefers reduced motion", () => {
    expect(ready({ autoplay: true, reducedMotion: true }).status).toBe("ready");
  });

  it("plays, pauses and holds time while paused", () => {
    const paused = run([{ type: "play" }, { type: "tick", dt: 1.2 }, { type: "pause" }], ready());
    expect(paused).toMatchObject({ status: "paused", time: 1.2 });
    expect(run([{ type: "tick", dt: 1 }], paused).time).toBe(1.2);
  });

  it("toggles between playing and paused", () => {
    const playing = run([{ type: "toggle" }], ready());
    expect(playing.status).toBe("playing");
    expect(run([{ type: "toggle" }], playing).status).toBe("paused");
  });

  it("ignores ticks unless playing", () => {
    expect(run([{ type: "tick", dt: 1 }], ready()).time).toBe(0);
  });

  it("ends at the clip duration instead of overshooting", () => {
    const ended = run(
      [{ type: "play" }, { type: "tick", dt: 3 }, { type: "tick", dt: 3 }],
      ready(),
    );
    expect(ended).toMatchObject({ status: "ended", time: 4 });
  });

  it("restarts from 0 when play is pressed after the end", () => {
    const ended = run([{ type: "play" }, { type: "tick", dt: 5 }], ready());
    expect(run([{ type: "play" }], ended)).toMatchObject({ status: "playing", time: 0 });
  });

  it.each<PlaybackAction[]>([
    [],
    [{ type: "play" }, { type: "tick", dt: 1.5 }],
    [{ type: "play" }, { type: "tick", dt: 1.5 }, { type: "pause" }],
    [{ type: "play" }, { type: "tick", dt: 9 }],
  ])("replay restarts at 0 and plays from any state (%#)", (...before) => {
    expect(run([...before, { type: "replay" }], ready())).toMatchObject({
      status: "playing",
      time: 0,
    });
  });

  it("reset returns to 0, paused", () => {
    const reset = run([{ type: "play" }, { type: "tick", dt: 2 }, { type: "reset" }], ready());
    expect(reset).toMatchObject({ status: "paused", time: 0 });
  });

  it("seeks within the clip and clamps out-of-range times", () => {
    const base = run([{ type: "play" }], ready());
    expect(run([{ type: "seek", time: 2.2 }], base)).toMatchObject({
      status: "playing",
      time: 2.2,
    });
    expect(run([{ type: "seek", time: -1 }], base).time).toBe(0);
    expect(run([{ type: "seek", time: 99 }], base).time).toBe(4);
    expect(
      run(
        [
          { type: "seekBy", delta: -0.5 },
          { type: "seekBy", delta: 1 },
        ],
        base,
      ).time,
    ).toBe(1);
  });

  it("seeking back from the end leaves the ended state", () => {
    const ended = run([{ type: "play" }, { type: "tick", dt: 9 }], ready());
    expect(run([{ type: "seek", time: 1 }], ended).status).toBe("paused");
  });

  it("ignores controls while loading or failed, and records the failure", () => {
    expect(run([{ type: "play" }]).status).toBe("loading");
    const failed = run([{ type: "failed", reason: "missing" }]);
    expect(failed).toMatchObject({ status: "error", reason: "missing" });
    expect(run([{ type: "replay" }, { type: "seek", time: 2 }], failed)).toEqual(failed);
  });
});

describe("retry", () => {
  it("returns a failed viewer to loading, and does nothing otherwise", () => {
    const failed = run([{ type: "failed", reason: "missing" }]);
    expect(run([{ type: "retry" }], failed)).toEqual(initialPlayback(4));
    const playing = run([{ type: "play" }], ready());
    expect(run([{ type: "retry" }], playing)).toBe(playing);
  });
});

describe("phaseAt", () => {
  it.each([
    [0, 0, "standing"],
    [0.49, 0, "standing"],
    [0.5, 1, "descending"],
    [2, 2, "bottom"],
    [3.59, 3, "ascending"],
    [3.6, 4, "standing"],
    [4, 4, "standing"],
  ])("t=%s → phase #%s (%s)", (t, index, phase) => {
    expect(phaseAt(timeline, t)).toMatchObject({ index, span: { phase } });
  });
});

describe("keyToAction", () => {
  it.each<[string, PlaybackAction | null]>([
    [" ", { type: "toggle" }],
    ["k", { type: "toggle" }],
    ["r", { type: "replay" }],
    ["Home", { type: "reset" }],
    ["ArrowLeft", { type: "seekBy", delta: -0.5 }],
    ["ArrowRight", { type: "seekBy", delta: 0.5 }],
    ["Enter", null],
  ])("%j → %j", (key, action) => {
    expect(keyToAction(key)).toEqual(action);
  });
});

describe("createPlaybackStore", () => {
  it("notifies subscribers on change and stops after unsubscribe", () => {
    const store = createPlaybackStore(4);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.dispatch({ type: "loaded", autoplay: false, reducedMotion: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe("ready");
    unsubscribe();
    store.dispatch({ type: "play" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify when an action changes nothing", () => {
    const store = createPlaybackStore(4);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: "tick", dt: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});
