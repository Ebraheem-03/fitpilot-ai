"""Plan generation holds no transaction during the LLM call (migration 0005).

The flow is claim (short transaction) -> provider call -> save (short transaction). These tests
cover the claim's guarantees: one generation per member, stale claims expire, every ending
releases the claim, and the session is idle while the provider runs.
"""

import uuid
from typing import Any

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, func, select, text
from sqlalchemy.orm import Session

from app.models import PlanGenerationClaim, PlanStatus, TrainingPlanRecord
from app.repositories import training_plans as repo
from app.services.llm import FakeProvider, FakeReply
from tests.conftest import alembic_config
from tests.db.plan_helpers import generate, llm, member, sub_of
from tests.db.test_training_plans import plan_count
from tests.llm_helpers import VALID_PLAN, plan

STALE_S = int(repo.CLAIM_STALE_AFTER.total_seconds())


def hold_claim(
    db: Session, user_id: uuid.UUID, *, age_s: int = 0, key: str = "other-key-0001"
) -> None:
    """Another request's claim on this member's generation slot, `age_s` seconds old."""
    db.execute(
        text(
            "INSERT INTO plan_generation_claims (user_id, idempotency_key, claimed_at) "
            "VALUES (:u, :k, clock_timestamp() - make_interval(secs => :age))"
        ),
        {"u": user_id, "k": key, "age": age_s},
    )
    db.flush()


def claims(db: Session, user_id: uuid.UUID) -> list[PlanGenerationClaim]:
    return list(
        db.scalars(select(PlanGenerationClaim).where(PlanGenerationClaim.user_id == user_id))
    )


class ProbingProvider:
    """Runs `probe` when the provider is called, then answers from a scripted fake."""

    name = "fake"

    def __init__(self, probe: Any, *replies: Any) -> None:
        self.probe = probe
        self.inner = FakeProvider(replies)
        self.probed = 0

    def complete(self, request: Any) -> Any:
        self.probe()
        self.probed += 1
        return self.inner.complete(request)


# --- one generation at a time ---------------------------------------------------------------


def test_a_fresh_claim_blocks_generation_and_is_left_alone(api: TestClient, db: Session) -> None:
    h = member(api)[1]
    sub = sub_of(h)
    hold_claim(db, sub, age_s=0)
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        r = generate(api, h)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "generation_in_progress"
    assert r.headers["retry-after"] == "5"
    assert fake.calls == [] and plan_count(db, sub) == 0
    assert [c.idempotency_key for c in claims(db, sub)] == ["other-key-0001"]


def test_a_claim_just_under_the_timeout_still_blocks(api: TestClient, db: Session) -> None:
    h = member(api)[1]
    hold_claim(db, sub_of(h), age_s=STALE_S - 30)
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        assert generate(api, h).status_code == 409
    assert fake.calls == []


def test_the_same_key_while_its_generation_runs_is_in_progress_not_a_second_call(
    api: TestClient, db: Session
) -> None:
    h = member(api)[1]
    hold_claim(db, sub_of(h), key="plan-key-0001")
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        assert generate(api, h, key="plan-key-0001").status_code == 409
    assert fake.calls == []


def test_claims_are_per_member(api: TestClient, db: Session) -> None:
    busy, free = member(api)[1], member(api)[1]
    hold_claim(db, sub_of(busy))
    with llm(FakeReply.ok(VALID_PLAN)):
        assert generate(api, free).status_code == 201


# --- a crash never leaves a permanent lock --------------------------------------------------


def test_a_stale_claim_is_taken_over(api: TestClient, db: Session) -> None:
    h = member(api)[1]
    sub = sub_of(h)
    hold_claim(db, sub, age_s=STALE_S + 60)
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        r = generate(api, h, key="plan-key-0002")
    assert r.status_code == 201
    assert len(fake.calls) == 1 and plan_count(db, sub) == 1
    assert claims(db, sub) == []  # the takeover's own claim is released on save


def test_a_worker_that_lost_its_claim_to_a_takeover_saves_nothing(
    api: TestClient, db: Session
) -> None:
    """A generation that overran the timeout must not save over the plan of the one that took
    the slot after it."""
    h = member(api)[1]
    sub = sub_of(h)

    def takeover() -> None:  # while our provider call runs, our claim goes stale and is replaced
        db.execute(
            text(
                "UPDATE plan_generation_claims SET idempotency_key = 'takeover-key-1', "
                "claimed_at = clock_timestamp() WHERE user_id = :u"
            ),
            {"u": sub},
        )
        db.commit()

    provider = ProbingProvider(takeover, FakeReply.ok(VALID_PLAN))
    with llm(provider=provider):
        r = generate(api, h, key="plan-key-0003")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "generation_in_progress"
    assert plan_count(db, sub) == 0
    assert [c.idempotency_key for c in claims(db, sub)] == ["takeover-key-1"]  # theirs, untouched


# --- every ending releases the claim --------------------------------------------------------


def test_the_claim_is_held_during_the_call_and_gone_after_a_valid_plan(
    api: TestClient, db: Session
) -> None:
    h = member(api)[1]
    sub = sub_of(h)
    seen: list[list[str]] = []
    provider = ProbingProvider(
        lambda: seen.append([c.idempotency_key for c in claims(db, sub)]),
        FakeReply.ok(VALID_PLAN),
    )
    with llm(provider=provider):
        assert generate(api, h, key="plan-key-0004").status_code == 201
    assert seen == [["plan-key-0004"]]
    assert claims(db, sub) == []


