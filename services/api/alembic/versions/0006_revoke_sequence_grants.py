"""revoke Supabase Data API role grants on public sequences (M3 security review L1)

Supabase grants `anon` and `authenticated` ALL on every new sequence in `public`. 0002 and the
table migrations revoked the table grants but not the identity sequence behind
`session_events.seq`, so a publishable-key holder could read and advance it (nextval/setval) over
the Data API. This revokes on every sequence in `public`, so sequences added later are covered
when they are migrated (tests/db/test_sequence_grants.py fails if one is missed).

The roles only exist on Supabase; on plain Postgres this is a no-op.

Revision ID: 0006
Revises: 0005
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Static SQL; identifiers are quoted by Postgres' format('%I').
_TEMPLATE = """
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('{action} ON ALL SEQUENCES IN SCHEMA public {direction} %I', r);
    END IF;
  END LOOP;
END $$
"""


def upgrade() -> None:
    op.execute(_TEMPLATE.replace("{action}", "REVOKE ALL").replace("{direction}", "FROM"))


def downgrade() -> None:
    # Supabase's default; re-granting keeps downgrade symmetric. RLS still default-denies rows.
    op.execute(_TEMPLATE.replace("{action}", "GRANT ALL").replace("{direction}", "TO"))
