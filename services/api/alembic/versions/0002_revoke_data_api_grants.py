"""revoke Supabase Data API role grants on app tables (M0 security review)

RLS (0001) already blocks anon/authenticated row access. Revoking their table privileges as
well covers statements RLS doesn't govern (e.g. TRUNCATE) and makes intent explicit. The
roles only exist on Supabase; on plain Postgres this is a no-op.

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Static SQL; identifiers are quoted by Postgres' format('%I').
_TEMPLATE = """
DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['users', 'member_profiles', 'gyms', 'gym_memberships',
                               'alembic_version'] LOOP
        EXECUTE format('{action} ON TABLE public.%I {direction} %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$
"""


def upgrade() -> None:
    op.execute(_TEMPLATE.replace("{action}", "REVOKE ALL").replace("{direction}", "FROM"))


def downgrade() -> None:
    # Supabase's defaults; re-granting keeps downgrade symmetric. RLS still default-denies.
    op.execute(_TEMPLATE.replace("{action}", "GRANT ALL").replace("{direction}", "TO"))
