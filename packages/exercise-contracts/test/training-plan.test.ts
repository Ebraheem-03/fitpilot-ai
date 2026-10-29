import { describe, expect, it } from "vitest";
import { TrainingPlan, TrainingPlanResource } from "../src";

const squat = () => ({
  exercise_id: "bodyweight_squat",
  sets: 3,
  reps: 10,
  duration_s: null,
  rest_s: 60,
  progression: "Add two reps a week until 15, then slow the lowering phase.",
});
const plank = () => ({
  exercise_id: "plank",
  sets: 3,
  reps: null,
  duration_s: 30,
  rest_s: 45,
  progression: "Add five seconds a week.",
});
const plan = () => ({
  days: [
    { day_of_week: "monday", focus: "Full body", exercises: [squat(), plank()] },
    { day_of_week: "thursday", focus: "Full body", exercises: [squat()] },
  ],
  rationale: "Two full-body days suit a beginner with no equipment.",
});

const messages = (schema: typeof TrainingPlan | typeof TrainingPlanResource, input: unknown) => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("TrainingPlan (FR-02)", () => {
  it("accepts a valid plan", () => {
    expect(messages(TrainingPlan, plan())).toEqual([]);
  });

  it("needs exactly one of reps or duration_s per exercise", () => {
    const both = plan();
    both.days[0]!.exercises[0] = { ...squat(), duration_s: 30 } as never;
    const neither = plan();
    neither.days[0]!.exercises[0] = { ...squat(), reps: null } as never;
    const message = "a planned exercise needs exactly one of reps or duration_s";
    expect(messages(TrainingPlan, both)).toContain(message);
    expect(messages(TrainingPlan, neither)).toContain(message);
  });

  it("requires reps and duration_s to be present (null, not omitted) for strict LLM output", () => {
    const { duration_s: _d, ...withoutDuration } = squat();
    void _d;
    const p = plan();
    p.days[0]!.exercises[0] = withoutDuration as never;
    expect(messages(TrainingPlan, p)).not.toEqual([]);
  });

  it("rejects a repeated day and a repeated exercise within a day", () => {
    const sameDay = plan();
    sameDay.days[1]!.day_of_week = "monday";
    expect(messages(TrainingPlan, sameDay)).toContain("day_of_week values must be distinct");

    const twice = plan();
    twice.days[1]!.exercises.push(squat());
    expect(messages(TrainingPlan, twice)).toContain("thursday: an exercise appears more than once");
  });

  it("enforces bounds and closed objects", () => {
    const tooMany = plan();
    tooMany.days[0]!.exercises[0] = { ...squat(), sets: 7 };
    expect(messages(TrainingPlan, tooMany)).not.toEqual([]);
    expect(messages(TrainingPlan, { ...plan(), member_id: "x" })).not.toEqual([]);
    expect(messages(TrainingPlan, { ...plan(), days: [] })).not.toEqual([]);
    const notSlug = plan();
    notSlug.days[0]!.exercises[0] = { ...squat(), exercise_id: "Burpee!" };
    expect(messages(TrainingPlan, notSlug)).not.toEqual([]);
  });
});

describe("TrainingPlanResource", () => {
  const resource = () => ({
    id: "0b3f6a52-6a0b-4f43-8d4e-5f4a5f6a7b8c",
    version: 2,
    status: "active",
    prompt_version: "plan-v1",
    model: "openai/gpt-oss-120b",
    created_at: "2026-10-29T10:00:00.123456+00:00",
    validation_issues: [] as { code: string; message: string }[],
    plan: plan() as ReturnType<typeof plan> | null,
  });

  it("accepts an active or superseded plan", () => {
    expect(messages(TrainingPlanResource, resource())).toEqual([]);
    expect(messages(TrainingPlanResource, { ...resource(), status: "superseded" })).toEqual([]);
  });

  it("a needs_review plan carries issues and no plan", () => {
    const review = {
      ...resource(),
      status: "needs_review",
      plan: null,
      validation_issues: [{ code: "equipment", message: "monday: dumbbell_row needs dumbbells" }],
    };
    expect(messages(TrainingPlanResource, review)).toEqual([]);
    expect(messages(TrainingPlanResource, { ...review, plan: plan() })).toContain(
      "plan must be null exactly when status is needs_review",
    );
    expect(messages(TrainingPlanResource, { ...review, validation_issues: [] })).toContain(
      "validation_issues must be non-empty exactly when status is needs_review",
    );
  });

  it("an active plan has a plan and no issues", () => {
    expect(messages(TrainingPlanResource, { ...resource(), plan: null })).toContain(
      "plan must be null exactly when status is needs_review",
    );
    expect(
      messages(TrainingPlanResource, {
        ...resource(),
        validation_issues: [{ code: "schema", message: "x" }],
      }),
    ).not.toEqual([]);
  });

  it("rejects unknown issue codes and statuses", () => {
    expect(messages(TrainingPlanResource, { ...resource(), status: "draft" })).not.toEqual([]);
    const review = {
      ...resource(),
      status: "needs_review",
      plan: null,
      validation_issues: [{ code: "made_up", message: "x" }],
    };
    expect(messages(TrainingPlanResource, review)).not.toEqual([]);
  });
});