def test_the_claim_is_gone_after_a_needs_review_result(api: TestClient, db: Session) -> None:
    h = member(api)[1]
    sub = sub_of(h)
    bad = plan()
    bad["days"] = bad["days"][:2]
    with llm(FakeReply.ok(bad), FakeReply.ok(bad)):
        r = generate(api, h)
    assert r.status_code == 202 and r.json()["status"] == "needs_review"
    assert r.json()["plan"] is None  # a rejected draft is never shown as valid
    assert claims(db, sub) == []
    assert (
        db.scalar(select(TrainingPlanRecord.status).where(TrainingPlanRecord.user_id == sub))
        is PlanStatus.needs_review
    )


@pytest.mark.parametrize(
    ("reply", "code"),
    [(FakeReply.rate_limited(1715.0), "coach_busy"), (FakeReply.unavailable(), "ai_unavailable")],
)
def test_the_claim_is_gone_after_an_llm_failure_so_the_retry_can_run(
    api: TestClient, db: Session, reply: Any, code: str
) -> None:
    h = member(api)[1]
    sub = sub_of(h)
    with llm(reply):
        r = generate(api, h, key="plan-key-0005")
    assert r.status_code == 503 and r.json()["detail"]["code"] == code
    assert claims(db, sub) == [] and plan_count(db, sub) == 0
    with llm(FakeReply.ok(VALID_PLAN)):
        assert generate(api, h, key="plan-key-0005").status_code == 201


def test_the_claim_is_gone_after_an_unexpected_error(api: TestClient, db: Session) -> None:
    h = member(api)[1]
    sub = sub_of(h)

    def boom() -> None:
        raise RuntimeError("provider exploded")

    with llm(provider=ProbingProvider(boom)), pytest.raises(RuntimeError):
        generate(api, h)
    assert claims(db, sub) == []


def test_a_missing_profile_makes_no_claim(api: TestClient, db: Session) -> None:
    _, h = member(api, profile=None)
    with llm(FakeReply.ok(VALID_PLAN)):
        assert generate(api, h).status_code == 409
    assert db.scalar(select(func.count()).select_from(PlanGenerationClaim)) == 0


def test_a_replay_makes_no_claim_and_ignores_someone_elses(api: TestClient, db: Session) -> None:
    h = member(api)[1]
    sub = sub_of(h)
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        first = generate(api, h, key="plan-key-0006")
        hold_claim(db, sub)  # a later generation is running; the replay needs no slot
        again = generate(api, h, key="plan-key-0006")
    assert again.status_code == 200 and again.json() == first.json()
    assert len(fake.calls) == 1


# --- no transaction while the provider runs -------------------------------------------------


def test_the_session_is_idle_during_the_provider_call(api: TestClient, db: Session) -> None:
    h = member(api)[1]
    states: list[bool] = []
    provider = ProbingProvider(lambda: states.append(db.in_transaction()), FakeReply.ok(VALID_PLAN))
    with llm(provider=provider):
        assert generate(api, h).status_code == 201
    assert states == [False]


def test_the_session_is_idle_during_the_repair_call_too(api: TestClient, db: Session) -> None:
    h = member(api)[1]
    states: list[bool] = []
    bad = plan()
    bad["days"] = bad["days"][:2]
    provider = ProbingProvider(
        lambda: states.append(db.in_transaction()), FakeReply.ok(bad), FakeReply.ok(VALID_PLAN)
    )
    with llm(provider=provider):
        assert generate(api, h).status_code == 201
    assert states == [False, False]


# --- migration 0005 ---------------------------------------------------------------------------


def test_0005_round_trips_without_touching_plans(db_url: str) -> None:
    cfg = alembic_config(db_url)
    command.downgrade(cfg, "0004")
    eng = create_engine(db_url)
    try:
        with eng.connect() as conn:
            tables = set(
                conn.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))
            )
        assert "plan_generation_claims" not in tables
        assert {"training_plans", "planned_exercises"} <= tables
    finally:
        eng.dispose()
        command.upgrade(cfg, "head")


def test_claims_table_has_rls_and_no_data_api_grants(engine: Engine) -> None:
    with engine.connect() as conn:
        rls = conn.scalar(
            text("SELECT relrowsecurity FROM pg_class WHERE relname = 'plan_generation_claims'")
        )
        roles = list(
            conn.scalars(
                text("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")
            )
        )
        granted = [
            conn.scalar(
                text("SELECT has_table_privilege(:r, 'public.plan_generation_claims', 'SELECT')"),
                {"r": role},
            )
            for role in roles
        ]
    assert rls is True
    assert not any(granted)


def test_a_member_has_at_most_one_claim_and_it_goes_with_the_member(db: Session) -> None:
    user = uuid.uuid4()
    db.execute(text("INSERT INTO users (id) VALUES (:u)"), {"u": user})
    assert repo.try_claim_generation(db, user, "first-key-0001") is True
    assert repo.try_claim_generation(db, user, "second-key-0001") is False
    repo.release_claim(db, user, "second-key-0001")  # not the holder: no effect
    assert [c.idempotency_key for c in claims(db, user)] == ["first-key-0001"]
    db.execute(text("DELETE FROM users WHERE id = :u"), {"u": user})
    assert claims(db, user) == []
