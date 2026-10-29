"""DB access for training plans. Every query is scoped by `user_id`: there is no lookup by plan id
alone, so another member's plan can't be read by guessing its id."""

import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import PlannedExerciseRecord, PlanStatus, TrainingPlanRecord

# First key of pg_try_advisory_xact_lock(int, int): "plan generation" (arbitrary, app-unique).
_GENERATION_LOCK_NS = 4202


def try_lock_generation(db: Session, user_id: uuid.UUID) -> bool:
    """One generation at a time per member, held until the transaction ends (commit/rollback).
    Re-entrant for the same transaction."""
    acquired = db.scalar(
        select(func.pg_try_advisory_xact_lock(_GENERATION_LOCK_NS, func.hashtext(str(user_id))))
    )
    return bool(acquired)


def get_by_idempotency_key(db: Session, user_id: uuid.UUID, key: str) -> TrainingPlanRecord | None:
    return db.scalar(
        select(TrainingPlanRecord).where(
            TrainingPlanRecord.user_id == user_id, TrainingPlanRecord.idempotency_key == key
        )
    )


def get_owned(db: Session, user_id: uuid.UUID, plan_id: uuid.UUID) -> TrainingPlanRecord | None:
    return db.scalar(
        select(TrainingPlanRecord).where(
            TrainingPlanRecord.user_id == user_id, TrainingPlanRecord.id == plan_id
        )
    )


def get_active(db: Session, user_id: uuid.UUID) -> TrainingPlanRecord | None:
    return db.scalar(
        select(TrainingPlanRecord).where(
            TrainingPlanRecord.user_id == user_id,
            TrainingPlanRecord.status == PlanStatus.active,
        )
    )


def list_owned(db: Session, user_id: uuid.UUID, limit: int) -> list[TrainingPlanRecord]:
    return list(
        db.scalars(
            select(TrainingPlanRecord)
            .where(TrainingPlanRecord.user_id == user_id)
            .order_by(TrainingPlanRecord.version.desc())
            .limit(limit)
        )
    )


def next_version(db: Session, user_id: uuid.UUID) -> int:
    current = db.scalar(
        select(func.max(TrainingPlanRecord.version)).where(TrainingPlanRecord.user_id == user_id)
    )
    return (current or 0) + 1


def supersede_active(db: Session, user_id: uuid.UUID) -> None:
    db.execute(
        update(TrainingPlanRecord)
        .where(
            TrainingPlanRecord.user_id == user_id,
            TrainingPlanRecord.status == PlanStatus.active,
        )
        .values(status=PlanStatus.superseded)
        .execution_options(synchronize_session="fetch")
    )


def add(
    db: Session,
    *,
    user_id: uuid.UUID,
    exercises: list[dict[str, Any]],
    **fields: Any,
) -> TrainingPlanRecord:
    plan = TrainingPlanRecord(user_id=user_id, **fields)
    plan.exercises = [PlannedExerciseRecord(**e) for e in exercises]
    db.add(plan)
    db.flush()
    return plan
