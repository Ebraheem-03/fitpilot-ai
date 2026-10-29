"""Workout-session persistence. Every lookup is scoped by the owning `user_id`; there is no way to
fetch a session by id alone. No business rules here."""

import uuid
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import (
    GymMembership,
    MembershipStatus,
    PerformanceRecord,
    SessionEventRow,
    SessionEventType,
    SessionStatus,
    WorkoutSession,
)


def active_gym_ids(db: Session, user_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(GymMembership.gym_id).where(
                GymMembership.user_id == user_id,
                GymMembership.status == MembershipStatus.active,
            )
        )
    )


def get_owned(
    db: Session, user_id: uuid.UUID, session_id: uuid.UUID, *, for_update: bool = False
) -> WorkoutSession | None:
    stmt = select(WorkoutSession).where(
        WorkoutSession.id == session_id, WorkoutSession.user_id == user_id
    )
    if for_update:
        # Serialises event ingestion against completion: no event lands after the summary.
        # populate_existing: the identity map may hold a stale copy from earlier in the request.
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    return db.scalars(stmt).one_or_none()


def get_by_start_key(db: Session, user_id: uuid.UUID, key: str) -> WorkoutSession | None:
    return db.scalars(
        select(WorkoutSession).where(
            WorkoutSession.user_id == user_id, WorkoutSession.start_idempotency_key == key
        )
    ).one_or_none()


def add(
    db: Session,
    *,
    user_id: uuid.UUID,
    gym_id: uuid.UUID | None,
    training_plan_id: uuid.UUID | None,
    plan_day_index: int | None,
    start_idempotency_key: str | None,
) -> WorkoutSession | None:
    """Insert a session. None when `start_idempotency_key` already belongs to one of the user's
    sessions (a concurrent or repeated start): the caller fetches that one instead."""
    stmt = (
        insert(WorkoutSession)
        .values(
            user_id=user_id,
            gym_id=gym_id,
            training_plan_id=training_plan_id,
            plan_day_index=plan_day_index,
            start_idempotency_key=start_idempotency_key,
            # Not the column default (now() = transaction start): two starts must order by time.
            started_at=datetime.now(UTC),
        )
        .on_conflict_do_nothing(index_elements=["user_id", "start_idempotency_key"])
        .returning(WorkoutSession.id)
    )
    new_id = db.execute(stmt).scalar_one_or_none()
    if new_id is None:
        return None
    return db.get(WorkoutSession, new_id)


def list_page(
    db: Session, user_id: uuid.UUID, limit: int, offset: int
) -> tuple[Sequence[WorkoutSession], int]:
    total = db.scalar(
        select(func.count()).select_from(WorkoutSession).where(WorkoutSession.user_id == user_id)
    )
    rows = db.scalars(
        select(WorkoutSession)
        .where(WorkoutSession.user_id == user_id)
        .order_by(WorkoutSession.started_at.desc(), WorkoutSession.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return rows, total or 0


def delete_session(db: Session, session: WorkoutSession) -> None:
    """Events and performance records go with it (ON DELETE CASCADE)."""
    db.delete(session)
    db.flush()


# --- events ----------------------------------------------------------------------------------


def count_events(db: Session, session_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(SessionEventRow)
            .where(SessionEventRow.session_id == session_id)
        )
        or 0
    )


def existing_keys(db: Session, session_id: uuid.UUID, keys: Iterable[str]) -> set[str]:
    return set(
        db.scalars(
            select(SessionEventRow.idempotency_key).where(
                SessionEventRow.session_id == session_id,
                SessionEventRow.idempotency_key.in_(list(keys)),
            )
        )
    )


def shown_cue_keys(db: Session, session_id: uuid.UUID) -> set[tuple[str, str, str]]:
    """(exercise_id, rule_id, message_id) of every `feedback_shown` stored for the session."""
    rows = db.execute(
        select(
            SessionEventRow.exercise_id,
            SessionEventRow.payload["rule_id"].astext,
            SessionEventRow.payload["message_id"].astext,
        ).where(
            SessionEventRow.session_id == session_id,
            SessionEventRow.type == SessionEventType.feedback_shown,
        )
    ).all()
    return {(exercise_id, rule_id, message_id) for exercise_id, rule_id, message_id in rows}


def insert_events(db: Session, rows: list[dict[str, Any]]) -> int:
    """Insert events, skipping any whose (session, idempotency_key) is already stored.
    Returns how many were actually stored."""
    if not rows:
        return 0
    stmt = (
        insert(SessionEventRow)
        .values(rows)
        .on_conflict_do_nothing(index_elements=["session_id", "idempotency_key"])
        .returning(SessionEventRow.id)
    )
    return len(db.execute(stmt).all())


def stored_events(db: Session, session_id: uuid.UUID) -> Sequence[SessionEventRow]:
    return db.scalars(
        select(SessionEventRow)
        .where(SessionEventRow.session_id == session_id)
        .order_by(SessionEventRow.occurred_at, SessionEventRow.seq)
    ).all()


# --- completion ------------------------------------------------------------------------------


def mark_completed(
    db: Session,
    session: WorkoutSession,
    *,
    completed_at: datetime,
    perceived_difficulty: int | None,
    note: str | None,
    summary: dict[str, Any],
) -> None:
    session.status = SessionStatus.completed
    session.completed_at = completed_at
    session.perceived_difficulty = perceived_difficulty
    session.note = note
    session.summary = summary
    db.flush()


def add_performance_records(db: Session, records: Iterable[PerformanceRecord]) -> None:
    db.add_all(list(records))
    db.flush()
