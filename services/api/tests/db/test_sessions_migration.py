"""Migration 0003 (M3 S6): reversible, indexed on scoping columns, locked down like 0001/0002."""

from alembic import command
from sqlalchemy import Engine, create_engine, text

from tests.conftest import alembic_config

SESSION_TABLES = ("workout_sessions", "session_events", "performance_records")


def test_0003_round_trips_without_touching_earlier_tables(db_url: str) -> None:
    cfg = alembic_config(db_url)
    command.downgrade(cfg, "0002")
    eng = create_engine(db_url)
    try:
        with eng.connect() as conn:
            tables = set(
                conn.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))
            )
            cols = set(
                conn.scalars(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'member_profiles'"
                    )
                )
            )
        assert not tables & set(SESSION_TABLES)
        assert {"users", "member_profiles", "gyms", "gym_memberships"} <= tables
        assert not {c for c in cols if c.startswith("tracking_data_consent")}
    finally:
        eng.dispose()
        command.upgrade(cfg, "head")


def test_consent_columns_exist(engine: Engine) -> None:
    with engine.connect() as conn:
        cols = set(
            conn.scalars(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'member_profiles'"
                )
            )
        )
    assert {"tracking_data_consent_at", "tracking_data_consent_version"} <= cols


def test_scoping_columns_are_indexed(engine: Engine) -> None:
    """Every scoping column is the leading column of some index (tenant + owner lookups)."""
    expected = {
        ("workout_sessions", "user_id"),
        ("workout_sessions", "gym_id"),
        ("session_events", "session_id"),
        ("performance_records", "session_id"),
        ("performance_records", "gym_id"),
        ("performance_records", "user_id"),
    }
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT t.relname, a.attname FROM pg_index i "
                "JOIN pg_class t ON t.oid = i.indrelid "
                "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0] "
                "WHERE t.relname = ANY(:tables)"
            ),
            {"tables": list(SESSION_TABLES)},
        ).all()
    assert expected <= {(t, c) for t, c in rows}


def test_session_data_is_removed_with_its_owner_and_session(engine: Engine) -> None:
    """ON DELETE CASCADE: events and records can never outlive their session."""
    with engine.connect() as conn:
        rules = dict(
            conn.execute(
                text(
                    "SELECT conrelid::regclass::text || '.' || a.attname, confdeltype "
                    "FROM pg_constraint c JOIN pg_attribute a "
                    "ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] "
                    "WHERE contype = 'f' AND conrelid::regclass::text = ANY(:t)"
                ),
                {"t": list(SESSION_TABLES)},
            ).all()
        )
    assert rules["session_events.session_id"] == "c"
    assert rules["performance_records.session_id"] == "c"
    assert rules["workout_sessions.user_id"] == "c"
    assert rules["workout_sessions.gym_id"] == "n"  # a closed gym must not delete member history


def test_data_api_roles_have_no_grants_on_session_tables(engine: Engine) -> None:
    with engine.connect() as conn:
        roles = list(
            conn.scalars(
                text("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")
            )
        )
        for role in roles:  # no-op on plain Postgres
            for table in SESSION_TABLES:
                granted = conn.scalar(
                    text("SELECT has_table_privilege(:r, :t, 'SELECT')"),
                    {"r": role, "t": f"public.{table}"},
                )
                assert granted is False
