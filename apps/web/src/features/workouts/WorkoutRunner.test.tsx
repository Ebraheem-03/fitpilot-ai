// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetSummary } from "../live-coaching/recording/summary";
import { progressKey } from "./progress";
import type { RunnerExercise } from "./WorkoutRunner";

const SESSION = "0b0f7a3e-4b1c-4a55-9d63-8f0c8d1c2a11";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const outbox = {
  enqueue: vi.fn(async (...events: unknown[][]) => void events),
  flush: vi.fn(async () => "sent" as string),
  pendingCount: vi.fn(async () => 0),
};
const outboxUsers = new Set<string>();
vi.mock("./outbox/browser", () => ({
  getOutbox: (userId: string) => {
    outboxUsers.add(userId);
    return outbox;
  },
}));

const completeSession = vi.fn();
vi.mock("./actions", () => ({
  completeSession: (...args: unknown[]) => completeSession(...args),
}));

// The camera and the pose model are not under test here, only how the runner uses LiveCoach.
interface StubProps {
  userId?: string;
  sessionId?: string;
  setIndex?: number;
  targetReps?: number;
  singleSet?: boolean;
  trackingConsent?: boolean;
  consentDeclined?: boolean;
  onConsentChange?: (granted: boolean) => void;
  onSetComplete?: (summary: SetSummary, events: readonly never[]) => void;
}
const liveProps: StubProps[] = [];
vi.mock("./LiveSessionCoach", () => ({
  LiveSessionCoach: (props: StubProps) => {
    liveProps.push(props);
    const summary = (reps: number): SetSummary => ({
      exercise_id: "bodyweight_squat",
      set_index: props.setIndex ?? 0,
      reps,
      completed: true,
      cues: [],
      tracking_degraded: [],
      degraded_ms: 0,
    });
    return (
      <div
        data-testid="live-coach-stub"
        data-session-id={props.sessionId}
        data-user-id={props.userId}
        data-set-index={props.setIndex}
        data-target-reps={props.targetReps}
        data-single-set={String(props.singleSet)}
      >
        <button onClick={() => props.onConsentChange?.(false)}>stub: decline</button>
        <button onClick={() => props.onSetComplete?.(summary(8), [])}>stub: finish set</button>
      </div>
    );
  },
}));

const { WorkoutRunner } = await import("./WorkoutRunner");

const squat: RunnerExercise = {
  id: "bodyweight_squat",
  name: "Bodyweight Squat",
  hasDemo: true,
  tracked: true,
  prescription: "reps",
  instructions: ["Stand tall.", "Sit back and down."],
  required_landmarks: ["left_hip", "left_knee", "left_ankle"],
  planned: {
    exercise_id: "bodyweight_squat",
    sets: 2,
    reps: 10,
    duration_s: null,
    rest_s: 45,
    progression: "Add a rep.",
  },
};
const plank: RunnerExercise = {
  id: "plank",
  name: "Plank",
  hasDemo: false,
  tracked: false,
  prescription: "duration",
  instructions: ["Hold a straight line."],
  required_landmarks: [],
  planned: {
    exercise_id: "plank",
    sets: 1,
    reps: null,
    duration_s: 30,
    rest_s: 30,
    progression: "Add 5 s.",
  },
};
const bridge: RunnerExercise = {
  id: "glute_bridge",
  name: "Glute Bridge",
  hasDemo: false,
  tracked: false,
  prescription: "reps",
  instructions: ["Lift your hips."],
  required_landmarks: [],
  planned: {
    exercise_id: "glute_bridge",
    sets: 1,
    reps: 12,
    duration_s: null,
    rest_s: 30,
    progression: "Pause at the top.",
  },
};

// Newer Node versions define a throwing `localStorage` global that hides jsdom's: use our own.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
  clear = () => this.data.clear();
}
const storage = new MemoryStorage();
vi.stubGlobal("localStorage", storage);

const user = userEvent.setup();
const enqueued = () => outbox.enqueue.mock.calls.flatMap((c) => c[0] as Record<string, unknown>[]);
const runner = () => screen.getByTestId("workout-runner");

