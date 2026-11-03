"""M3 close-out (security M2): a member may generate PLAN_GENERATIONS_PER_DAY plans per rolling
24 h. Past it: 429 `plan_limit_reached` with Retry-After, no LLM call, no row. A replay of an
existing Idempotency-Key is not a generation and is always allowed."""

import uuid
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import PlanStatus, TrainingPlanRecord
from app.services.llm import FakeReply
from tests.auth_helpers import SUPABASE_URL
from tests.db.plan_helpers import generate, llm, member, seed_plan
from tests.llm_helpers import VALID_PLAN

DAY_S = 24 * 3600


def rows(db: Session, user_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(TrainingPlanRecord)
            .where(TrainingPlanRecord.user_id == user_id)
        )
        or 0
    )


def test_the_default_is_five_a_day() -> None:
    assert Settings().plan_generations_per_day == 5


def test_the_sixth_generation_in_a_day_is_429_with_no_call_and_no_row(
    api: TestClient, db: Session
) -> None:
    sub, h = member(api)
    with llm(*[FakeReply.ok(VALID_PLAN)] * 6) as (_, fake):
        for i in range(5):
            assert generate(api, h, key=f"plan-key-000{i}").status_code in (200, 201)
        assert len(fake.calls) == 5
        r = generate(api, h, key="plan-key-0005")
        assert len(fake.calls) == 5  # no LLM call
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == "plan_limit_reached"
    assert 0 < int(r.headers["retry-after"]) <= DAY_S
    assert rows(db, sub) == 5  # no row saved


def test_a_replay_of_the_fifth_key_still_returns_200(api: TestClient, db: Session) -> None:
    sub, h = member(api)
    with llm(*[FakeReply.ok(VALID_PLAN)] * 5) as (_, fake):
        for i in range(5):
            generate(api, h, key=f"plan-key-000{i}")
        again = generate(api, h, key="plan-key-0004")
        assert generate(api, h, key="plan-key-0009").status_code == 429
        assert len(fake.calls) == 5
    assert again.status_code == 200
    assert again.headers["idempotent-replayed"] == "true"
    assert rows(db, sub) == 5


def test_retry_after_is_the_time_until_the_oldest_row_ages_out(
    api: TestClient, db: Session
) -> None:
    sub, h = member(api)
    for _ in range(5):
        seed_plan(db, sub, status=PlanStatus.superseded)
    # the oldest was made 23 h ago; the others are recent
    db.execute(
        update(TrainingPlanRecord)
        .where(TrainingPlanRecord.user_id == sub, TrainingPlanRecord.version == 1)
        .values(created_at=func.clock_timestamp() - timedelta(hours=23))
    )
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        r = generate(api, h)
    assert r.status_code == 429 and fake.calls == []
    assert 3500 <= int(r.headers["retry-after"]) <= 3600  # about an hour


def test_rows_older_than_a_day_do_not_count(api: TestClient, db: Session) -> None:
    sub, h = member(api)
    for _ in range(5):
        seed_plan(db, sub, status=PlanStatus.superseded)
    db.execute(
        update(TrainingPlanRecord)
        .where(TrainingPlanRecord.user_id == sub, TrainingPlanRecord.version <= 2)
        .values(created_at=func.clock_timestamp() - timedelta(hours=25))
    )
    with llm(FakeReply.ok(VALID_PLAN)):
        assert generate(api, h).status_code == 201


def test_needs_review_rows_count_too(api: TestClient, db: Session) -> None:
    sub, h = member(api)
    for _ in range(5):
        seed_plan(db, sub, status=PlanStatus.needs_review)
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        assert generate(api, h).status_code == 429
    assert fake.calls == []


def test_the_cap_is_per_member_and_configurable(api: TestClient) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        supabase_url=SUPABASE_URL, plan_generations_per_day=1
    )
    _, mine = member(api)
    _, other = member(api)
    with llm(*[FakeReply.ok(VALID_PLAN)] * 3) as (_, fake):
        assert generate(api, mine).status_code == 201
        assert generate(api, mine).status_code == 429
        assert generate(api, other).status_code == 201  # not affected by my usage
        assert len(fake.calls) == 2
