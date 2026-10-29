"""Training plans and their exercises (FR-02, blueprint §6). Versioned per member, never
overwritten: a new active plan supersedes the previous one, and every version stays readable.

At most one `active` plan per member (partial unique index). `needs_review` plans keep the
rejected draft's exercises (if it parsed) for trainer review (M5); the member API never shows them.
"""

import uuid
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Timestamps, str_enum


class PlanStatus(StrEnum):
    active = "active"
    needs_review = "needs_review"
    superseded = "superseded"


class Weekday(StrEnum):
    monday = "monday"
    tuesday = "tuesday"
    wednesday = "wednesday"
    thursday = "thursday"
    friday = "friday"
    saturday = "saturday"
    sunday = "sunday"


class TrainingPlanRecord(Timestamps, Base):
    __tablename__ = "training_plans"
    __table_args__ = (
        UniqueConstraint("user_id", "version"),
        UniqueConstraint("user_id", "idempotency_key"),
        CheckConstraint("version >= 1", name="version_positive"),
        Index(
            "uq_training_plans_one_active_per_member",
            "user_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    # 1, 2, 3… per member: one per generation, needs_review ones included
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[PlanStatus] = mapped_column(str_enum(PlanStatus, "plan_status"))
    # Idempotency-Key of the generate request that created it (blueprint §7)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    prompt_version: Mapped[str] = mapped_column(String(64))
    provider: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(128))
    # null when nothing parsed (needs_review without a draft)
    rationale: Mapped[str | None] = mapped_column(String(600))
    # {"monday": "Full body", …}: TrainingDay.focus per day
    day_focus: Mapped[dict[str, str]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    # PlanDraft.metadata(): inputs, attempts, tokens, latency, cost. Never prompt or model text.
    generation_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb")
    )
    # [{"code", "message"}]: why it needs review; empty for active/superseded
    validation_issues: Mapped[list[dict[str, str]]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )

    exercises: Mapped[list["PlannedExerciseRecord"]] = relationship(
        back_populates="plan",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PlannedExerciseRecord.position",
        lazy="selectin",
    )


class PlannedExerciseRecord(Base):
    __tablename__ = "planned_exercises"
    __table_args__ = (
        UniqueConstraint("plan_id", "day_of_week", "position"),
        CheckConstraint("(reps IS NULL) <> (duration_s IS NULL)", name="reps_xor_duration"),
        CheckConstraint("position >= 0", name="position_nonnegative"),
        CheckConstraint("sets BETWEEN 1 AND 6", name="sets_range"),
        CheckConstraint("reps BETWEEN 1 AND 30", name="reps_range"),
        CheckConstraint("duration_s BETWEEN 10 AND 180", name="duration_s_range"),
        CheckConstraint("rest_s BETWEEN 15 AND 240", name="rest_s_range"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("training_plans.id", ondelete="CASCADE"), index=True
    )
    day_of_week: Mapped[Weekday] = mapped_column(str_enum(Weekday, "day_of_week"))
    # order within the day
    position: Mapped[int] = mapped_column(SmallInteger)
    # catalogue id (not an FK: the catalogue is versioned files, data/exercise-catalog)
    exercise_id: Mapped[str] = mapped_column(String(64))
    sets: Mapped[int] = mapped_column(SmallInteger)
    reps: Mapped[int | None] = mapped_column(SmallInteger)
    duration_s: Mapped[int | None] = mapped_column(SmallInteger)
    rest_s: Mapped[int] = mapped_column(SmallInteger)
    progression: Mapped[str] = mapped_column(String(200))

    plan: Mapped[TrainingPlanRecord] = relationship(back_populates="exercises")