function renderRunner(exercises = [plank, bridge], consent = false) {
  return render(
    <WorkoutRunner
      userId="user-1"
      sessionId={SESSION}
      exercises={exercises}
      trackingConsent={consent}
    />,
  );
}

beforeEach(() => {
  storage.clear();
  liveProps.length = 0;
  outboxUsers.clear();
  push.mockReset();
  completeSession.mockReset();
  outbox.enqueue.mockClear();
  outbox.flush.mockReset().mockResolvedValue("sent");
  outbox.pendingCount.mockReset().mockResolvedValue(0);
});
afterEach(cleanup);

describe("WorkoutRunner: by-hand sets", () => {
  it("shows the current exercise: set x of y, target, rest, instructions and the demo link", async () => {
    renderRunner([squat, plank]);
    await screen.findByTestId("current-step");
    // a tracked exercise goes to the camera first, so use the by-hand view for this check
    await user.click(screen.getByRole("button", { name: "Log this set by hand instead" }));
    expect(screen.getByTestId("runner-set-progress").textContent).toBe("Set 1 of 2 · 10 reps");
    expect(screen.getByText("Rest 45 s between sets")).toBeTruthy();
    expect(screen.getByText("Sit back and down.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Watch the 3D demo/ }).getAttribute("href")).toBe(
      "/app/exercises/bodyweight_squat",
    );
    expect(runner().getAttribute("data-current-exercise")).toBe("bodyweight_squat");
    expect(runner().getAttribute("data-set-number")).toBe("1");
  });

  it("labels each exercise as camera-tracked or logged by hand", async () => {
    renderRunner([squat, plank]);
    const items = await screen.findAllByTestId("runner-exercise");
    expect(items[0]!.textContent).toContain("Camera-tracked");
    expect(items[1]!.textContent).toContain("Logged by hand");
    expect(items[0]!.getAttribute("aria-current")).toBe("step");
  });

  it("logs a timed set as duration_s, with rating and note, and moves on to the next exercise", async () => {
    renderRunner([plank, bridge]);
    await screen.findByTestId("current-step");
    expect(screen.getByLabelText("Seconds held")).toBeTruthy();
    await user.clear(screen.getByLabelText("Seconds held"));
    await user.type(screen.getByLabelText("Seconds held"), "42");
    await user.selectOptions(screen.getByLabelText(/How hard was it\? \(optional\)/), "8");
    await user.type(screen.getByLabelText("Note (optional)"), "shaky at the end");
    await user.click(screen.getByRole("button", { name: "Save set" }));

    await waitFor(() =>
      expect(runner().getAttribute("data-current-exercise")).toBe("glute_bridge"),
    );
    expect(enqueued()).toHaveLength(1);
    expect(enqueued()[0]).toMatchObject({
      type: "set_logged",
      session_id: SESSION,
      exercise_id: "plank",
      set_index: 0,
      duration_s: 42,
      perceived_difficulty: 8,
      note: "shaky at the end",
    });
    expect(enqueued()[0]).not.toHaveProperty("reps");
    expect(outbox.flush).toHaveBeenCalledWith(SESSION); // sent as the set ends, not only at the end
    // the last (only) set of an exercise is not followed by a rest
    expect(screen.queryByTestId("rest-timer")).toBeNull();
  });

  it("rests between the sets of one exercise, and the rest can be skipped", async () => {
    const twoSets: RunnerExercise = { ...bridge, planned: { ...bridge.planned, sets: 2 } };
    renderRunner([twoSets]);
    await screen.findByTestId("current-step");
    await user.click(screen.getByRole("button", { name: "Save set" }));
    const timer = await screen.findByTestId("rest-timer");
    expect(within(timer).getByRole("timer").textContent).toBe("0:30");
    expect(timer.textContent).toContain("Next: Glute Bridge, set 2 of 2");
    expect(runner().getAttribute("data-phase")).toBe("rest");

    await user.click(screen.getByRole("button", { name: "Skip rest" }));
    await waitFor(() => expect(runner().getAttribute("data-set-number")).toBe("2"));
    expect(runner().getAttribute("data-phase")).toBe("set");
    await user.click(screen.getByRole("button", { name: "Save set" }));
    expect(enqueued().map((e) => e.set_index)).toEqual([0, 1]);
    // all sets done: straight to finishing
    expect(await screen.findByTestId("finish-panel")).toBeTruthy();
  });

  it("needs a positive whole number of reps before it saves", async () => {
    renderRunner([bridge]);
    await screen.findByTestId("current-step");
    await user.clear(screen.getByLabelText("Reps completed"));
    expect((screen.getByRole("button", { name: "Save set" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.type(screen.getByLabelText("Reps completed"), "0");
    expect((screen.getByRole("button", { name: "Save set" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(enqueued()).toHaveLength(0);
  });

  it("skips an exercise with an optional reason and counts it as skipped", async () => {
    renderRunner([plank, bridge]);
    await screen.findByTestId("current-step");
    await user.selectOptions(screen.getByLabelText("Why skip it? (optional)"), "discomfort");
    await user.click(screen.getByRole("button", { name: "Skip exercise" }));
    await waitFor(() =>
      expect(runner().getAttribute("data-current-exercise")).toBe("glute_bridge"),
    );
    expect(enqueued()).toHaveLength(1);
    expect(enqueued()[0]).toMatchObject({
      type: "exercise_skipped",
      exercise_id: "plank",
      reason: "discomfort",
    });
    expect(screen.getByTestId("workout-progress").textContent).toContain("1 skipped");
    expect(
      screen.getAllByTestId("runner-exercise").map((li) => li.getAttribute("data-state")),
    ).toEqual(["skipped", "todo"]);
  });

  it("skips without a reason", async () => {
    renderRunner([plank]);
    await screen.findByTestId("current-step");
    await user.click(screen.getByRole("button", { name: "Skip exercise" }));
    await screen.findByTestId("finish-panel");
    expect(enqueued()[0]).not.toHaveProperty("reason");
  });

  it("shows the problem and keeps the set when the device can't store it", async () => {
    outbox.enqueue.mockRejectedValueOnce(new Error("quota"));
    renderRunner([bridge]);
    await screen.findByTestId("current-step");
    await user.click(screen.getByRole("button", { name: "Save set" }));
    expect((await screen.findByRole("alert")).textContent).toContain("couldn't save this set");
    expect(runner().getAttribute("data-current-exercise")).toBe("glute_bridge");
    await user.click(screen.getByRole("button", { name: "Save set" }));
    await screen.findByTestId("finish-panel");
  });

  it("says when sets are still waiting to be sent", async () => {
    outbox.pendingCount.mockResolvedValue(2);
    renderRunner([bridge]);
    await waitFor(() =>
      expect(screen.getByTestId("save-status").textContent).toContain("2 items are waiting"),
    );
  });
});

describe("WorkoutRunner: resuming", () => {
  it("picks up from the progress kept on this device", async () => {
    storage.setItem(
      progressKey("user-1", SESSION),
      JSON.stringify({
        exercises: {
          plank: {
            sets: [{ set_index: 0, source: "manual", reps: null, duration_s: 30 }],
            skipped: false,
          },
        },
      }),
    );
    renderRunner([plank, bridge]);
    await waitFor(() =>
      expect(runner().getAttribute("data-current-exercise")).toBe("glute_bridge"),
    );
    expect(
      screen.getAllByTestId("runner-exercise").map((li) => li.getAttribute("data-state")),
    ).toEqual(["done", "todo"]);
  });

  it("goes to finishing when everything is already done or skipped", async () => {
    storage.setItem(
      progressKey("user-1", SESSION),
      JSON.stringify({ exercises: { plank: { sets: [], skipped: true } } }),
    );
    renderRunner([plank]);
    expect(await screen.findByTestId("finish-panel")).toBeTruthy();
    expect(runner().getAttribute("data-phase")).toBe("finish");
  });

  it("ignores progress that is not valid instead of crashing", async () => {
    storage.setItem(progressKey("user-1", SESSION), "{{{");
    renderRunner([plank]);
    expect(await screen.findByTestId("current-step")).toBeTruthy();
  });
});

describe("WorkoutRunner: camera-tracked sets", () => {
  it("embeds the live coach for the squat with session, set index and target reps", async () => {
    renderRunner([squat], true);
    const stub = await screen.findByTestId("live-coach-stub");
    expect(stub.getAttribute("data-session-id")).toBe(SESSION);
    expect(stub.getAttribute("data-user-id")).toBe("user-1");
    expect(stub.getAttribute("data-set-index")).toBe("0");
    expect(stub.getAttribute("data-target-reps")).toBe("10");
    expect(stub.getAttribute("data-single-set")).toBe("true");
    expect(liveProps.at(-1)).toMatchObject({ trackingConsent: true, consentDeclined: false });
  });

  it("only ever uses this member's outbox", async () => {
    renderRunner([bridge]);
    await screen.findByTestId("current-step");
    await user.click(screen.getByRole("button", { name: "Save set" }));
    await screen.findByTestId("finish-panel");
    expect([...outboxUsers]).toEqual(["user-1"]);
  });

  it("saves a counted set without a new event when the member adds no rating", async () => {
    renderRunner([squat], true);
    await user.click(await screen.findByRole("button", { name: "stub: finish set" }));
    const save = await screen.findByTestId("save-tracked-set");
    expect(save.textContent).toContain("8 reps counted");
    expect(within(save).queryByLabelText("Reps completed")).toBeNull(); // the camera's count stands
    await user.click(within(save).getByRole("button", { name: "Save set" }));
    await waitFor(() => expect(runner().getAttribute("data-phase")).toBe("rest"));
    expect(enqueued()).toHaveLength(0); // the recorder already queued the set's events
    expect(screen.getAllByTestId("runner-exercise")[0]!.getAttribute("data-state")).toBe(
      "in_progress",
    );
  });

  it("adds a rating as a second set_completed for the same set with the camera's reps", async () => {
    renderRunner([squat], true);
    await user.click(await screen.findByRole("button", { name: "stub: finish set" }));
    const save = await screen.findByTestId("save-tracked-set");
    await user.selectOptions(within(save).getByLabelText(/How hard was it\? \(optional\)/), "6");
    await user.click(within(save).getByRole("button", { name: "Save set" }));
    await waitFor(() => expect(enqueued()).toHaveLength(1));
    expect(enqueued()[0]).toMatchObject({
      type: "set_completed",
      exercise_id: "bodyweight_squat",
      set_index: 0,
      reps: 8,
      perceived_difficulty: 6,
    });
  });

  it("when the member declines saving tracking data, the set can be logged by hand instead", async () => {
    renderRunner([squat], false);
    await user.click(await screen.findByRole("button", { name: "stub: decline" }));
    await user.click(screen.getByRole("button", { name: "stub: finish set" }));
    const save = await screen.findByTestId("save-tracked-set");
    expect(save.textContent).toContain("isn't saved");
    const reps = within(save).getByLabelText("Reps completed") as HTMLInputElement;
    expect(reps.value).toBe("8"); // the on-device count is the starting point
    await user.clear(reps);
    await user.type(reps, "7");
    await user.click(within(save).getByRole("button", { name: "Save set" }));
    await waitFor(() => expect(enqueued()).toHaveLength(1));
    expect(enqueued()[0]).toMatchObject({ type: "set_logged", reps: 7, set_index: 0 });
    // the next set's coach doesn't ask again
    await user.click(await screen.findByRole("button", { name: "Skip rest" }));
    await screen.findByTestId("live-coach-stub");
    expect(liveProps.at(-1)).toMatchObject({ consentDeclined: true, trackingConsent: false });
  });

  it("offers by-hand logging instead of the camera, and back", async () => {
    renderRunner([squat], true);
    await user.click(await screen.findByRole("button", { name: "Log this set by hand instead" }));
    expect(screen.queryByTestId("live-coach-stub")).toBeNull();
    expect(screen.getByLabelText("Reps completed")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use the camera instead" }));
    expect(await screen.findByTestId("live-coach-stub")).toBeTruthy();
  });

  it("lets the member discard a counted set and record it again", async () => {
    renderRunner([squat], true);
    await user.click(await screen.findByRole("button", { name: "stub: finish set" }));
    await user.click(
      await screen.findByRole("button", { name: /Discard and record this set again/ }),
    );
    expect(screen.queryByTestId("save-tracked-set")).toBeNull();
    expect(await screen.findByTestId("live-coach-stub")).toBeTruthy();
    expect(enqueued()).toHaveLength(0);
  });
});

describe("WorkoutRunner: finishing", () => {
  async function toFinish() {
    renderRunner([bridge]);
    await screen.findByTestId("current-step");
    await user.click(screen.getByRole("button", { name: "Skip exercise" }));
    await screen.findByTestId("finish-panel");
  }

  it("flushes the outbox, completes with rating and note, clears progress and opens the summary", async () => {
    completeSession.mockResolvedValue({ ok: true, data: {} });
    await toFinish();
    await user.selectOptions(screen.getByLabelText(/How hard was the whole workout/), "7");
    await user.type(screen.getByLabelText("Note (optional)"), "good one");
    await user.click(screen.getByRole("button", { name: "Complete workout" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/workouts/${SESSION}/summary`));
    expect(completeSession).toHaveBeenCalledWith(SESSION, `complete:${SESSION}`, {
      perceived_difficulty: 7,
      note: "good one",
    });
    expect(outbox.flush.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      completeSession.mock.invocationCallOrder[0]!,
    );
    expect(storage.getItem(progressKey("user-1", SESSION))).toBeNull();
  });

  it("sends no rating or note when the member gave none", async () => {
    completeSession.mockResolvedValue({ ok: true, data: {} });
    await toFinish();
    await user.click(screen.getByRole("button", { name: "Complete workout" }));
    await waitFor(() => expect(completeSession).toHaveBeenCalled());
    expect(completeSession.mock.calls[0]![2]).toEqual({});
  });

  it("does not complete while sets are still waiting to be sent (offline), and says so", async () => {
    outbox.pendingCount.mockResolvedValue(3);
    await toFinish();
    await user.click(screen.getByRole("button", { name: "Complete workout" }));
    expect((await screen.findByRole("alert")).textContent).toContain("haven't been sent yet");
    expect(completeSession).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();

    // back online: the same button now completes
    outbox.pendingCount.mockResolvedValue(0);
    completeSession.mockResolvedValue({ ok: true, data: {} });
    await user.click(screen.getByRole("button", { name: "Complete workout" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("treats an already-completed session as done", async () => {
    completeSession.mockResolvedValue({ ok: false, failure: "session_completed" });
    await toFinish();
    await user.click(screen.getByRole("button", { name: "Complete workout" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/workouts/${SESSION}/summary`));
  });

  it.each([
    ["unavailable", "couldn't complete the workout"],
    ["session_not_found", "could not be found"],
  ])("shows a message for %s and stays on the page", async (failure, text) => {
    completeSession.mockResolvedValue({ ok: false, failure });
    await toFinish();
    await user.click(screen.getByRole("button", { name: "Complete workout" }));
    expect((await screen.findByRole("alert")).textContent).toContain(text);
    expect(push).not.toHaveBeenCalled();
  });

  it("can finish early, says what is unfinished, and can go back", async () => {
    renderRunner([plank, bridge]);
    await screen.findByTestId("current-step");
    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    const panel = await screen.findByTestId("finish-panel");
    expect(panel.textContent).toContain("2 exercises aren't finished");
    await user.click(within(panel).getByRole("button", { name: "Back to the workout" }));
    expect(await screen.findByTestId("current-step")).toBeTruthy();
    expect(runner().getAttribute("data-current-exercise")).toBe("plank");
  });

  it("moves focus to the new step's heading", async () => {
    renderRunner([plank, bridge]);
    await screen.findByTestId("current-step");
    await user.click(screen.getByRole("button", { name: "Save set" }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Glute Bridge"));
  });

  it("waits for storage on first render, then shows the workout", async () => {
    renderRunner([plank]);
    await act(async () => {});
    expect(screen.getByTestId("current-step")).toBeTruthy();
  });
});
