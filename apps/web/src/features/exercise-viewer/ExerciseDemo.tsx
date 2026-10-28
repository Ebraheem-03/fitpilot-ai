"use client";
import type { ExerciseContract } from "@fitpilot/exercise-contracts";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { assetUrl, ViewerError } from "./compat";
import { announcement, FAILURE_MESSAGES, phaseLabel, VIEW_LABELS, type ViewPreset } from "./labels";
import { LazyScene } from "./LazyScene";
import type { ExerciseModel } from "./model";
import {
  coarseSnapshot,
  createPlaybackStore,
  keyToAction,
  phaseAt,
  type PlaybackState,
} from "./playback";
import { ViewerErrorBoundary } from "./ViewerErrorBoundary";
import { hasWebGL } from "./webgl";

export type DemoExercise = Pick<
  ExerciseContract,
  "id" | "name" | "animation" | "phases" | "instructions"
>;

/** How long the 3D part may stay in "loading" before we show the fallback. */
export const LOAD_TIMEOUT_MS = 15_000;
/** Failures where trying again can help (network, a transient render crash). */
const RETRYABLE = new Set(["missing", "render"]);

const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Stops rendering while the viewer is scrolled out of view. */
function useOnScreen(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry!.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}

/**
 * 3D demonstration + controls + phase-synced written steps (FR-03). The written steps render on
 * the server and stay usable whatever happens to the 3D part: loading, failure or no WebGL.
 */
export function ExerciseDemo({ exercise }: { exercise: DemoExercise }) {
  const { animation } = exercise;
  const [{ store, snapshot }] = useState(() => {
    const store = createPlaybackStore(animation.duration_s);
    return { store, snapshot: coarseSnapshot(store) };
  });
  const state = useSyncExternalStore(store.subscribe, snapshot, snapshot);
  const [model, setModel] = useState<ExerciseModel | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<ViewPreset>("three_quarter");
  const viewport = useRef<HTMLDivElement>(null);
  const active = useOnScreen(viewport);
  const shortcutsId = useId();

  useEffect(() => {
    if (!hasWebGL()) {
      store.dispatch({ type: "failed", reason: "webgl" });
      return;
    }
    const controller = new AbortController();
    // Never leave the user on "Loading…" forever (slow network, scene that never mounts).
    const watchdog = setTimeout(() => {
      if (store.getState().status !== "loading") return;
      controller.abort();
      store.dispatch({ type: "failed", reason: "missing" });
    }, LOAD_TIMEOUT_MS);
    import("./model")
      .then(({ loadExerciseModel }) =>
        loadExerciseModel(assetUrl(exercise.id, animation), animation, controller.signal),
      )
      .then(
        (loaded) => {
          if (!controller.signal.aborted) setModel(loaded);
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          console.warn("exercise viewer:", error instanceof Error ? error.message : error);
          const reason = error instanceof ViewerError ? error.reason : "missing";
          store.dispatch({ type: "failed", reason });
        },
      );
    return () => {
      clearTimeout(watchdog);
      controller.abort();
    };
  }, [store, exercise.id, animation, attempt]);

  const onReady = useCallback(
    () => store.dispatch({ type: "loaded", autoplay: true, reducedMotion: prefersReducedMotion() }),
    [store],
  );
  const onSceneError = useCallback(
    (error: Error) => {
      console.warn("exercise viewer:", error.message);
      store.dispatch({ type: "failed", reason: "render" });
    },
    [store],
  );
  const retry = () => {
    setModel(null);
    store.dispatch({ type: "retry" });
    setAttempt((n) => n + 1);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return; // buttons and the slider handle their own keys
    const action = keyToAction(event.key, event);
    if (!action) return;
    event.preventDefault();
    store.dispatch(action);
  };

  const { span } = phaseAt(animation.phases, state.time);
  const usable = state.status !== "loading" && state.status !== "error";

  return (
    <section
      aria-label={`${exercise.name} demonstration`}
      className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
    >
      <div className="flex flex-col gap-3">
        <div
          ref={viewport}
          role="region"
          aria-label={`3D mannequin demonstrating ${exercise.name}`}
          aria-describedby={shortcutsId}
          tabIndex={usable ? 0 : -1}
          onKeyDown={onKeyDown}
          data-testid="exercise-viewer"
          data-status={state.status}
          className="relative aspect-square w-full overflow-hidden rounded-xl border border-border bg-surface"
        >
          {state.status === "error" ? (
            <ViewerFallback state={state} onRetry={retry} />
          ) : (
            <>
              {model && (
                <ViewerErrorBoundary key={attempt} onError={onSceneError}>
                  <LazyScene
                    model={model}
                    store={store}
                    view={view}
                    active={active}
                    onReady={onReady}
                  />
                </ViewerErrorBoundary>
              )}
              {state.status === "loading" && (
                <p className="absolute inset-0 grid place-items-center text-muted">
                  Loading 3D demonstration…
                </p>
              )}
            </>
          )}
        </div>
        <p id={shortcutsId} className="sr-only">
          Keyboard: Space to play or pause, R to replay, Home to reset, arrow keys to step.
        </p>
        <ViewerControls
          state={state}
          phase={span.phase}
          disabled={!usable}
          view={view}
          onView={setView}
          dispatch={store.dispatch}
        />
        <p aria-live="polite" className="sr-only" data-testid="viewer-announcement">
          {announcement(state, span.phase)}
        </p>
      </div>
      <PhaseSteps exercise={exercise} activePhase={usable ? span : null} />
    </section>
  );
}

