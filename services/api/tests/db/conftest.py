from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import Settings, get_settings
from app.core.db import get_db
from app.main import app
from tests.auth_helpers import SUPABASE_URL, FakeJWKSClient


@pytest.fixture
def api(db: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """The real app, bound to the per-test transaction and offline token verification."""
    app.dependency_overrides[get_settings] = lambda: Settings(supabase_url=SUPABASE_URL)
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(security, "_jwks_client", lambda url: FakeJWKSClient())
    yield TestClient(app)
    app.dependency_overrides.clear()
