"""Builders for LLM-layer tests: a real LLMClient around a scripted FakeProvider. No network."""

import copy
from typing import Any

from app.services.llm import BudgetGuard, FakeProvider, LLMClient, ProviderResponse
from app.services.llm.providers import Provider


class Sleeps(list[float]):
    def __call__(self, seconds: float) -> None:
        self.append(seconds)


def fake_client(
    *script: ProviderResponse,
    provider: Provider | None = None,
    model: str = "openai/gpt-oss-120b",
    monthly_budget_usd: float = 0.0,
    daily_token_budget: int = 0,
    max_retry_wait_s: float = 10.0,
    **fake_kwargs: Any,
) -> tuple[LLMClient, FakeProvider, Sleeps]:
    fake = FakeProvider(script, **fake_kwargs)
    sleeps = Sleeps()
    client = LLMClient(
        provider or fake,
        model=model,
        budget=BudgetGuard(
            monthly_budget_usd=monthly_budget_usd, daily_token_budget=daily_token_budget
        ),
        max_retry_wait_s=max_retry_wait_s,
        sleep=sleeps,
    )
    return client, fake, sleeps


SQUAT: dict[str, Any] = {
    "exercise_id": "bodyweight_squat",
    "sets": 3,
    "reps": 10,
    "duration_s": None,
    "rest_s": 60,
    "progression": "Add two reps a week until 15.",
}
PLANK: dict[str, Any] = {**SQUAT, "exercise_id": "plank", "reps": None, "duration_s": 30}
GLUTE_BRIDGE: dict[str, Any] = {**SQUAT, "exercise_id": "glute_bridge"}
ROW: dict[str, Any] = {**SQUAT, "exercise_id": "dumbbell_row"}

# 3 days, each 5 + 3 exercises x 3 sets x (30 s work + 60 s rest) / 60 = 18.5 min
VALID_PLAN: dict[str, Any] = {
    "days": [
        {"day_of_week": day, "focus": "Full body", "exercises": [SQUAT, GLUTE_BRIDGE, PLANK]}
        for day in ("monday", "wednesday", "friday")
    ],
    "rationale": "Three full-body days suit a beginner training at home.",
}


def plan(**changes: Any) -> dict[str, Any]:
    data = copy.deepcopy(VALID_PLAN)
    data.update(changes)
    return data
