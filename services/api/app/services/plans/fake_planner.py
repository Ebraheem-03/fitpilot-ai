"""A rule-based stand-in for the model when `LLM_PROVIDER=fake` (local dev, web e2e, CI).

Registered with the fake provider for the `training_plan` schema. It reads only what the real
model gets, the per-request `exercise_id` enum in the wire schema and the profile JSON in the user
message (prompt `plan-v1` format), and builds a deterministic plan that passes validation.
Unit tests that need specific replies script the FakeProvider instead.
"""

import json
from typing import Any

from app.schemas.plan import DAYS_OF_WEEK, PlannedExercise, TrainingDay, TrainingPlan
from app.services.catalog import load_catalog
from app.services.llm import CompletionRequest, FakeReply, ProviderResponse, register_responder
from app.services.plans.validation import estimate_minutes

# Training days spread across the week, for 1 to 7 days per week.
SPREAD: dict[int, tuple[int, ...]] = {
    1: (0,),
    2: (0, 3),
    3: (0, 2, 4),
    4: (0, 1, 3, 4),
    5: (0, 1, 2, 4, 5),
    6: (0, 1, 2, 3, 4, 5),
    7: (0, 1, 2, 3, 4, 5, 6),
}


def _profile(request: CompletionRequest) -> dict[str, Any]:
    user = next(m["content"] for m in reversed(request.messages) if m["role"] == "user")
    if "Member profile:" not in user:  # a repair turn: the profile is in the first user message
        user = next(m["content"] for m in request.messages if m["role"] == "user")
    profile: dict[str, Any] = json.loads(user.split("Member profile:", 1)[1])
    return profile


def _exercise(exercise_id: str, prescription: str, sets: int) -> PlannedExercise:
    reps = prescription == "reps"
    return PlannedExercise(
        exercise_id=exercise_id,
        sets=sets,
        reps=10 if reps else None,
        duration_s=None if reps else 30,
        rest_s=60,
        progression="Add one rep per set each week." if reps else "Add five seconds each week.",
    )


def build_plan(exercise_ids: list[str], days_per_week: int, session_minutes: int) -> TrainingPlan:
    catalogue = load_catalog()
    days = []
    for n, weekday in enumerate(SPREAD[days_per_week]):
        # rotate the start so consecutive days differ
        order = exercise_ids[n % len(exercise_ids) :] + exercise_ids[: n % len(exercise_ids)]
        chosen: list[PlannedExercise] = []
        for sets in (3, 2, 1):
            chosen = []
            for exercise_id in order[:6]:
                candidate = [
                    *chosen,
                    _exercise(exercise_id, catalogue[exercise_id].prescription, sets),
                ]
                day = TrainingDay(
                    day_of_week=DAYS_OF_WEEK[weekday], focus="Full body", exercises=candidate
                )
                if estimate_minutes(day) <= session_minutes:
                    chosen = candidate
            if chosen:
                break
        if not chosen:  # 10-minute sessions: one short set still fits
            chosen = [_exercise(order[0], catalogue[order[0]].prescription, 1)]
        days.append(
            TrainingDay(day_of_week=DAYS_OF_WEEK[weekday], focus="Full body", exercises=chosen)
        )
    return TrainingPlan(
        days=days,
        rationale="A balanced full-body plan built from the approved exercises you can do.",
    )


def respond(request: CompletionRequest) -> ProviderResponse:
    ids = request.json_schema["$defs"]["PlannedExercise"]["properties"]["exercise_id"]["enum"]
    profile = _profile(request)
    plan = build_plan(list(ids), int(profile["days_per_week"]), int(profile["session_minutes"]))
    reply: ProviderResponse = FakeReply.ok(plan)
    return reply


register_responder("training_plan", respond)
