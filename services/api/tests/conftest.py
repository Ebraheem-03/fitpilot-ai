"""Integration-test database: a dedicated local Postgres DB, migrated with Alembic once per session.

Each test runs inside a transaction that is rolled back, so tests never see each other's rows.
Only local hosts are allowed — the developer's .env may point DATABASE_URL at hosted Supabase.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, Engine, create_engine, make_url, text
from sqlalchemy.orm import Session

API_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEST_DB = "postgresql+psycopg://fitpilot:fitpilot@localhost:5432/fitpilot_test"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "db"}


def test_database_url() -> str:
    url = make_url(os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DB))
    if url.host not in LOCAL_HOSTS:
        raise RuntimeError(f"Refusing to run DB tests against non-local host {url.host!r}")
    return url.render_as_string(hide_password=False)


test_database_url.__test__ = False  # type: ignore[attr-defined]  # not a pytest test


def alembic_config(url: str) -> Config:
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    cfg.attributes["database_url"] = url
    return cfg


def _ensure_database(url: str) -> None:
    target = make_url(url)
    admin = create_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            exists = conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": target.database}
            )
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{target.database}"'))
    except Exception as e:  # pragma: no cover - environment problem, not a test failure
        raise RuntimeError("Postgres not reachable. Run `make db` (Docker) first.") from e
    finally:
        admin.dispose()


@pytest.fixture(scope="session")
def db_url() -> str:
    url = test_database_url()
    _ensure_database(url)
    command.upgrade(alembic_config(url), "head")
    return url


@pytest.fixture(scope="session")
def engine(db_url: str) -> Iterator[Engine]:
    eng = create_engine(db_url)
    yield eng
    eng.dispose()


@pytest.fixture
def connection(engine: Engine) -> Iterator[Connection]:
    with engine.connect() as conn:
        trans = conn.begin()
        yield conn
        trans.rollback()


@pytest.fixture
def db(connection: Connection) -> Iterator[Session]:
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    yield session
    session.close()
