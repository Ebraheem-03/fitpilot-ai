"""S7 (#13): GET /users/me — the caller's own identity + app role, for the role-aware shell."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import User, UserRole
from tests.auth_helpers import bearer


def test_anonymous_is_401(api: TestClient) -> None:
    assert api.get("/api/v1/users/me").status_code == 401


def test_returns_only_the_callers_identity(api: TestClient, db: Session) -> None:
    trainer = uuid.uuid4()
    db.add(User(id=trainer, role=UserRole.trainer))
    db.flush()
    member = uuid.uuid4()

    assert api.get("/api/v1/users/me", headers=bearer(trainer)).json() == {
        "id": str(trainer),
        "role": "trainer",
    }
    assert api.get("/api/v1/users/me", headers=bearer(member)).json() == {
        "id": str(member),
        "role": "member",
    }
