"""revoke Supabase's default Data API grants on future tables and sequences (M3 close-out)

0006 revoked `anon`/`authenticated` on the sequences that existed when it ran; Supabase's default
privileges still grant them ALL on every table and sequence created afterwards, so each new
migration had to remember its own REVOKE. This removes those defaults for objects created by the
migrating role in `public`, so new tables and sequences start with no Data API grant at all.
Explicit REVOKEs in table migrations stay as belt and braces.

The roles only exist on Supabase; on plain Postgres this is a no-op.

Revision ID: 0007
Revises: 0006
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Static SQL; identifiers are quoted by Postgres' format('%I').
_TEMPLATE = """
DO $$
DECLARE r text; k text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH k IN ARRAY ARRAY['TABLES', 'SEQUENCES'] LOOP
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES IN SCHEMA public {action} ON %s {direction} %I', k, r
        );
      END LOOP;
    END IF;
  END LOOP;
END $$
"""


def upgrade() -> None:
    op.execute(_TEMPLATE.replace("{action}", "REVOKE ALL").replace("{direction}", "FROM"))


def downgrade() -> None:
    # Supabase's default; re-granting keeps downgrade symmetric. RLS still default-denies rows.
    op.execute(_TEMPLATE.replace("{action}", "GRANT ALL").replace("{direction}", "TO"))
