"""S3 (#9): auth dependency — token verification + just-in-time provisioning (ADR-0007)."""

import secrets
import time
import uuid
from collections.abc import Iterator
from typing import Annotated

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, require_role
from app.core import security
from app.core.config import Settings, get_settings
from app.core.db import get_db
from app.models import User, UserRole, UserStatus
from tests.auth_helpers import KID, SUPABASE_URL, FakeJWKSClient, bearer, claims, token_for

probe = FastAPI()


@probe.get("/me")
def me(user: CurrentUser) -> dict[str, str]:
    return {"id": str(user.id), "role": user.role.value}


@probe.get("/admin")
def admin(
    user: Annotated[User, Depends(require_role(UserRole.platform_admin))],
) -> dict[str, str]:
    return {"id": str(user.id)}


@pytest.fixture
def client(db: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    probe.dependency_overrides[get_settings] = lambda: Settings(supabase_url=SUPABASE_URL)
    probe.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(security, "_jwks_client", lambda url: FakeJWKSClient())
    yield TestClient(probe)
    probe.dependency_overrides.clear()


def count_users(db: Session, sub: uuid.UUID) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.id == sub)) or 0


def test_first_request_provisions_member(client: TestClient, db: Session) -> None:
    sub = uuid.uuid4()
    r = client.get("/me", headers=bearer(sub))
    assert r.status_code == 200
    assert r.json() == {"id": str(sub), "role": "member"}
    assert count_users(db, sub) == 1


def test_provisioning_is_idempotent(client: TestClient, db: Session) -> None:
    sub = uuid.uuid4()
    for _ in range(3):
        assert client.get("/me", headers=bearer(sub)).status_code == 200
    assert count_users(db, sub) == 1


def test_role_comes_from_db_not_token_claims(client: TestClient) -> None:
    forged = {"role": "platform_admin", "app_metadata": {"role": "platform_admin"}}
    sub = uuid.uuid4()
    assert client.get("/me", headers=bearer(sub, **forged)).json()["role"] == "member"
    assert client.get("/admin", headers=bearer(sub, **forged)).status_code == 403


def test_role_guard_allows_granted_role(client: TestClient, db: Session) -> None:
    sub = uuid.uuid4()
    db.add(User(id=sub, role=UserRole.platform_admin))
    db.flush()
    assert client.get("/admin", headers=bearer(sub)).status_code == 200


def test_suspended_user_is_forbidden(client: TestClient, db: Session) -> None:
    sub = uuid.uuid4()
    db.add(User(id=sub, status=UserStatus.suspended))
    db.flush()
    assert client.get("/me", headers=bearer(sub)).status_code == 403


@pytest.mark.parametrize(
    "token",
    [
        None,
        "not-a-jwt",
        token_for(uuid.uuid4(), exp=int(time.time()) - 10),
        token_for(uuid.uuid4(), iss="https://evil.supabase.co/auth/v1"),
        token_for(uuid.uuid4(), aud="anon"),
        token_for(uuid.uuid4(), kid="rotated-away"),
        token_for("not-a-uuid"),
        # HS256 is never accepted, even with a "valid" shared secret (ADR-0003).
        jwt.encode(claims(uuid.uuid4()), secrets.token_urlsafe(32), algorithm="HS256"),
        jwt.encode(claims(uuid.uuid4()), None, algorithm="none"),
        # Signed by a different key that claims the trusted kid.
        jwt.encode(
            claims(uuid.uuid4()),
            ec.generate_private_key(ec.SECP256R1()),
            algorithm="ES256",
            headers={"kid": KID},
        ),
    ],
    ids=[
        "missing",
        "malformed",
        "expired",
        "issuer",
        "audience",
        "unknown-kid",
        "sub-not-uuid",
        "hs256",
        "alg-none",
        "forged-signature",
    ],
)
def test_bad_tokens_are_401_and_provision_nobody(
    client: TestClient, db: Session, token: str | None
) -> None:
    before = db.scalar(select(func.count()).select_from(User))
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = client.get("/me", headers=headers)
    assert r.status_code == 401
    assert r.headers.get("www-authenticate") == "Bearer"
    assert db.scalar(select(func.count()).select_from(User)) == before


def test_jwks_outage_is_503_not_401(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Down:
        def get_signing_key_from_jwt(self, token: str) -> None:
            raise jwt.PyJWKClientConnectionError("connection refused")

    monkeypatch.setattr(security, "_jwks_client", lambda url: Down())
    assert client.get("/me", headers=bearer(uuid.uuid4())).status_code == 503
