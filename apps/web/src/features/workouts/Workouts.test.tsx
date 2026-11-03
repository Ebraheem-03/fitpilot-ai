// @vitest-environment jsdom
import type { SessionSummary } from "@fitpilot/exercise-contracts";
import { explainCue } from "@fitpilot/exercise-rules";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkoutSessionBrief } from "@/lib/api-types";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
const startSession = vi.fn();
const deleteSession = vi.fn();
vi.mock("./actions", () => ({
  startSession: (...a: unknown[]) => startSession(...a),
  deleteSession: (...a: unknown[]) => deleteSession(...a),
}));

const { SummaryView } = await import("./SummaryView");
const { HistoryList } = await import("./HistoryList");
const { StartWorkoutButton } = await import("./StartWorkoutButton");
const { pickDay, TodayWorkoutCard, todayIndex } = await import("./TodayWorkoutCard");
const { RestTimer } = await import("./RestTimer");

const user = userEvent.setup();
const SESSION = "0b0f7a3e-4b1c-4a55-9d63-8f0c8d1c2a11";
const PLAN = "7c1f5d3e-0000-4000-8000-000000000001";

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  startSession.mockReset();
  deleteSession.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const summary: SessionSummary = {
  session_id: SESSION,
  started_at: "2026-10-29T10:00:00.000Z",
  completed_at: "2026-10-29T10:25:00.000Z",
  perceived_difficulty: 7,
  note: "good session",
  exercises: [
    {
      exercise_id: "bodyweight_squat",
      status: "completed",
      skip_reason: null,
      prescription: "reps",
      tracked: true,
      sets: [
        { set_index: 0, source: "tracked", reps: 5, duration_s: null, perceived_difficulty: 6 },
      ],
      total_reps: 5,
      total_duration_s: 0,
      cues: [
        {
          rule_id: "squat.depth.shallow",
          ruleset_version: 3,
          message_id: "squat_depth_shallow_v1",
          shown_at: "2026-10-29T10:05:00.000Z",
          measurements: { min_knee_angle_deg: 131 },
          response: "acknowledged",
        },
      ],
      tracking_degraded: [
        { reason: "no_person", started_at: "2026-10-29T10:06:00.000Z", duration_ms: 4200 },
      ],
      perceived_difficulty: 6,
      note: null,
    },
    {
      exercise_id: "plank",
      status: "completed",
      skip_reason: null,
      prescription: "duration",
      tracked: false,
      sets: [
        { set_index: 0, source: "manual", reps: null, duration_s: 40, perceived_difficulty: null },
      ],
      total_reps: 0,
      total_duration_s: 40,
      cues: [],
      tracking_degraded: [],
      perceived_difficulty: null,
      note: "wrists sore",
    },
    {
      exercise_id: "glute_bridge",
      status: "skipped",
      skip_reason: "no_time",
      prescription: "reps",
      tracked: false,
      sets: [],
      total_reps: 0,
      total_duration_s: 0,
      cues: [],
      tracking_degraded: [],
      perceived_difficulty: null,
      note: null,
    },
  ],
};
const names = {
  bodyweight_squat: "Bodyweight Squat",
  plank: "Plank",
  glute_bridge: "Glute Bridge",
};

