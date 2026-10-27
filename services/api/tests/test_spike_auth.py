"""SPIKE (S0, #6): prove pytest can mint valid Supabase-shaped tokens offline."""

import secrets
import time
from collections.abc import Iterator
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.core import security
from app.core.config import Settings, get_settings
from app.main import app

SUPABASE_URL = "https://test-ref.supabase.co"
ISS = SUPABASE_URL + "/auth/v1"
HS_SECRET = secrets.token_urlsafe(32)
EC_KEY = ec.generate_private_key(ec.SECP256R1())


class _FakeJWK:
    key = EC_KEY.public_key()


class _FakeJWKSClient:
    def get_signing_key_from_jwt(self, token: str) -> _FakeJWK:
        if jwt.get_unverified_header(token).get("kid") != "test-kid":
            raise jwt.PyJWKClientError("unknown kid")
        return _FakeJWK()


def _claims(**over: Any) -> dict[str, Any]:
    now = int(time.time())
    base = {"sub": "user-a", "aud": "authenticated", "iss": ISS, "role": "authenticated"}
    return {**base, "iat": now, "exp": now + 300, **over}


def es256(**over: Any) -> str:
    return jwt.encode(_claims(**over), EC_KEY, algorithm="ES256", headers={"kid": "test-kid"})


def hs256(secret: str = HS_SECRET, **over: Any) -> str:
    return jwt.encode(_claims(**over), secret, algorithm="HS256")


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    settings = Settings(supabase_url=SUPABASE_URL, supabase_jwt_secret=HS_SECRET)
    app.dependency_overrides[get_settings] = lambda: settings
    monkeypatch.setattr(security, "_jwks_client", lambda url: _FakeJWKSClient())
    yield TestClient(app)
    app.dependency_overrides.clear()


def whoami(client: TestClient, token: str | None) -> Any:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.get("/api/v1/spike/whoami", headers=headers)


def test_es256_token_accepted(client: TestClient) -> None:
    r = whoami(client, es256())
    assert r.status_code == 200
    assert r.json() == {"sub": "user-a", "alg": "ES256", "session_role": "authenticated"}


def test_hs256_legacy_token_accepted(client: TestClient) -> None:
    assert whoami(client, hs256()).json()["alg"] == "HS256"


@pytest.mark.parametrize(
    "token",
    [
        None,
        "not-a-jwt",
        es256(exp=int(time.time()) - 10),
        es256(iss="https://evil.supabase.co/auth/v1"),
        es256(aud="anon"),
        hs256(secret=secrets.token_urlsafe(32)),
        jwt.encode(_claims(), EC_KEY, algorithm="ES256", headers={"kid": "other"}),
        jwt.encode(_claims(), None, algorithm="none"),
    ],
    ids=["missing", "malformed", "expired", "issuer", "audience", "bad-hs-sig", "kid", "alg-none"],
)
def test_bad_tokens_rejected(client: TestClient, token: str | None) -> None:
    assert whoami(client, token).status_code == 401
