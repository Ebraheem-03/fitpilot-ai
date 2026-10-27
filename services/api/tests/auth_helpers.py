"""Mint Supabase-shaped ES256 access tokens offline (ADR-0003). No network, no Supabase."""

import time
import uuid
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

SUPABASE_URL = "https://test-ref.supabase.co"
ISSUER = SUPABASE_URL + "/auth/v1"
KID = "test-kid"
SIGNING_KEY = ec.generate_private_key(ec.SECP256R1())


class _FakeJWK:
    key = SIGNING_KEY.public_key()


class FakeJWKSClient:
    """Stands in for jwt.PyJWKClient: only knows the test key id."""

    def get_signing_key_from_jwt(self, token: str) -> _FakeJWK:
        if jwt.get_unverified_header(token).get("kid") != KID:
            raise jwt.PyJWKClientError("unknown kid")
        return _FakeJWK()


def claims(sub: uuid.UUID | str, **overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    base = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": ISSUER,
        "role": "authenticated",
        "iat": now,
        "exp": now + 300,
    }
    return {**base, **overrides}


def token_for(sub: uuid.UUID | str, *, kid: str = KID, **overrides: Any) -> str:
    return jwt.encode(
        claims(sub, **overrides), SIGNING_KEY, algorithm="ES256", headers={"kid": kid}
    )


def bearer(sub: uuid.UUID | str, **overrides: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {token_for(sub, **overrides)}"}
