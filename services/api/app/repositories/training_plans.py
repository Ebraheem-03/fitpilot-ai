"""DB access for training plans. Every query is scoped by `user_id`: there is no lookup by plan id
alone, so another member's plan can't be read by guessing its id."""

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import DateTime, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import PlanGenerationClaim, PlannedExerciseRecord, PlanStatus, TrainingPlanRecord

# A claim this old is assumed to belong to a dead worker and may be taken over. Longer than the
# slowest legitimate generation (two provider calls, each up to LLM_TIMEOUT_S = 60 s, plus one
# in-request 429 wait of up to 10 s).
CLAIM_STALE_AFTER = timedelta(minutes=3)


def _now() -> Any:
    # clock_timestamp(), not now(): now() is the transaction's start, which in a long-lived
    # session (or a test's outer transaction) is not "now".
    return func.clock_timestamp(type_=DateTime(timezone=True))


def try_claim_generation(
    db: Session,
    user_id: uuid.UUID,
    key: str,
    stale_after: timedelta = CLAIM_STALE_AFTER,
) -> bool:
    """Claim the member's one generation slot for `key`. False when another generation holds it
    and its claim is not stale. Commit to make the claim visible to other requests."""
    claimed_at = PlanGenerationClaim.claimed_at
    stmt = (
        insert(PlanGenerationClaim)
        .values(user_id=user_id, idempotency_key=key, claimed_at=_now())
        .on_conflict_do_update(
            index_elements=["user_id"],
            set_={"idempotency_key": key, "claimed_at": _now()},
            where=claimed_at < _now() - stale_after,
        )
        .returning(PlanGenerationClaim.user_id)
    )
    return db.execute(stmt).scalar_one_or_none() is not None


def lock_own_claim(db: Session, user_id: uuid.UUID, key: str) -> bool:
    """Lock the claim row if `key` still holds it (not taken over after going stale). Serialises
    the member's saves until the transaction ends."""
    held = db.scalar(
        select(PlanGenerationClaim.user_id)
        .where(PlanGenerationClaim.user_id == user_id, PlanGenerationClaim.idempotency_key == key)
        .with_for_update()
    )
    return held is not None


def release_claim(db: Session, user_id: uuid.UUID, key: str) -> None:
    """Drop the claim, only if `key` still holds it (never a takeover's claim)."""
    db.execute(
        delete(PlanGenerationClaim).where(
            PlanGenerationClaim.user_id == user_id, PlanGenerationClaim.idempotency_key == key
        )
    )


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
