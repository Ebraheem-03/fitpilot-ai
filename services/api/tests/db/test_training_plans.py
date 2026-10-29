"""M3 S4: /training-plans (FR-02, FR-13, blueprint §7). Fake provider only, synthetic profiles.

FR-02 acceptance: "Given a supported member profile, the system produces a valid plan containing
catalogue-backed exercises and required parameters. Invalid output is rejected, repaired, or
escalated rather than silently accepted."
"""

import copy
import json
import logging
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.logging import JsonFormatter
from app.models import PlannedExerciseRecord, TrainingPlanRecord
from app.services.llm import FakeReply, ModelPrice, build_client, pricing
from app.services.plans.prompts import PROMPT_VERSION
from tests.db.plan_helpers import BEGINNER, GENERATE, PLANS, generate, llm, member, seed_plan
from tests.llm_helpers import PLANK, ROW, SQUAT, VALID_PLAN, plan

CURRENT = f"{PLANS}/current"


def plan_count(db: Session, user_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(TrainingPlanRecord)
            .where(TrainingPlanRecord.user_id == user_id)
        )
        or 0
    )


def events(caplog: pytest.LogCaptureFixture, name: str) -> list[dict[str, Any]]:
    fmt = JsonFormatter()
    out = [json.loads(fmt.format(r)) for r in caplog.records if r.name.startswith("fitpilot")]
    return [e for e in out if e["event"] == name]


# --- auth + preconditions ------------------------------------------------------------------


def test_anonymous_requests_are_401(api: TestClient) -> None:
    assert api.post(GENERATE, headers={"Idempotency-Key": "plan-key-0001"}).status_code == 401
    assert api.get(CURRENT).status_code == 401
    assert api.get(PLANS).status_code == 401
    assert api.get(f"{PLANS}/{uuid.uuid4()}").status_code == 401


def test_profile_is_required(api: TestClient) -> None:
    _, h = member(api, profile=None)
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        r = generate(api, h)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "profile_required"
    assert fake.calls == []


@pytest.mark.parametrize("key", [None, "short", "has spaces in it", "x" * 129])
def test_idempotency_key_is_required_and_well_formed(api: TestClient, key: str | None) -> None:
    _, h = member(api)
    headers = h if key is None else {**h, "Idempotency-Key": key}
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        assert api.post(GENERATE, headers=headers).status_code == 422
    assert fake.calls == []


# --- generate → validate → repair → escalate -----------------------------------------------


def test_valid_plan_is_created_active(api: TestClient, db: Session) -> None:
    sub, h = member(api)
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        r = generate(api, h)
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["status"], body["version"], body["validation_issues"]) == ("active", 1, [])
    assert body["prompt_version"] == PROMPT_VERSION == "plan-v1"
    assert body["model"] == "openai/gpt-oss-120b"
    assert body["plan"] == VALID_PLAN
    assert len(fake.calls) == 1
    assert api.get(CURRENT, headers=h).json() == body
    assert api.get(f"{PLANS}/{body['id']}", headers=h).json() == body

    row = db.get(TrainingPlanRecord, uuid.UUID(body["id"]))
    assert row is not None and row.user_id == sub
    meta = row.generation_metadata
    assert meta["result"] == "valid_first_try" and meta["provider"] == "fake"
    assert meta["inputs"]["days_per_week"] == 3 and len(meta["attempts"]) == 1
    exercises = db.scalar(
        select(func.count())
        .select_from(PlannedExerciseRecord)
        .where(PlannedExerciseRecord.plan_id == row.id)
    )
    assert exercises == 9


def test_invalid_then_valid_is_repaired_and_active(api: TestClient, db: Session) -> None:
    _, h = member(api)
    with llm(FakeReply.json_validate_failed(), FakeReply.ok(VALID_PLAN)) as (_, fake):
        r = generate(api, h)
    assert r.status_code == 201 and r.json()["status"] == "active"
    assert len(fake.calls) == 2
    row = db.get(TrainingPlanRecord, uuid.UUID(r.json()["id"]))
    assert row is not None
    assert row.generation_metadata["result"] == "repaired"
    assert row.generation_metadata["first_issue_codes"] == ["generation_failed"]


def _escalate(api: TestClient, h: dict[str, str], bad: dict[str, Any]) -> Any:
    with llm(FakeReply.ok(bad), FakeReply.ok(bad)) as (_, fake):
        r = generate(api, h)
    assert len(fake.calls) == 2  # one repair, then escalation
    return r


def test_still_invalid_after_repair_is_saved_as_needs_review(api: TestClient) -> None:
    _, h = member(api)
    bad = plan()
    bad["days"] = bad["days"][:1]
    r = _escalate(api, h, bad)
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "needs_review" and body["plan"] is None
    assert body["validation_issues"] == [
        {"code": "days_count", "message": "the plan has 1 training days; days_per_week is 3"}
    ]
    assert api.get(CURRENT, headers=h).status_code == 404  # never becomes the current plan
    assert [p["status"] for p in api.get(PLANS, headers=h).json()] == ["needs_review"]


