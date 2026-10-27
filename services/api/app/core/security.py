"""Verify Supabase access tokens against the project's JWKS (ADR-0003).

Only asymmetric algorithms are accepted; there is no shared secret anywhere in the API.
"""

import uuid
from dataclasses import dataclass
from functools import lru_cache

import jwt

from app.core.config import Settings

AUDIENCE = "authenticated"
ALLOWED_ALGS = ("ES256", "RS256")
JWKS_CACHE_SECONDS = 600  # matches Supabase's edge cache so key rotation still propagates


class InvalidToken(Exception):
    """Token rejected. The message is a short reason code, safe to log (never the token)."""


@dataclass(frozen=True)
class VerifiedToken:
    sub: uuid.UUID


def issuer(settings: Settings) -> str:
    if not settings.supabase_url:
        raise InvalidToken("auth_not_configured")
    return settings.supabase_url.rstrip("/") + "/auth/v1"


@lru_cache
def _jwks_client(jwks_url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=JWKS_CACHE_SECONDS)


def verify_access_token(token: str, settings: Settings) -> VerifiedToken:
    try:
        alg = jwt.get_unverified_header(token).get("alg")
    except jwt.PyJWTError as e:
        raise InvalidToken("malformed") from e
    if alg not in ALLOWED_ALGS:
        raise InvalidToken("unsupported_alg")

    iss = issuer(settings)
    try:
        key = _jwks_client(iss + "/.well-known/jwks.json").get_signing_key_from_jwt(token).key
    except jwt.PyJWTError as e:
        raise InvalidToken("unknown_key") from e

    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=list(ALLOWED_ALGS),
            audience=AUDIENCE,
            issuer=iss,
            options={"require": ["exp", "sub", "iss", "aud"]},
        )
    except jwt.ExpiredSignatureError as e:
        raise InvalidToken("expired") from e
    except jwt.PyJWTError as e:
        raise InvalidToken("invalid_claims_or_signature") from e

    try:
        return VerifiedToken(sub=uuid.UUID(payload["sub"]))
    except ValueError as e:
        raise InvalidToken("invalid_sub") from e