function ViewerFallback({
  state,
  onRetry,
}: {
  state: Extract<PlaybackState, { status: "error" }>;
  onRetry: () => void;
}) {
  return (
    <div
      data-testid="viewer-fallback"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <p className="font-medium">{FAILURE_MESSAGES[state.reason]}</p>
      <p className="text-muted">Follow the written steps instead.</p>
      {RETRYABLE.has(state.reason) && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border px-3 py-1.5 hover:bg-background"
        >
          Try again
        </button>
      )}
    </div>
  );
}

function ViewerControls({
  state,
  phase,
  disabled,
  view,
  onView,
  dispatch,
}: {
  state: PlaybackState;
  phase: string;
  disabled: boolean;
  view: ViewPreset;
  onView: (view: ViewPreset) => void;
  dispatch: ReturnType<typeof createPlaybackStore>["dispatch"];
}) {
  const button =
    "rounded-md border border-border px-3 py-1.5 font-medium hover:bg-surface disabled:opacity-50 disabled:hover:bg-transparent";
  const playing = state.status === "playing";
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Playback" className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => dispatch({ type: playing ? "pause" : "play" })}
          className={`${button} min-w-20 bg-brand text-brand-foreground hover:bg-brand-hover disabled:hover:bg-brand`}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => dispatch({ type: "replay" })}
          className={button}
        >
          Replay
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => dispatch({ type: "reset" })}
          className={button}
        >
          Reset
        </button>
        <p className="ml-auto text-sm text-muted tabular-nums" data-testid="viewer-phase">
          {disabled
            ? ""
            : `${phaseLabel(phase)} · ${state.time.toFixed(1)} / ${state.duration.toFixed(1)} s`}
        </p>
      </div>
      <input
        type="range"
        aria-label="Position in demonstration"
        // While playing, only the phase changes the text, so screen readers aren't flooded.
        aria-valuetext={
          playing
            ? `Playing, ${phaseLabel(phase)} phase`
            : `${state.time.toFixed(1)} of ${state.duration.toFixed(1)} seconds, ${phaseLabel(phase)} phase`
        }
        min={0}
        max={state.duration}
        step={0.05}
        value={state.time}
        disabled={disabled}
        onChange={(e) => dispatch({ type: "seek", time: Number(e.target.value) })}
        className="w-full accent-brand"
      />
      <div role="group" aria-label="Camera view" className="flex flex-wrap gap-2">
        {(Object.keys(VIEW_LABELS) as ViewPreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={view === preset}
            disabled={disabled}
            onClick={() => onView(preset)}
            className={`${button} text-sm aria-pressed:border-brand aria-pressed:text-brand`}
          >
            {VIEW_LABELS[preset]}
          </button>
        ))}
      </div>
    </div>
  );
}

function PhaseSteps({
  exercise,
  activePhase,
}: {
  exercise: DemoExercise;
  activePhase: DemoExercise["animation"]["phases"][number] | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Phases</h2>
        <ol className="mt-2 flex flex-wrap gap-2">
          {exercise.phases.map((phase) => {
            const current = activePhase?.phase === phase;
            return (
              <li
                key={phase}
                aria-current={current ? "step" : undefined}
                className="rounded-full border border-border px-3 py-1 text-sm aria-[current=step]:border-brand aria-[current=step]:font-semibold aria-[current=step]:text-brand"
              >
                {phaseLabel(phase)}
              </li>
            );
          })}
        </ol>
      </div>
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">How to do it</h2>
        <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5">
          {exercise.instructions.map((text, i) => {
            const current = activePhase?.instruction_indices.includes(i) ?? false;
            return (
              <li
                key={i}
                aria-current={current ? "step" : undefined}
                className="rounded-md px-2 py-1 aria-[current=step]:bg-surface aria-[current=step]:font-medium"
              >
                {text}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
