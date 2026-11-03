"""Security L1 (migration 0006): the Supabase Data API roles hold no grant on any public sequence.

Supabase grants `anon`/`authenticated` ALL on new sequences, so `session_events_seq_seq` could be
read and advanced (nextval/setval) over PostgREST. The roles only exist on Supabase; to prove the
revoke on plain Postgres this simulates the Supabase default grant, runs 0006 down and up, and
removes any role it had to create.
"""

from alembic import command
from sqlalchemy import create_engine, text

from tests.conftest import alembic_config

ROLES = ("anon", "authenticated")

SEQUENCE_ACL = text(
    "SELECT c.relname, r.rolname FROM pg_class c "
    "JOIN pg_namespace n ON n.oid = c.relnamespace "
    "CROSS JOIN LATERAL aclexplode(c.relacl) a "
    "JOIN pg_roles r ON r.oid = a.grantee "
    "WHERE c.relkind = 'S' AND n.nspname = 'public' AND r.rolname IN ('anon', 'authenticated') "
    "ORDER BY 1, 2"
)


def test_no_data_api_role_has_a_grant_on_a_public_sequence(db_url: str) -> None:
    cfg = alembic_config(db_url)
    eng = create_engine(db_url, isolation_level="AUTOCOMMIT")
    created: list[str] = []

    def acl() -> list[tuple[str, str]]:
        with eng.connect() as conn:
            return [(name, role) for name, role in conn.execute(SEQUENCE_ACL).all()]

    try:
        with eng.connect() as conn:
            for role in ROLES:
                if not conn.scalar(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role}):
                    conn.execute(text(f"CREATE ROLE {role} NOLOGIN"))
                    created.append(role)
            for role in ROLES:
                conn.execute(text(f"GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO {role}"))
        assert ("session_events_seq_seq", "anon") in acl(), "simulated Supabase grant not applied"

        # 0006 up removes every grant, on every public sequence
        command.downgrade(cfg, "0005")
        command.upgrade(cfg, "head")
        assert acl() == []

        # reversible: down restores the Supabase default, up removes it again
        command.downgrade(cfg, "0005")
        assert ("session_events_seq_seq", "authenticated") in acl()
        command.upgrade(cfg, "head")
        assert acl() == []
    finally:
        with eng.connect() as conn:
            for role in ROLES:
                conn.execute(text(f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {role}"))
            for role in created:
                conn.execute(text(f"DROP ROLE IF EXISTS {role}"))
        eng.dispose()
