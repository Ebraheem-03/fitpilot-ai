"""JWKS client hardening (M0 review): unknown-kid floods and Supabase outages."""

import uuid
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app.core import security
from app.core.config import Settings
from tests.auth_helpers import KID, SIGNING_KEY, SUPABASE_URL, token_for

SETTINGS = Settings(supabase_url=SUPABASE_URL)


class CountingClient(jwt.PyJWKClient):
    """Real PyJWKClient (real caching/cooldown logic) with the HTTP fetch stubbed out."""

    def __init__(self, uri: str, **kwargs: Any) -> None:
        super().__init__(uri, **kwargs)
        self.fetches = 0

    def fetch_data(self) -> Any:
        self.fetches += 1
        jwk = jwt.algorithms.ECAlgorithm.to_jwk(SIGNING_KEY.public_key(), as_dict=True)
        data = {"keys": [{**jwk, "kid": KID, "alg": "ES256", "use": "sig"}]}
        if self.jwk_set_cache is not None:
            self.jwk_set_cache.put(jwt.PyJWKSet.from_dict(data))
        return data


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> CountingClient:
    c = CountingClient("https://unused.invalid/jwks.json", **security.JWKS_CLIENT_OPTIONS)
    monkeypatch.setattr(security, "_jwks_client", lambda url: c)
    return c


def test_valid_tokens_hit_the_cache(client: CountingClient) -> None:
    for _ in range(20):
        security.verify_access_token(token_for(uuid.uuid4()), SETTINGS)
    assert client.fetches == 1


def test_unknown_kid_flood_refetches_at_most_once(client: CountingClient) -> None:
    security.verify_access_token(token_for(uuid.uuid4()), SETTINGS)  # warm cache
    forged = ec.generate_private_key(ec.SECP256R1())
    for i in range(50):
        token = jwt.encode(
            {"sub": str(uuid.uuid4())}, forged, algorithm="ES256", headers={"kid": f"rand-{i}"}
        )
        with pytest.raises(security.InvalidToken):
            security.verify_access_token(token, SETTINGS)
    assert client.fetches <= 2  # initial fetch + at most one cooldown-gated refresh


def test_jwks_outage_is_unavailable_not_invalid(monkeypatch: pytest.MonkeyPatch) -> None:
    class Down:
        def get_signing_key_from_jwt(self, token: str) -> Any:
            raise jwt.PyJWKClientConnectionError("connection refused")

    monkeypatch.setattr(security, "_jwks_client", lambda url: Down())
    with pytest.raises(security.AuthUnavailable):
        security.verify_access_token(token_for(uuid.uuid4()), SETTINGS)
