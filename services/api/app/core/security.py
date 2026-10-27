"""SPIKE (S0, #6): verify Supabase access tokens. Asymmetric (JWKS) first, HS256 legacy fallback."""

from dataclasses import dataclass
from functools import lru_cache

import jwt

from app.core.config import Settings

AUDIENCE = "authenticated"
ASYMMETRIC_ALGS = ("ES256", "RS256")


class InvalidToken(Exception):
    pass


@dataclass(frozen=True)
class Claims:
    sub: str
    alg: str
    session_role: str


def issuer(settings: Settings) -> str:
    if not settings.supabase_url:
        raise InvalidToken("SUPABASE_URL not configured")
    return settings.supabase_url.rstrip("/") + "/auth/v1"


@lru_cache
def _jwks_client(jwks_url: str) -> jwt.PyJWKClient:
    # PyJWKClient caches keys in-process; Supabase's edge caches JWKS for 10 min.
    return jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=600)


def verify_access_token(token: str, settings: Settings) -> Claims:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as e:
        raise InvalidToken("malformed") from e

    alg = header.get("alg")
    iss = issuer(settings)
    key: object
    if alg in ASYMMETRIC_ALGS:
        try:
            key = _jwks_client(iss + "/.well-known/jwks.json").get_signing_key_from_jwt(token).key
        except jwt.PyJWTError as e:
            raise InvalidToken("unknown signing key") from e
    elif alg == "HS256" and settings.supabase_jwt_secret:
        key = settings.supabase_jwt_secret
    else:
        raise InvalidToken(f"unsupported alg {alg!r}")

    try:
        payload = jwt.decode(
            token,
            key,  # type: ignore[arg-type]
            algorithms=[alg],
            audience=AUDIENCE,
            issuer=iss,
            options={"require": ["exp", "sub", "iss", "aud"]},
        )
    except jwt.PyJWTError as e:
        raise InvalidToken(type(e).__name__) from e

    return Claims(sub=payload["sub"], alg=alg, session_role=payload.get("role", ""))
