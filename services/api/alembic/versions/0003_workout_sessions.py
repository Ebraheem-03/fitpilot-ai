"""workout sessions, session events, performance records, tracking consent (M3 S6, FR-07)

Same posture as 0001/0002: RLS enabled with no policies and the Data API roles' grants revoked.
The API (table owner) is the only intended client (ADR-0003). `training_plan_id` has no FK yet:
plans land in M3 S4.

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("workout_sessions", "session_events", "performance_records")

_REVOKE = """
DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['workout_sessions', 'session_events',
                               'performance_records'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$
"""

_NOW = sa.text("now()")
_UUID = sa.text("gen_random_uuid()")

_EVENT_TYPES = (
    "rep_completed",
    "feedback_shown",
    "feedback_acknowledged",
    "feedback_dismissed",
    "tracking_degraded",
    "set_completed",
    "set_logged",
    "exercise_skipped",
)


def upgrade() -> None:
    op.add_column(
        "member_profiles",
        sa.Column("tracking_data_consent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "member_profiles",
        sa.Column("tracking_data_consent_version", sa.SmallInteger(), nullable=True),
    )
    op.create_check_constraint(
        op.f("ck_member_profiles_tracking_consent_both_or_neither"),
        "member_profiles",
        "(tracking_data_consent_at IS NULL) = (tracking_data_consent_version IS NULL)",
    )

    op.create_table(
        "workout_sessions",
        sa.Column("id", sa.Uuid(), server_default=_UUID, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("gym_id", sa.Uuid(), nullable=True),
        sa.Column("training_plan_id", sa.Uuid(), nullable=True),
        sa.Column("plan_day_index", sa.SmallInteger(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "started",
                "completed",
                name="session_status",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            server_default="started",
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("perceived_difficulty", sa.SmallInteger(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("start_idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.CheckConstraint(
            "(status = 'completed') = (completed_at IS NOT NULL)",
            name=op.f("ck_workout_sessions_completed_at_iff_completed"),
        ),
        sa.CheckConstraint(
            "(status = 'completed') = (summary IS NOT NULL)",
            name=op.f("ck_workout_sessions_summary_iff_completed"),
        ),
        sa.CheckConstraint(
            "(training_plan_id IS NULL) = (plan_day_index IS NULL)",
            name=op.f("ck_workout_sessions_plan_ref_both_or_neither"),
        ),
        sa.CheckConstraint(
            "plan_day_index BETWEEN 0 AND 30", name=op.f("ck_workout_sessions_plan_day_index_range")
        ),
        sa.CheckConstraint(
            "perceived_difficulty BETWEEN 1 AND 10",
            name=op.f("ck_workout_sessions_perceived_difficulty_range"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_workout_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["gym_id"],
            ["gyms.id"],
            name=op.f("fk_workout_sessions_gym_id_gyms"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workout_sessions")),
        sa.UniqueConstraint(
            "user_id",
            "start_idempotency_key",
            name=op.f("uq_workout_sessions_user_id_start_idempotency_key"),
        ),
    )
    op.create_index(op.f("ix_workout_sessions_gym_id"), "workout_sessions", ["gym_id"])
    op.create_index(
        "ix_workout_sessions_user_id_started_at",
        "workout_sessions",
        ["user_id", sa.literal_column("started_at DESC")],
    )

    op.create_table(
        "session_events",
        sa.Column("id", sa.Uuid(), server_default=_UUID, nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                *_EVENT_TYPES,
                name="session_event_type",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("exercise_id", sa.String(length=64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["workout_sessions.id"],
            name=op.f("fk_session_events_session_id_workout_sessions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_session_events")),
        sa.UniqueConstraint(
            "session_id",
            "idempotency_key",
            name=op.f("uq_session_events_session_id_idempotency_key"),
        ),
    )
    op.create_index(
        "ix_session_events_session_id_occurred_at",
        "session_events",
        ["session_id", "occurred_at", "seq"],
    )

    op.create_table(
        "performance_records",
        sa.Column("id", sa.Uuid(), server_default=_UUID, nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("gym_id", sa.Uuid(), nullable=True),
        sa.Column("exercise_id", sa.String(length=64), nullable=False),
        sa.Column("skipped", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("tracked", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("set_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("total_reps", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("total_duration_s", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("avg_tracking_confidence", sa.Numeric(precision=4, scale=3), nullable=True),
        sa.Column(
            "tracking_degraded_ms", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column("cue_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "cue_counts",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.CheckConstraint(
            "avg_tracking_confidence BETWEEN 0 AND 1",
            name=op.f("ck_performance_records_avg_tracking_confidence_range"),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["workout_sessions.id"],
            name=op.f("fk_performance_records_session_id_workout_sessions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_performance_records_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["gym_id"],
            ["gyms.id"],
            name=op.f("fk_performance_records_gym_id_gyms"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_performance_records")),
        sa.UniqueConstraint(
            "session_id", "exercise_id", name=op.f("uq_performance_records_session_id_exercise_id")
        ),
    )
    op.create_index(
        op.f("ix_performance_records_session_id"), "performance_records", ["session_id"]
    )
    op.create_index(op.f("ix_performance_records_gym_id"), "performance_records", ["gym_id"])
    op.create_index(
        "ix_performance_records_user_id_exercise_id",
        "performance_records",
        ["user_id", "exercise_id"],
    )

    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(_REVOKE)


def downgrade() -> None:
    # Dropping the tables drops their RLS state and grants with them.
    op.drop_table("performance_records")
    op.drop_table("session_events")
    op.drop_table("workout_sessions")
    op.drop_constraint(
        op.f("ck_member_profiles_tracking_consent_both_or_neither"),
        "member_profiles",
        type_="check",
    )
    op.drop_column("member_profiles", "tracking_data_consent_version")
    op.drop_column("member_profiles", "tracking_data_consent_at")
