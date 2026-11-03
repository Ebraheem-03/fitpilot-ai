"""Real-concurrency test kit: committed data, one database session per request (as in production),
and N threads released together. The rollback-per-test `api` fixture can't show races, because
all its requests share one connection and one transaction.

Everything a test creates is committed, so `LiveApi.cleanup` deletes the users it made (ON DELETE
CASCADE removes their profiles, sessions, events, plans and claims) even when the test fails.
"""

import threading
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core import security
from app.core.config import Settings, get_settings
from app.core.db import get_db
from app.main import app
from tests.auth_helpers import SUPABASE_URL, FakeJWKSClient, bearer
from tests.db.plan_helpers import BEGINNER, PROFILE
from tests.db.session_helpers import CONSENT

TIMEOUT_S = 30


class LiveApi:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        self.users: list[uuid.UUID] = []

    def client(self) -> TestClient:
        """A client of its own: one per thread."""
        return TestClient(app)

    def member(self) -> dict[str, str]:
        """A new member with a profile and tracking consent; returns their auth headers."""
        sub = uuid.uuid4()
        self.users.append(sub)
        headers = bearer(sub)
        client = self.client()
        assert client.post(PROFILE, json=BEGINNER, headers=headers).status_code == 201
        assert client.put(CONSENT, json={"version": 1}, headers=headers).status_code == 200
        return headers

    def scalar(self, sql: str, **params: Any) -> Any:
        with self.engine.connect() as conn:
            return conn.scalar(text(sql), params)

    def cleanup(self) -> None:
        with self.engine.begin() as conn:
            conn.execute(text("DELETE FROM users WHERE id = ANY(:ids)"), {"ids": self.users})


@pytest.fixture
def live(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[LiveApi]:
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    def real_db() -> Iterator[Session]:
        with factory() as session:
            yield session

    app.dependency_overrides[get_settings] = lambda: Settings(supabase_url=SUPABASE_URL)
    app.dependency_overrides[get_db] = real_db
    monkeypatch.setattr(security, "_jwks_client", lambda url: FakeJWKSClient())
    kit = LiveApi(engine)
    try:
        yield kit
    finally:
        app.dependency_overrides.clear()
        kit.cleanup()


def run_together[T](n: int, work: Callable[[int], T]) -> list[T]:
    """Run `work(i)` on n threads that all start at the same moment; results in thread order."""
    barrier = threading.Barrier(n)

    def go(i: int) -> T:
        barrier.wait(TIMEOUT_S)
        return work(i)

    with ThreadPoolExecutor(max_workers=n) as pool:
        futures = [pool.submit(go, i) for i in range(n)]
        return [f.result(TIMEOUT_S) for f in futures]


@contextmanager
def gate() -> Iterator[threading.Event]:
    """An event that is always set on exit, so a failed assertion can't leave threads blocked."""
    event = threading.Event()
    try:
        yield event
    finally:
        event.set()