def test_non_catalogue_exercise_is_rejected(api: TestClient, db: Session) -> None:
    _, h = member(api)
    bad = plan()
    bad["days"][0]["exercises"][0] = {**SQUAT, "exercise_id": "dragon_flag"}
    body = _escalate(api, h, bad).json()
    assert [i["code"] for i in body["validation_issues"]] == ["catalogue"]
    # the draft is kept for trainer review, never returned to the member
    row = db.get(TrainingPlanRecord, uuid.UUID(body["id"]))
    assert row is not None and "dragon_flag" in {e.exercise_id for e in row.exercises}
    assert "dragon_flag" not in json.dumps(api.get(PLANS, headers=h).json()[0]["plan"])


def test_equipment_violation_is_rejected(api: TestClient) -> None:
    _, h = member(api)  # no equipment
    bad = plan()
    bad["days"][0]["exercises"][0] = ROW
    issues = _escalate(api, h, bad).json()["validation_issues"]
    assert issues == [
        {
            "code": "equipment",
            "message": "monday: dumbbell_row needs dumbbells, which the member doesn't have",
        }
    ]


def test_session_length_overrun_is_rejected(api: TestClient) -> None:
    _, h = member(api)  # 30-minute sessions
    bad = plan()
    bad["days"][0]["exercises"] = [
        {**SQUAT, "sets": 6, "rest_s": 240},
        {**PLANK, "sets": 6, "rest_s": 240},
    ]
    issues = _escalate(api, h, bad).json()["validation_issues"]
    assert [i["code"] for i in issues] == ["session_length"]


def test_previous_active_plan_survives_an_escalated_regeneration(api: TestClient) -> None:
    _, h = member(api)
    with llm(FakeReply.ok(VALID_PLAN)):
        first = generate(api, h).json()
    bad = plan()
    bad["days"] = bad["days"][:2]
    review = _escalate(api, h, bad).json()
    assert review["version"] == 2
    assert api.get(CURRENT, headers=h).json()["id"] == first["id"]


# --- versions, supersede, idempotency ------------------------------------------------------


def test_same_idempotency_key_returns_the_same_plan_without_a_second_call(
    api: TestClient, db: Session
) -> None:
    sub, h = member(api)
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        first = generate(api, h, key="plan-key-0001")
        again = generate(api, h, key="plan-key-0001")
    assert first.status_code == 201 and again.status_code == 200
    assert again.headers["idempotent-replayed"] == "true"
    assert again.json() == first.json()
    assert len(fake.calls) == 1
    assert plan_count(db, sub) == 1


def test_regenerating_supersedes_the_active_plan(api: TestClient) -> None:
    _, h = member(api)
    other = copy.deepcopy(VALID_PLAN)
    other["rationale"] = "A second version."
    with llm(FakeReply.ok(VALID_PLAN), FakeReply.ok(other)) as (_, fake):
        v1 = generate(api, h).json()
        v2 = generate(api, h).json()
    assert len(fake.calls) == 2
    assert (v1["version"], v2["version"]) == (1, 2)
    assert api.get(CURRENT, headers=h).json()["id"] == v2["id"]
    listed = api.get(PLANS, headers=h).json()
    assert [(p["version"], p["status"]) for p in listed] == [(2, "active"), (1, "superseded")]
    old = api.get(f"{PLANS}/{v1['id']}", headers=h).json()
    assert old["status"] == "superseded" and old["plan"] == VALID_PLAN  # history kept, FR-02


def test_list_limit(api: TestClient) -> None:
    _, h = member(api)
    with llm(FakeReply.ok(VALID_PLAN)):
        for _ in range(3):
            generate(api, h)
    assert [p["version"] for p in api.get(PLANS, params={"limit": 2}, headers=h).json()] == [3, 2]
    assert api.get(PLANS, params={"limit": 0}, headers=h).status_code == 422


def test_generation_in_progress_is_409(api: TestClient, engine: Engine) -> None:
    sub, h = member(api)
    with engine.connect() as other:  # another request holding this member's generation lock
        other.execute(text("SELECT pg_advisory_xact_lock(4202, hashtext(:u))"), {"u": str(sub)})
        with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
            r = generate(api, h)
        other.rollback()
    assert r.status_code == 409 and r.json()["detail"]["code"] == "generation_in_progress"
    assert r.headers["retry-after"] == "5"
    assert fake.calls == []


# --- authorization ---------------------------------------------------------------------------


def test_another_member_cannot_see_or_reach_a_plan(api: TestClient) -> None:
    _, owner = member(api)
    _, other = member(api)
    with llm(FakeReply.ok(VALID_PLAN)):
        mine = generate(api, owner, key="shared-key-0001").json()
    assert api.get(f"{PLANS}/{mine['id']}", headers=other).status_code == 404
    assert api.get(f"{PLANS}/{mine['id']}", headers=other).json()["detail"]["code"] == (
        "plan_not_found"
    )
    assert api.get(CURRENT, headers=other).status_code == 404
    assert api.get(PLANS, headers=other).json() == []
    # the same key is scoped per member: the other member gets their own plan, not mine
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        theirs = generate(api, other, key="shared-key-0001")
    assert theirs.status_code == 201 and theirs.json()["id"] != mine["id"]
    assert len(fake.calls) == 1


