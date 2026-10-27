"use client";

import { useActionState } from "react";
import { EQUIPMENT, EXPERIENCE, GOALS } from "@/lib/api-types";
import { EQUIPMENT_LABELS, EXPERIENCE_LABELS, GOAL_LABELS } from "@/lib/profile-labels";
import { createProfileAction, type OnboardingState } from "./actions";

const INITIAL: OnboardingState = { error: null };
const input = "rounded-md border border-border bg-background px-3 py-2 text-base text-foreground";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(createProfileAction, INITIAL);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-6" aria-busy={pending}>
      <label className="flex flex-col gap-1 font-medium">
        Main goal
        <select name="primary_goal" required defaultValue="" className={input}>
          <option value="" disabled>
            Choose a goal
          </option>
          {GOALS.map((g) => (
            <option key={g} value={g}>
              {GOAL_LABELS[g]}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">Training experience</legend>
        {EXPERIENCE.map((level) => (
          <label key={level} className="flex items-center gap-2">
            <input
              type="radio"
              name="experience_level"
              value={level}
              defaultChecked={level === "beginner"}
            />
            {EXPERIENCE_LABELS[level]}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 font-medium">
          Days per week
          <input name="days_per_week" type="number" min={1} max={7} className={`${input} w-28`} />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Minutes per session
          <input
            name="session_minutes"
            type="number"
            min={10}
            max={180}
            step={5}
            className={`${input} w-36`}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">Equipment you have</legend>
        <p className="text-sm text-muted">Leave all unticked for bodyweight-only training.</p>
        {EQUIPMENT.map((item) => (
          <label key={item} className="flex items-center gap-2">
            <input type="checkbox" name="equipment" value={item} />
            {EQUIPMENT_LABELS[item]}
          </label>
        ))}
      </fieldset>

      {state.error && (
        <p role="alert" data-testid="onboarding-error" className="text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-brand px-4 py-2 font-medium text-brand-foreground hover:bg-brand-hover disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