describe("SummaryView", () => {
  it("shows the workout: counts, length, rating and note", () => {
    render(<SummaryView summary={summary} names={names} />);
    expect(screen.getByTestId("summary-counts").textContent).toBe("2 done, 1 skipped");
    expect(screen.getByText("25 min")).toBeTruthy();
    expect(screen.getByTestId("summary-difficulty").textContent).toBe("7 out of 10");
    expect(screen.getByTestId("summary-note").textContent).toBe("good session");
  });

  it("lists each exercise's sets, where they came from, and totals", () => {
    render(<SummaryView summary={summary} names={names} />);
    const [squat, plank, bridge] = screen.getAllByTestId("summary-exercise");
    expect(squat!.getAttribute("data-tracked")).toBe("true");
    expect(within(squat!).getByTestId("summary-tracked").textContent).toBe("Camera-tracked");
    const set = within(squat!).getByTestId("summary-set");
    expect(set.getAttribute("data-source")).toBe("tracked");
    expect(set.textContent).toContain("5 reps");
    expect(set.textContent).toContain("counted by the camera");
    expect(set.textContent).toContain("felt 6 out of 10");
    expect(within(squat!).getByTestId("summary-total").textContent).toBe("Total: 5 reps");

    expect(within(plank!).getByTestId("summary-set").textContent).toContain("40 s");
    expect(within(plank!).getByTestId("summary-tracked").textContent).toBe("Logged by hand");
    expect(within(plank!).getByTestId("summary-total").textContent).toBe("Total: 40 s");
    expect(within(plank!).getByText("wrists sore")).toBeTruthy();

    expect(bridge!.getAttribute("data-status")).toBe("skipped");
    expect(bridge!.textContent).toContain("Skipped (short on time)");
    expect(within(bridge!).queryByTestId("summary-set")).toBeNull();
  });

  it("traces every cue to its rule, version and measurements, with the rule's own explanation", () => {
    render(<SummaryView summary={summary} names={names} />);
    const cue = screen.getByTestId("summary-cue");
    expect(cue.getAttribute("data-rule-id")).toBe("squat.depth.shallow");
    expect(cue.getAttribute("data-ruleset-version")).toBe("3");
    expect(cue.getAttribute("data-response")).toBe("acknowledged");
    expect(cue.textContent).toContain("131°");
    expect(cue.textContent).toContain("Rule squat.depth.shallow, version 3");
    expect(cue.textContent).toContain("You marked this “Got it”.");
    // wording comes from the rule definition, not from this view
    const rule = explainCue("squat_depth_shallow_v1")!;
    expect(cue.textContent).toContain(rule.message);
    expect(cue.textContent).toContain(rule.explanation);
  });

  it("reports tracking gaps, and says tracking stayed reliable when there were none", () => {
    render(<SummaryView summary={summary} names={names} />);
    const spans = screen.getByTestId("summary-tracking");
    expect(spans.textContent).toContain("Nobody in view: 4.2 s");
    expect(spans.textContent).toContain("Reps and cues were paused");
    const tracked = {
      ...summary,
      exercises: [{ ...summary.exercises[0]!, cues: [], tracking_degraded: [] }],
    };
    cleanup();
    render(<SummaryView summary={tracked} names={names} />);
    expect(screen.getByText("No cues were shown.")).toBeTruthy();
    expect(screen.getByText("Tracking stayed reliable.")).toBeTruthy();
  });

  it("does not show camera sections for hand-logged exercises", () => {
    render(
      <SummaryView summary={{ ...summary, exercises: [summary.exercises[1]!] }} names={names} />,
    );
    expect(screen.queryByText("Coaching cues")).toBeNull();
    expect(screen.queryByTestId("summary-tracking")).toBeNull();
  });

  it("handles a workout with nothing recorded and a missing catalogue name", () => {
    render(
      <SummaryView
        summary={{ ...summary, perceived_difficulty: null, note: null, exercises: [] }}
        names={names}
      />,
    );
    expect(screen.getByTestId("summary-empty")).toBeTruthy();
    expect(screen.queryByTestId("summary-difficulty")).toBeNull();
    cleanup();
    render(<SummaryView summary={{ ...summary, exercises: [summary.exercises[2]!] }} names={{}} />);
    expect(screen.getByRole("heading", { name: "glute bridge" })).toBeTruthy();
  });
});

