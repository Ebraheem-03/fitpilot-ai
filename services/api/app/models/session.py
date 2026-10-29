"""Workout sessions, their events and per-exercise performance records (FR-07, ADR-0011).

Only derived data lives here: validated `SessionEvent` payloads and metrics computed from them.
Never frames, landmarks or per-frame values.
"""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, str_enum


class SessionStatus(StrEnum):
    started = "started"
    completed = "completed"


class SessionEventType(StrEnum):
    rep_completed = "rep_completed"
    feedback_shown = "feedback_shown"
    feedback_acknowledged = "feedback_acknowledged"
    feedback_dismissed = "feedback_dismissed"
    tracking_degraded = "tracking_degraded"
    set_completed = "set_completed"
    set_logged = "set_logged"
    exercise_skipped = "exercise_skipped"


class WorkoutSession(Timestamps, Base):
    """One workout a member did (or is doing). Owned by the member; `gym_id` is the tenant."""

    __tablename__ = "workout_sessions"
    __table_args__ = (
        CheckConstraint(
            "(status = 'completed') = (completed_at IS NOT NULL)", name="completed_at_iff_completed"
        ),
        CheckConstraint(
            "(status = 'completed') = (summary IS NOT NULL)", name="summary_iff_completed"
        ),
        CheckConstraint(
            "(training_plan_id IS NULL) = (plan_day_index IS NULL)", name="plan_ref_both_or_neither"
        ),
        CheckConstraint("plan_day_index BETWEEN 0 AND 30", name="plan_day_index_range"),
        CheckConstraint("perceived_difficulty BETWEEN 1 AND 10", name="perceived_difficulty_range"),
        UniqueConstraint("user_id", "start_idempotency_key"),
        Index("ix_workout_sessions_user_id_started_at", "user_id", text("started_at DESC")),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    # Tenant scoping. Null when the member has no (or more than one) active gym at start.
    gym_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("gyms.id", ondelete="SET NULL"), index=True
    )
    # Plans land in M3 S4; plain columns until then (no FK yet).
    training_plan_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    plan_day_index: Mapped[int | None] = mapped_column(SmallInteger)
    status: Mapped[SessionStatus] = mapped_column(
        str_enum(SessionStatus, "session_status"),
        default=SessionStatus.started,
        server_default="started",
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    perceived_difficulty: Mapped[int | None] = mapped_column(SmallInteger)
    note: Mapped[str | None] = mapped_column(Text)
    # SessionSummary JSON, written once at completion (computed from stored events only).
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    start_idempotency_key: Mapped[str | None] = mapped_column(String(128))


class SessionEventRow(Base):
    """A validated, de-duplicated `SessionEvent`. `payload` is the full event as validated."""

    __tablename__ = "session_events"
    __table_args__ = (
        UniqueConstraint("session_id", "idempotency_key"),
        Index("ix_session_events_session_id_occurred_at", "session_id", "occurred_at", "seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    # Arrival order: the tiebreak when two events share a timestamp.
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=False), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("workout_sessions.id", ondelete="CASCADE")
    )
    idempotency_key: Mapped[str] = mapped_column(String(128))
    type: Mapped[SessionEventType] = mapped_column(str_enum(SessionEventType, "session_event_type"))
    exercise_id: Mapped[str] = mapped_column(String(64))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)


class PerformanceRecord(Timestamps, Base):
    """Metrics for one exercise in one completed session. Derived from events, nothing else."""

    __tablename__ = "performance_records"
    __table_args__ = (
        UniqueConstraint("session_id", "exercise_id"),
        CheckConstraint(
            "avg_tracking_confidence BETWEEN 0 AND 1", name="avg_tracking_confidence_range"
        ),
        Index("ix_performance_records_user_id_exercise_id", "user_id", "exercise_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("workout_sessions.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    gym_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("gyms.id", ondelete="SET NULL"), index=True
    )
    exercise_id: Mapped[str] = mapped_column(String(64))
    skipped: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    tracked: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    set_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    total_reps: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    total_duration_s: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    # Mean of the confidence on counted reps; null when the camera counted nothing.
    avg_tracking_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    tracking_degraded_ms: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    cue_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    # {rule_id: times shown}
    cue_counts: Mapped[dict[str, int]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
