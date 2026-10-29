"""S2 (#8): migrations are reversible, match the models, and lock down Supabase's Data API."""

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Engine, create_engine, text

from app.models import Base
from tests.conftest import alembic_config

EXPECTED_TABLES = {
    "users",
    "member_profiles",
    "gyms",
    "gym_memberships",
    "workout_sessions",
    "session_events",
    "performance_records",
}


def test_upgrade_downgrade_round_trip(db_url: str) -> None:
    cfg = alembic_config(db_url)
    command.downgrade(cfg, "base")
    eng = create_engine(db_url)
    try:
        with eng.connect() as conn:
            left = set(
                conn.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))
            )
        assert not (left & EXPECTED_TABLES), f"downgrade left tables behind: {left}"
    finally:
        eng.dispose()
        command.upgrade(cfg, "head")


def test_models_match_migrations(engine: Engine) -> None:
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == [], f"models and migrations drifted: {diff}"


def test_expected_tables_exist(engine: Engine) -> None:
    with engine.connect() as conn:
        tables = set(
            conn.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))
        )
    assert tables >= EXPECTED_TABLES


def test_rls_enabled_on_every_public_table(engine: Engine) -> None:
    """Supabase exposes `public` to the publishable key; RLS without policies = default-deny."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT c.relname, c.relrowsecurity FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND c.relkind = 'r'"
            )
        ).all()
    unprotected = sorted(name for name, rls in rows if not rls)
    assert rows and unprotected == [], f"tables without RLS: {unprotected}"
