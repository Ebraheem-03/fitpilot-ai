"""training plans + planned exercises; workout_sessions.training_plan_id FK (M3 S4, FR-02)

Same posture as 0001 to 0003: RLS enabled with no policies and the Data API roles' grants revoked.
The API (table owner) is the only intended client (ADR-0003).

Lifecycle (ADR-0004 amendment): `version` counts generations per member; at most one `active`
plan per member (partial unique index); a new active plan supersedes the old one.

`workout_sessions.training_plan_id` gets the FK 0003 deferred, with the default ON DELETE NO
ACTION, not SET NULL:
- SET NULL would null `training_plan_id` alone and break 0003's
  `plan_ref_both_or_neither` check. Postgres only allows FK columns in a `SET NULL (…)` list, so
  `plan_day_index` can't be cleared with it.
- Plans are history (FR-02: versioned, never overwritten) and are only deleted with their member,
  whose sessions go in the same statement. NO ACTION is checked at the end of that statement, so
  member deletion works (tests/db/test_plans_migration.py) and deleting a plan a session follows
  is refused.

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("training_plans", "planned_exercises")

_REVOKE = """
DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['training_plans', 'planned_exercises'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$
"""

_NOW = sa.text("now()")
_UUID = sa.text("gen_random_uuid()")
_WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def upgrade() -> None:
    op.create_table(
        "training_plans",
        sa.Column("id", sa.Uuid(), server_default=_UUID, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "active",
                "needs_review",
                "superseded",
                name="plan_status",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("prompt_version", sa.String(length=64), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("rationale", sa.String(length=600), nullable=True),
        sa.Column(
            "day_focus",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "generation_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "validation_issues",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.CheckConstraint("version >= 1", name=op.f("ck_training_plans_version_positive")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_training_plans_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_training_plans")),
        sa.UniqueConstraint(
            "user_id", "idempotency_key", name=op.f("uq_training_plans_user_id_idempotency_key")
        ),
        sa.UniqueConstraint("user_id", "version", name=op.f("uq_training_plans_user_id_version")),
    )
    op.create_index(
        "uq_training_plans_one_active_per_member",
        "training_plans",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_table(
        "planned_exercises",
        sa.Column("id", sa.Uuid(), server_default=_UUID, nullable=False),
        sa.Column("plan_id", sa.Uuid(), nullable=False),
        sa.Column(
            "day_of_week",
            sa.Enum(
                *_WEEKDAYS,
                name="day_of_week",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("exercise_id", sa.String(length=64), nullable=False),
        sa.Column("sets", sa.SmallInteger(), nullable=False),
        sa.Column("reps", sa.SmallInteger(), nullable=True),
        sa.Column("duration_s", sa.SmallInteger(), nullable=True),
        sa.Column("rest_s", sa.SmallInteger(), nullable=False),
        sa.Column("progression", sa.String(length=200), nullable=False),
        sa.CheckConstraint(
            "(reps IS NULL) <> (duration_s IS NULL)",
            name=op.f("ck_planned_exercises_reps_xor_duration"),
        ),
        sa.CheckConstraint("position >= 0", name=op.f("ck_planned_exercises_position_nonnegative")),
        sa.CheckConstraint("sets BETWEEN 1 AND 6", name=op.f("ck_planned_exercises_sets_range")),
        sa.CheckConstraint("reps BETWEEN 1 AND 30", name=op.f("ck_planned_exercises_reps_range")),
        sa.CheckConstraint(
            "duration_s BETWEEN 10 AND 180", name=op.f("ck_planned_exercises_duration_s_range")
        ),
        sa.CheckConstraint(
            "rest_s BETWEEN 15 AND 240", name=op.f("ck_planned_exercises_rest_s_range")
        ),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["training_plans.id"],
            name=op.f("fk_planned_exercises_plan_id_training_plans"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_planned_exercises")),
        sa.UniqueConstraint(
            "plan_id",
            "day_of_week",
            "position",
            name=op.f("uq_planned_exercises_plan_id_day_of_week_position"),
        ),
    )
    op.create_index(op.f("ix_planned_exercises_plan_id"), "planned_exercises", ["plan_id"])

    # Sessions created before this migration may point at plan ids that never existed (0003 had no
    # FK and no ownership check). Clear those references so the FK can be added.
    op.execute(
        "UPDATE workout_sessions SET training_plan_id = NULL, plan_day_index = NULL "
        "WHERE training_plan_id IS NOT NULL"
    )
    op.create_foreign_key(
        op.f("fk_workout_sessions_training_plan_id_training_plans"),
        "workout_sessions",
        "training_plans",
        ["training_plan_id"],
        ["id"],
        # NO ACTION (default): see the module docstring.
    )
    op.create_index(
        op.f("ix_workout_sessions_training_plan_id"), "workout_sessions", ["training_plan_id"]
    )

    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(_REVOKE)


def downgrade() -> None:
    op.drop_index(op.f("ix_workout_sessions_training_plan_id"), table_name="workout_sessions")
    op.drop_constraint(
        op.f("fk_workout_sessions_training_plan_id_training_plans"),
        "workout_sessions",
        type_="foreignkey",
    )
    # Dropping the tables drops their RLS state and grants with them.
    op.drop_index(op.f("ix_planned_exercises_plan_id"), table_name="planned_exercises")
    op.drop_table("planned_exercises")
    op.drop_index("uq_training_plans_one_active_per_member", table_name="training_plans")
    op.drop_table("training_plans")
