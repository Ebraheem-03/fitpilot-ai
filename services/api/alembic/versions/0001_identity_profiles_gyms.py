"""identity, member profiles, gyms (M0 S2, FR-01)

RLS is enabled with no policies on every table: Supabase's Data API exposes `public`
to the publishable key, and the API (table owner) is the only intended client (ADR-0003).

Revision ID: 0001
Revises:
Create Date: 2026-10-27 23:47:27.235279
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

TABLES = ("users", "member_profiles", "gyms", "gym_memberships", "alembic_version")


revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "gyms",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_gyms")),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "member",
                "trainer",
                "gym_admin",
                "platform_admin",
                name="user_role",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            server_default="member",
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "active",
                "suspended",
                name="user_status",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            server_default="active",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    op.create_table(
        "gym_memberships",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("gym_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "active",
                "paused",
                "cancelled",
                name="membership_status",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            server_default="active",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["gym_id"], ["gyms.id"], name=op.f("fk_gym_memberships_gym_id_gyms"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_gym_memberships_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_gym_memberships")),
        sa.UniqueConstraint("gym_id", "user_id", name=op.f("uq_gym_memberships_gym_id_user_id")),
    )
    op.create_index(
        op.f("ix_gym_memberships_user_id"), "gym_memberships", ["user_id"], unique=False
    )
    op.create_table(
        "member_profiles",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "primary_goal",
            sa.Enum(
                "general_fitness",
                "strength",
                "muscle_gain",
                "fat_loss",
                "mobility",
                name="goal",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column(
            "experience_level",
            sa.Enum(
                "beginner",
                "intermediate",
                "advanced",
                name="experience_level",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            server_default="beginner",
            nullable=False,
        ),
        sa.Column("days_per_week", sa.SmallInteger(), nullable=True),
        sa.Column("session_minutes", sa.SmallInteger(), nullable=True),
        sa.Column(
            "equipment",
            sa.ARRAY(sa.String(length=32)),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "days_per_week BETWEEN 1 AND 7", name=op.f("ck_member_profiles_days_per_week_range")
        ),
        sa.CheckConstraint(
            "session_minutes BETWEEN 10 AND 180",
            name=op.f("ck_member_profiles_session_minutes_range"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_member_profiles_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_member_profiles")),
    )
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("ALTER TABLE alembic_version DISABLE ROW LEVEL SECURITY")
    op.drop_table("member_profiles")
    op.drop_index(op.f("ix_gym_memberships_user_id"), table_name="gym_memberships")
    op.drop_table("gym_memberships")
    op.drop_table("users")
    op.drop_table("gyms")
