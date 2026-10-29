"""Builders for training-plan API tests. Plans come from the fake provider or are inserted
directly; no live model is ever called."""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import jwt
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.models import PlanStatus, TrainingPlanRecord, User
from app.repositories import training_plans as repo
from app.services.llm import FakeProvider, LLMClient, ProviderResponse, get_llm_client
from tests.auth_helpers import bearer
from tests.llm_helpers import VALID_PLAN, fake_client

PLANS = "/api/v1/training-plans"
GENERATE = f"{PLANS}/generate"
PROFILE = "/api/v1/profiles"
BEGINNER: dict[str, Any] = {
    "primary_goal": "general_fitness",
    "experience_level": "beginner",
    "days_per_week": 3,
    "session_minutes": 30,
    "equipment": [],
}


@contextmanager
def llm(*script: ProviderResponse, **kwargs: Any) -> Iterator[tuple[LLMClient, FakeProvider]]:
    """Route the API's LLM dependency to a scripted fake for the duration of the block."""
    client, fake, _ = fake_client(*script, **kwargs)
    app.dependency_overrides[get_llm_client] = lambda: client
    try:
        yield client, fake
    finally:
        app.dependency_overrides.pop(get_llm_client, None)


def member(api: TestClient, profile: dict[str, Any] | None = BEGINNER) -> tuple[uuid.UUID, Any]:
    sub = uuid.uuid4()
    headers = bearer(sub)
    if profile is not None:
        assert api.post(PROFILE, json=profile, headers=headers).status_code == 201
    else:
        api.get("/api/v1/users/me", headers=headers)  # provisions the user row only
    return sub, headers


def sub_of(headers: dict[str, str]) -> uuid.UUID:
    """The user id behind test bearer headers (tests.auth_helpers.bearer)."""
    token = headers["Authorization"].split()[1]
    return uuid.UUID(jwt.decode(token, options={"verify_signature": False})["sub"])


def generate(api: TestClient, headers: dict[str, str], key: str | None = None) -> Any:
    return api.post(GENERATE, headers={**headers, "Idempotency-Key": key or f"plan-{uuid.uuid4()}"})


def seed_plan(
    db: Session,
    user_id: uuid.UUID,
    *,
    status: PlanStatus = PlanStatus.active,
    days: int = 3,
) -> TrainingPlanRecord:
    """Insert a plan straight into the DB (for tests about things that reference plans)."""
    if db.get(User, user_id) is None:
        db.add(User(id=user_id))
        db.flush()
    chosen = VALID_PLAN["days"][:days]
    exercises = [
        {"day_of_week": d["day_of_week"], "position": i, **ex}
        for d in chosen
        for i, ex in enumerate(d["exercises"])
    ]
    review = status is PlanStatus.needs_review
    return repo.add(
        db,
        user_id=user_id,
        exercises=exercises,
        version=repo.next_version(db, user_id),
        status=status,
        idempotency_key=f"seed-{uuid.uuid4()}",
        prompt_version="plan-v1",
        provider="fake",
        model="openai/gpt-oss-120b",
        rationale=VALID_PLAN["rationale"],
        day_focus={d["day_of_week"]: d["focus"] for d in chosen},
        generation_metadata={},
        validation_issues=[{"code": "schema", "message": "x"}] if review else [],
    )
