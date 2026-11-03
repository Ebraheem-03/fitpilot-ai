"""plan_generation_claims: one in-flight plan generation per member, without a held transaction

Plan generation calls an LLM for up to a minute or more. The previous design held a transaction
(and its pooled connection) with an advisory lock for the whole call. Now a short transaction
inserts a claim row, commits, the provider is called with no session open, and a second short
transaction saves the plan and deletes the claim.

- One row per member (primary key `user_id`) is what makes "one generation at a time" true.
- A claim older than the stale timeout (app/repositories/training_plans.py, 3 minutes) can be
  taken over, so a crashed or killed worker never leaves a permanent lock.
- `idempotency_key` records which request holds the claim, so a worker that overran the timeout
  and lost its claim can tell before saving.
- Scoping: plans are per member (not gym-owned), so the scoping column is `user_id`, the primary
  key. No separate index is needed.

Same posture as 0001 to 0004: RLS enabled with no policies and the Data API roles' grants revoked.

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_REVOKE = """
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.plan_generation_claims FROM %I', r);
    END IF;
  END LOOP;
END $$
"""


def upgrade() -> None:
    op.create_table(
        "plan_generation_claims",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column(
            "claimed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_plan_generation_claims_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_plan_generation_claims")),
    )
    op.execute("ALTER TABLE plan_generation_claims ENABLE ROW LEVEL SECURITY")
    op.execute(_REVOKE)


def downgrade() -> None:
    # Dropping the table drops its RLS state and grants with it.
    op.drop_table("plan_generation_claims")