# --- LLM failures ------------------------------------------------------------------------------


def test_daily_cap_429_is_coach_busy_and_logged(
    api: TestClient, db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    sub, h = member(api)
    caplog.set_level(logging.INFO)
    with llm(FakeReply.rate_limited(1715.0)) as (_, fake):
        r = generate(api, h)
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "coach_busy"
    assert r.headers["retry-after"] == "1715"
    assert len(fake.calls) == 1 and plan_count(db, sub) == 0

    (call,) = events(caplog, "llm.call")
    assert (call["outcome"], call["reason"], call["prompt_version"]) == (
        "busy",
        "rate_limited",
        "plan-v1",
    )
    (failed,) = events(caplog, "plan.generation_failed")
    assert (failed["reason"], failed["cause"], failed["user_id"]) == (
        "coach_busy",
        "rate_limited",
        str(sub),
    )


def test_budget_refused_is_ai_unavailable(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A paid model with LLM_MONTHLY_BUDGET_USD=0 is refused before any call (fail closed)."""
    sub, h = member(api)
    monkeypatch.setitem(pricing.GROQ_PRICES, "test/paid", ModelPrice(1.0, 1.0, billed=True))
    from app.services.llm import FakeProvider

    inner = FakeProvider([FakeReply.ok(VALID_PLAN)])

    class Groq:
        name = "groq"

        def complete(self, request: Any) -> Any:
            return inner.complete(request)

    with llm(provider=Groq(), model="test/paid", monthly_budget_usd=0.0):
        r = generate(api, h)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "ai_unavailable"
    assert inner.calls == [] and plan_count(db, sub) == 0


# --- defaults, the fake planner, privacy -----------------------------------------------------


def test_unset_schedule_uses_the_documented_defaults(api: TestClient, db: Session) -> None:
    _, h = member(api, profile={"primary_goal": "mobility", "equipment": ["mat"]})
    from app.main import app
    from app.services.llm import get_llm_client

    # the client LLM_PROVIDER=fake builds: the rule-based fake planner answers
    app.dependency_overrides[get_llm_client] = lambda: build_client(Settings(llm_provider="fake"))
    try:
        r = generate(api, h)
    finally:
        app.dependency_overrides.pop(get_llm_client, None)
    assert r.status_code == 201, r.text
    assert len(r.json()["plan"]["days"]) == 3
    row = db.get(TrainingPlanRecord, uuid.UUID(r.json()["id"]))
    assert row is not None
    assert row.generation_metadata["inputs"]["session_minutes"] == 45
    assert row.generation_metadata["inputs"]["defaults_applied"] == [
        "days_per_week",
        "session_minutes",
    ]


def test_logs_carry_no_profile_values_or_plan_text(
    api: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    profile = {**BEGINNER, "primary_goal": "fat_loss", "equipment": ["kettlebell"]}
    _, h = member(api, profile=profile)
    caplog.set_level(logging.DEBUG)
    bad = plan()
    bad["days"] = bad["days"][:1]
    with llm(FakeReply.ok(bad), FakeReply.ok(VALID_PLAN)):
        r = generate(api, h, key="secret-idempotency-key")
        api.get(CURRENT, headers=h)
        api.get(f"{PLANS}/{r.json()['id']}", headers=h)

    fmt = JsonFormatter()
    out = "\n".join(fmt.format(rec) for rec in caplog.records if not rec.name.startswith("httpx"))
    for secret in (
        "fat_loss",
        "kettlebell",
        "secret-idempotency-key",
        VALID_PLAN["rationale"],
        SQUAT["progression"],
        "bodyweight_squat",
        "Full body",
        "Member profile",
    ):
        assert secret not in out, secret
    generated = events(caplog, "plan.generated")[0]
    assert generated["result"] == "repaired" and generated["first_issue_codes"] == ["days_count"]
    assert generated["tokens_in"] > 0 and generated["prompt_version"] == "plan-v1"


def test_escalation_is_a_diagnosable_event(
    api: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    _, h = member(api)
    caplog.set_level(logging.INFO)
    bad = plan()
    bad["days"][0]["exercises"][0] = ROW
    body = _escalate(api, h, bad).json()
    (event,) = events(caplog, "plan.escalated")
    assert event["plan_id"] == body["id"] and event["level"] == "warning"
    assert event["issue_codes"] == ["equipment"] and event["attempts"] == 2


def test_seeded_plans_read_back_through_the_api(api: TestClient, db: Session) -> None:
    sub, h = member(api)
    seeded = seed_plan(db, sub, days=2)
    body = api.get(f"{PLANS}/{seeded.id}", headers=h).json()
    assert [d["day_of_week"] for d in body["plan"]["days"]] == ["monday", "wednesday"]
