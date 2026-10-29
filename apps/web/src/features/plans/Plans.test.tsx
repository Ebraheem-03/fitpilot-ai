// @vitest-environment jsdom
import type { TrainingPlanResource } from "@fitpilot/exercise-contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ISSUE_EXPLANATIONS, errorMessage, prescriptionLabel } from "./labels";
import { NeedsReviewNotice } from "./NeedsReviewNotice";
import { PlanVersions } from "./PlanVersions";
import { type ExerciseIndex, MANUAL_LABEL, PlanView, TRACKED_LABEL } from "./PlanView";

afterEach(cleanup);

const plan: NonNullable<TrainingPlanResource["plan"]> = {
  rationale: "A balanced plan for strength.",
  days: [
    {
      day_of_week: "monday",
      focus: "Lower body",
      exercises: [
        {
          exercise_id: "bodyweight_squat",
          sets: 3,
          reps: 10,
          duration_s: null,
          rest_s: 60,
          progression: "Add one rep per set each week.",
        },
        {
          exercise_id: "plank",
          sets: 2,
          reps: null,
          duration_s: 30,
          rest_s: 45,
          progression: "Add five seconds each week.",
        },
      ],
    },
    {
      day_of_week: "thursday",
      focus: "Full body",
      exercises: [
        {
          exercise_id: "glute_bridge",
          sets: 3,
          reps: 12,
          duration_s: null,
          rest_s: 60,
          progression: "Pause for a second at the top.",
        },
      ],
    },
  ],
};
const exercises: ExerciseIndex = new Map([
  [
    "bodyweight_squat",
    { id: "bodyweight_squat", name: "Bodyweight Squat", hasDemo: true, tracked: true },
  ],
  ["plank", { id: "plank", name: "Plank", hasDemo: false, tracked: false }],
  ["glute_bridge", { id: "glute_bridge", name: "Glute Bridge", hasDemo: false, tracked: false }],
]);

describe("PlanView", () => {
  it("shows the week: days in order, sets x reps or duration, rest, progression, rationale", () => {
    render(<PlanView plan={plan} exercises={exercises} />);
    expect(screen.getByText("A balanced plan for strength.")).toBeTruthy();
    const days = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(days).toEqual(["Monday · Lower body", "Thursday · Full body"]);

    const monday = within(screen.getByTestId("plan-day-monday"));
    const rows = monday.getAllByTestId("plan-exercise");
    expect(within(rows[0]!).getByTestId("plan-prescription").textContent).toBe("3 × 10 reps");
    expect(within(rows[1]!).getByTestId("plan-prescription").textContent).toBe("2 × 30 s");
    expect(rows[0]!.textContent).toContain("Rest 60 s between sets");
    expect(rows[0]!.textContent).toContain("Add one rep per set each week.");
  });

  it("labels camera-tracked vs logged by hand, and links the demo only where there is one", () => {
    render(<PlanView plan={plan} exercises={exercises} />);
    const [squat, plank] = within(screen.getByTestId("plan-day-monday")).getAllByTestId(
      "plan-exercise",
    );
    expect(within(squat!).getByTestId("plan-tracking").textContent).toBe(TRACKED_LABEL);
    expect(within(plank!).getByTestId("plan-tracking").textContent).toBe(MANUAL_LABEL);

    const demo = within(squat!).getByRole("link");
    expect(demo.textContent).toContain("Watch the 3D demo");
    expect(demo.getAttribute("href")).toBe("/app/exercises/bodyweight_squat");
    expect(within(plank!).getByRole("link").textContent).toContain("How to do it");
  });

  it("copes with an exercise missing from the catalogue index: readable name, by hand, no link", () => {
    render(<PlanView plan={plan} exercises={new Map()} />);
    const squat = within(screen.getByTestId("plan-day-monday")).getAllByTestId("plan-exercise")[0]!;
    expect(squat.textContent).toContain("bodyweight squat");
    expect(within(squat).getByTestId("plan-tracking").textContent).toBe(MANUAL_LABEL);
    expect(within(squat).queryByRole("link")).toBeNull();
  });

  it("renders a per-day action when the caller provides one", () => {
    render(
      <PlanView
        plan={plan}
        exercises={exercises}
        dayAction={(day, i) => (
          <button>
            Start {day.day_of_week} #{i}
          </button>
        )}
      />,
    );
    expect(screen.getByRole("button", { name: "Start thursday #1" })).toBeTruthy();
  });
});

describe("NeedsReviewNotice", () => {
  it("says a trainer must check it, explains each problem once in plain words, and shows no plan", () => {
    render(
      <NeedsReviewNotice
        issues={[
          { code: "catalogue", message: "monday: unknown_move is not in the catalogue" },
          { code: "catalogue", message: "friday: other_move is not in the catalogue" },
          { code: "equipment", message: "monday: needs a barbell" },
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "A trainer needs to check this plan before you can use it",
      }),
    ).toBeTruthy();
    const plain = within(screen.getByTestId("needs-review-issues")).getAllByRole("listitem");
    expect(plain.map((li) => li.textContent)).toEqual([
      ISSUE_EXPLANATIONS.catalogue,
      ISSUE_EXPLANATIONS.equipment,
    ]);
    expect(screen.queryByTestId("plan-view")).toBeNull();
  });
});

describe("PlanVersions", () => {
  const base = {
    prompt_version: "plan-v1",
    model: "fake",
    validation_issues: [],
    plan: null,
  } satisfies Partial<TrainingPlanResource>;
  it("lists versions newest first with status and a link to each", () => {
    render(
      <PlanVersions
        plans={[
          {
            ...base,
            id: "a",
            version: 3,
            status: "needs_review",
            created_at: "2026-10-29T10:00:00Z",
          } as TrainingPlanResource,
          {
            ...base,
            id: "b",
            version: 2,
            status: "active",
            created_at: "2026-10-28T10:00:00Z",
          } as TrainingPlanResource,
          {
            ...base,
            id: "c",
            version: 1,
            status: "superseded",
            created_at: "2026-10-27T10:00:00Z",
          } as TrainingPlanResource,
        ]}
      />,
    );
    const items = screen.getAllByTestId("plan-version");
    expect(items.map((li) => li.getAttribute("data-plan-status"))).toEqual([
      "needs_review",
      "active",
      "superseded",
    ]);
    expect(within(items[0]!).getByRole("link").getAttribute("href")).toBe("/app/plan/a");
    expect(items[0]!.textContent).toContain("Waiting for a trainer");
    expect(items[2]!.textContent).toContain("Earlier version");
  });
  it("renders nothing without versions", () => {
    const { container } = render(<PlanVersions plans={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("labels", () => {
  it("formats prescriptions", () => {
    expect(prescriptionLabel({ sets: 4, reps: 8, duration_s: null })).toBe("4 × 8 reps");
    expect(prescriptionLabel({ sets: 3, reps: null, duration_s: 45 })).toBe("3 × 45 s");
  });
  it("words every failure and never offers a plan", () => {
    expect(errorMessage("coach_busy", 42).title).toBe("The coach is busy, try again in 42 s.");
    expect(errorMessage("ai_unavailable", null).title).toContain("isn't available");
    expect(errorMessage("profile_required", null).link?.href).toBe("/app/onboarding");
    expect(errorMessage("generation_in_progress", 5).title).toContain("5 s");
    expect(errorMessage("unknown", null).title).toContain("no plan was created");
  });
});
