"""Migration 0004 (M3 S4): plan tables, their invariants in the DB, and the sessions FK."""

import uuid

import pytest
from alembic import command
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import PlanStatus, User, WorkoutSession
from tests.conftest import alembic_config
from tests.db.plan_helpers import seed_plan

PLAN_TABLES = ("training_plans", "planned_exercises")


def test_0004_round_trips_without_touching_sessions(db_url: str) -> None:
    cfg = alembic_config(db_url)
    command.downgrade(cfg, "0003")
    eng = create_engine(db_url)
    try:
        with eng.connect() as conn:
            tables = set(
                conn.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))
            )
            fks = set(
                conn.scalars(
                    text(
                        "SELECT conname FROM pg_constraint "
                        "WHERE conrelid = 'workout_sessions'::regclass AND contype = 'f'"
                    )
                )
            )
        assert not tables & set(PLAN_TABLES)
        assert "workout_sessions" in tables
        assert "fk_workout_sessions_training_plan_id_training_plans" not in fks
    finally:
        eng.dispose()
        command.upgrade(cfg, "head")


def _violates(db: Session, sql: str, **params: object) -> bool:
    try:
        with db.begin_nested():
            db.execute(text(sql), params)
    except IntegrityError:
        return True
    return False


def test_one_active_plan_per_member(db: Session) -> None:
    user = uuid.uuid4()
    seed_plan(db, user)
    with pytest.raises(IntegrityError), db.begin_nested():
        seed_plan(db, user)
    seed_plan(db, user, status=PlanStatus.needs_review)  # any number of these
    seed_plan(db, uuid.uuid4())  # other members are independent


def test_version_is_unique_per_member(db: Session) -> None:
    user = uuid.uuid4()
    first = seed_plan(db, user)
    assert _violates(
        db,
        "INSERT INTO training_plans (user_id, version, status, idempotency_key, prompt_version, "
        "provider, model) VALUES (:u, :v, 'superseded', 'other-key-0001', 'plan-v1', 'fake', 'm')",
        u=user,
        v=first.version,
    )


def test_planned_exercise_needs_exactly_one_of_reps_or_duration(db: Session) -> None:
    plan = seed_plan(db, uuid.uuid4())
    insert = (
        "INSERT INTO planned_exercises (plan_id, day_of_week, position, exercise_id, sets, reps, "
        "duration_s, rest_s, progression) VALUES (:p, 'sunday', 0, 'plank', 3, :r, :d, 60, 'x')"
    )
    assert _violates(db, insert, p=plan.id, r=10, d=30)
    assert _violates(db, insert, p=plan.id, r=None, d=None)
    assert not _violates(db, insert, p=plan.id, r=None, d=30)


def test_deleting_a_member_removes_plans_and_sessions_that_follow_them(db: Session) -> None:
    user = uuid.uuid4()
    plan = seed_plan(db, user)
    db.add(WorkoutSession(user_id=user, training_plan_id=plan.id, plan_day_index=0))
    db.flush()
    db.execute(text("DELETE FROM users WHERE id = :u"), {"u": user})
    left = db.execute(
        text(
            "SELECT (SELECT count(*) FROM training_plans WHERE user_id = :u) + "
            "(SELECT count(*) FROM planned_exercises WHERE plan_id = :p) + "
            "(SELECT count(*) FROM workout_sessions WHERE user_id = :u)"
        ),
        {"u": user, "p": plan.id},
    ).scalar()
    assert left == 0


def test_a_plan_a_session_follows_cannot_be_deleted(db: Session) -> None:
    """NO ACTION: plans are history; only member deletion removes them (migration 0004)."""
    user = uuid.uuid4()
    plan = seed_plan(db, user)
    db.add(WorkoutSession(user_id=user, training_plan_id=plan.id, plan_day_index=0))
    db.flush()
    assert _violates(db, "DELETE FROM training_plans WHERE id = :p", p=plan.id)


def test_session_cannot_reference_a_missing_plan(db: Session) -> None:
    user = uuid.uuid4()
    db.add(User(id=user))
    db.flush()
    assert _violates(
        db,
        "INSERT INTO workout_sessions (user_id, training_plan_id, plan_day_index) "
        "VALUES (:u, :p, 0)",
        u=user,
        p=uuid.uuid4(),
    )


def test_delete_rules(connection: Connection) -> None:
    rules = dict(
        connection.execute(
            text(
                "SELECT conrelid::regclass::text || '.' || a.attname, confdeltype "
                "FROM pg_constraint c JOIN pg_attribute a "
                "ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] "
                "WHERE contype = 'f' AND conrelid::regclass::text = ANY(:t)"
            ),
            {"t": [*PLAN_TABLES, "workout_sessions"]},
        ).all()
    )
    assert rules["training_plans.user_id"] == "c"
    assert rules["planned_exercises.plan_id"] == "c"
    assert rules["workout_sessions.training_plan_id"] == "a"  # NO ACTION


def test_plan_tables_are_indexed_on_their_scoping_columns(engine: Engine) -> None:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT t.relname, a.attname FROM pg_index i "
                "JOIN pg_class t ON t.oid = i.indrelid "
                "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0] "
                "WHERE t.relname = ANY(:tables)"
            ),
            {"tables": [*PLAN_TABLES, "workout_sessions"]},
        ).all()
    assert {
        ("training_plans", "user_id"),
        ("planned_exercises", "plan_id"),
        ("workout_sessions", "training_plan_id"),
    } <= {(t, c) for t, c in rows}


def test_data_api_roles_have_no_grants_on_plan_tables(engine: Engine) -> None:
    with engine.connect() as conn:
        roles = list(
            conn.scalars(
                text("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")
            )
        )
        for role in roles:  # no-op on plain Postgres
            for table in PLAN_TABLES:
                granted = conn.scalar(
                    text("SELECT has_table_privilege(:r, :t, 'SELECT')"),
                    {"r": role, "t": f"public.{table}"},
                )
                assert granted is False
