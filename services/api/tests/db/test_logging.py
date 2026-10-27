"""S5 (#11): diagnosable, PII-free events (FR-13 acceptance, principle 5)."""

import json
import logging
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.logging import JsonFormatter
from tests.auth_helpers import bearer, token_for

PROFILE = {"primary_goal": "fat_loss", "days_per_week": 6, "equipment": ["kettlebell"]}


def events(caplog: pytest.LogCaptureFixture) -> list[dict[str, Any]]:
    fmt = JsonFormatter()
    return [json.loads(fmt.format(r)) for r in caplog.records if r.name.startswith("fitpilot")]


def raw_output(caplog: pytest.LogCaptureFixture) -> str:
    """Everything server-side logged (the test client's own httpx logger is excluded)."""
    fmt = JsonFormatter()
    return "\n".join(fmt.format(r) for r in caplog.records if not r.name.startswith("httpx"))


def test_request_event_has_diagnostic_context(
    api: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    sub = uuid.uuid4()
    caplog.set_level(logging.INFO)
    r = api.post("/api/v1/profiles", json=PROFILE, headers=bearer(sub))

    req = [e for e in events(caplog) if e["event"] == "http.request"][-1]
    assert req["method"] == "POST"
    assert req["route"] == "/api/v1/profiles"
    assert req["status"] == 201
    assert req["user_id"] == str(sub)
    assert isinstance(req["duration_ms"], (int, float))
    assert req["request_id"] == r.headers["x-request-id"]


def test_rejected_token_logs_reason_without_token(
    api: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    expired = token_for(uuid.uuid4(), exp=1)
    api.get("/api/v1/profiles/me", headers={"Authorization": f"Bearer {expired}"})

    rejected = [e for e in events(caplog) if e["event"] == "auth.rejected"]
    assert rejected and rejected[0]["reason"] == "expired"
    assert rejected[0]["request_id"]
    assert expired not in raw_output(caplog)
    assert expired.split(".")[1] not in raw_output(caplog)  # not even the payload segment


def test_logs_never_contain_profile_values_or_bearer(
    api: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    headers = bearer(uuid.uuid4())
    api.post("/api/v1/profiles", json=PROFILE, headers=headers)
    api.get("/api/v1/profiles/me", headers=headers)

    out = raw_output(caplog)
    for value in ("fat_loss", "kettlebell", headers["Authorization"].split()[1]):
        assert value not in out


def test_incoming_request_id_is_propagated_when_safe(api: TestClient) -> None:
    r = api.get("/health", headers={"X-Request-ID": "abc-123_DEF"})
    assert r.headers["x-request-id"] == "abc-123_DEF"


@pytest.mark.parametrize("bad", ["x" * 200, "has spaces", "inject\nnewline"])
def test_unsafe_request_id_is_replaced(api: TestClient, bad: str) -> None:
    r = api.get("/health", headers={"X-Request-ID": bad})
    assert r.headers["x-request-id"] != bad
    uuid.UUID(r.headers["x-request-id"])


def test_unmatched_paths_are_not_logged_verbatim(
    api: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    r = api.get("/api/v1/profiles/jane.doe@example.com", headers=bearer(uuid.uuid4()))
    assert r.status_code in (404, 405)
    assert "jane.doe@example.com" not in raw_output(caplog)
    req = [e for e in events(caplog) if e["event"] == "http.request"][-1]
    assert req["route"] == "unmatched"