describe("HistoryList", () => {
  const sessions: WorkoutSessionBrief[] = [
    {
      id: SESSION,
      status: "completed",
      training_plan_id: PLAN,
      plan_day_index: 0,
      started_at: "2026-10-29T10:00:00.000Z",
      completed_at: "2026-10-29T10:25:00.000Z",
      perceived_difficulty: 7,
    },
    {
      id: "11111111-1111-4111-8111-111111111111",
      status: "started",
      training_plan_id: PLAN,
      plan_day_index: 1,
      started_at: "2026-10-28T10:00:00.000Z",
      completed_at: null,
      perceived_difficulty: null,
    },
  ];

  it("links completed workouts to their summary and unfinished ones to the runner", () => {
    render(<HistoryList sessions={sessions} />);
    const [done, open] = screen.getAllByTestId("workout-item");
    expect(done!.getAttribute("data-status")).toBe("completed");
    expect(within(done!).getByRole("link").getAttribute("href")).toBe(
      `/app/workouts/${SESSION}/summary`,
    );
    expect(done!.textContent).toContain("felt 7/10");
    expect(within(open!).getByRole("link").getAttribute("href")).toBe(
      "/app/workouts/11111111-1111-4111-8111-111111111111",
    );
    expect(open!.textContent).toContain("In progress");
  });

  it("asks before deleting, and Keep it cancels without calling the API", async () => {
    render(<HistoryList sessions={sessions} />);
    const first = screen.getAllByTestId("workout-item")[0]!;
    await user.click(within(first).getByRole("button", { name: /^Delete/ }));
    const confirm = within(first).getByTestId("delete-confirm");
    expect(confirm.textContent).toContain("can't be undone");
    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(within(first).queryByTestId("delete-confirm")).toBeNull();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("deletes after confirmation, forgets local progress and refreshes the list", async () => {
    deleteSession.mockResolvedValue({ ok: true, data: null });
    render(<HistoryList sessions={sessions} />);
    const first = screen.getAllByTestId("workout-item")[0]!;
    await user.click(within(first).getByRole("button", { name: /^Delete/ }));
    await user.click(within(first).getByRole("button", { name: "Delete workout" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(deleteSession).toHaveBeenCalledWith(SESSION);
    expect(screen.getByTestId("history-message").textContent).toBe("Workout deleted.");
  });

  it("treats an already-deleted workout as deleted", async () => {
    deleteSession.mockResolvedValue({ ok: false, failure: "session_not_found" });
    render(<HistoryList sessions={sessions} />);
    const first = screen.getAllByTestId("workout-item")[0]!;
    await user.click(within(first).getByRole("button", { name: /^Delete/ }));
    await user.click(within(first).getByRole("button", { name: "Delete workout" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("keeps the confirmation open and says so when deleting fails", async () => {
    deleteSession.mockResolvedValue({ ok: false, failure: "unavailable" });
    render(<HistoryList sessions={sessions} />);
    const first = screen.getAllByTestId("workout-item")[0]!;
    await user.click(within(first).getByRole("button", { name: /^Delete/ }));
    await user.click(within(first).getByRole("button", { name: "Delete workout" }));
    await waitFor(() =>
      expect(screen.getByTestId("history-message").textContent).toContain("couldn't delete"),
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(within(first).getByTestId("delete-confirm")).toBeTruthy();
  });

  it("explains an empty history and points to the plan", () => {
    render(<HistoryList sessions={[]} />);
    expect(screen.getByTestId("no-workouts").textContent).toContain("haven't done a workout yet");
    expect(
      screen.getByRole("link", { name: "Start one from your plan" }).getAttribute("href"),
    ).toBe("/app/plan");
  });
});

describe("StartWorkoutButton", () => {
  it("starts the workout for a plan day and opens it", async () => {
    startSession.mockResolvedValue({ ok: true, data: { id: SESSION } });
    render(<StartWorkoutButton planId={PLAN} dayIndex={2} label="Start Friday's workout" />);
    await user.click(screen.getByRole("button", { name: "Start Friday's workout" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/workouts/${SESSION}`));
    expect(startSession).toHaveBeenCalledWith(expect.stringMatching(/^start-[0-9a-f-]{36}$/), {
      training_plan_id: PLAN,
      plan_day_index: 2,
    });
  });

  it("retries with the same idempotency key after a failure", async () => {
    startSession
      .mockResolvedValueOnce({ ok: false, failure: "unavailable" })
      .mockResolvedValueOnce({ ok: true, data: { id: SESSION } });
    render(<StartWorkoutButton planId={PLAN} dayIndex={0} />);
    await user.click(screen.getByRole("button", { name: "Start workout" }));
    expect((await screen.findByRole("alert")).textContent).toContain("couldn't reach the server");
    await user.click(screen.getByRole("button", { name: "Start workout" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(startSession.mock.calls[1]![0]).toBe(startSession.mock.calls[0]![0]);
  });

  it("explains when the plan day is gone", async () => {
    startSession.mockResolvedValue({ ok: false, failure: "session_not_found" });
    render(<StartWorkoutButton planId={PLAN} dayIndex={0} />);
    await user.click(screen.getByRole("button", { name: "Start workout" }));
    expect((await screen.findByRole("alert")).textContent).toContain("plan may have changed");
    expect(push).not.toHaveBeenCalled();
  });

  it("offers to resume an unfinished workout instead of starting another", () => {
    render(
      <StartWorkoutButton
        planId={PLAN}
        dayIndex={0}
        label="Start Monday's workout"
        resumeSessionId={SESSION}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("resume-workout").getAttribute("href")).toBe(
      `/app/workouts/${SESSION}`,
    );
  });
});

describe("today's workout", () => {
  const days = [
    { index: 0, day: "monday" as const, focus: "Lower body" },
    { index: 1, day: "wednesday" as const, focus: "Upper body" },
    { index: 2, day: "friday" as const, focus: "Full body" },
  ];

  it.each([
    [0, "monday", true],
    [1, "wednesday", false], // Tuesday → next is Wednesday
    [2, "wednesday", true],
    [3, "friday", false],
    [5, "monday", false], // Saturday → wraps to next Monday
    [6, "monday", false],
  ])("on weekday %i offers %s (today: %s)", (today, day, isToday) => {
    expect(pickDay(days, today)).toMatchObject({ day: { day }, isToday });
  });

  it("has nothing to offer for a plan without days", () => {
    expect(pickDay([], 0)).toBeNull();
  });

  it("numbers weekdays Monday first", () => {
    expect(todayIndex(new Date(2026, 9, 26))).toBe(0); // Monday
    expect(todayIndex(new Date(2026, 9, 25))).toBe(6); // Sunday
  });

  it("renders today's day with a start button, or the next one when today is free", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 26, 12) }); // Monday
    render(<TodayWorkoutCard planId={PLAN} days={days} resume={{}} />);
    expect(screen.getByRole("heading", { name: "Today's workout" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start today's workout" })).toBeTruthy();
    cleanup();

    vi.setSystemTime(new Date(2026, 9, 27, 12)); // Tuesday
    render(<TodayWorkoutCard planId={PLAN} days={days} resume={{ 1: SESSION }} />);
    expect(screen.getByRole("heading", { name: "Your next workout" })).toBeTruthy();
    expect(screen.getByTestId("today-workout").textContent).toContain(
      "Nothing is planned for today",
    );
    expect(screen.getByTestId("resume-workout").getAttribute("href")).toBe(
      `/app/workouts/${SESSION}`,
    );
  });
});

describe("RestTimer", () => {
  it("counts down, then ends once", () => {
    vi.useFakeTimers({ now: 0 });
    const onDone = vi.fn();
    render(<RestTimer seconds={3} nextLabel="Plank, set 2 of 2" onDone={onDone} />);
    expect(screen.getByRole("timer").textContent).toBe("0:03");
    expect(screen.getByText("Next: Plank, set 2 of 2")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.getByRole("timer").textContent).toBe("0:02");
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2500));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("can be skipped, and does not end twice", async () => {
    const onDone = vi.fn();
    render(<RestTimer seconds={60} nextLabel="x" onDone={onDone} />);
    await user.click(screen.getByRole("button", { name: "Skip rest" }));
    await user.click(screen.getByRole("button", { name: "Skip rest" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("is not a live region, so the ticking isn't read out every second", () => {
    render(<RestTimer seconds={60} nextLabel="x" onDone={() => {}} />);
    expect(screen.getByRole("timer").getAttribute("aria-live")).toBe("off");
  });
});
