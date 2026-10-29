"""Builders shared by the workout-session API tests."""

import itertools
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from tests.auth_helpers import bearer

SESSIONS = "/api/v1/workout-sessions"
CONSENT = "/api/v1/profiles/me/tracking-consent"
PROFILE = "/api/v1/profiles"
SQUAT = "bodyweight_squat"
RULE = "squat.depth.shallow"
T0 = datetime(2026, 10, 29, 10, 0, 0, tzinfo=UTC)

_counter = itertools.count()


def at(seconds: float) -> str:
    return (T0 + timedelta(seconds=seconds)).isoformat()


def event(
    type_: str,
    session_id: str,
    *,
    exercise_id: str = SQUAT,
    t: float | None = None,
    key: str | None = None,
    **fields: Any,
) -> dict[str, Any]:
    n = next(_counter)
    return {
        "type": type_,
        "session_id": session_id,
        "exercise_id": exercise_id,
        "occurred_at": at(n if t is None else t),
        "idempotency_key": key or f"key-{uuid.uuid4()}",
        **fields,
    }


def rep(session_id: str, set_index: int, rep_index: int, conf: float = 0.9, **kw: Any) -> Any:
    return event(
        "rep_completed",
        session_id,
        set_index=set_index,
        rep_index=rep_index,
        duration_ms=1800,
        tracking_confidence=conf,
        **kw,
    )


def shown(session_id: str, message_id: str = "go_deeper", angle: float = 112.5, **kw: Any) -> Any:
    return event(
        "feedback_shown",
        session_id,
        rule_id=RULE,
        ruleset_version=3,
        message_id=message_id,
        measurements={"min_knee_angle_deg": angle},
        tracking_confidence=0.8,
        **kw,
    )


def set_completed(session_id: str, set_index: int, reps: int, **kw: Any) -> Any:
    return event("set_completed", session_id, set_index=set_index, reps=reps, **kw)


def set_logged(session_id: str, set_index: int, exercise_id: str, **kw: Any) -> Any:
    return event("set_logged", session_id, set_index=set_index, exercise_id=exercise_id, **kw)


def consent(api: TestClient, headers: dict[str, str]) -> None:
    """Create a profile for the caller (if needed) and record tracking consent."""
    api.post(PROFILE, json={"primary_goal": "strength"}, headers=headers)
    assert api.put(CONSENT, json={"version": 1}, headers=headers).status_code == 200


def member(api: TestClient, *, with_consent: bool = True) -> dict[str, str]:
    headers = bearer(uuid.uuid4())
    if with_consent:
        consent(api, headers)
    return headers


def start(api: TestClient, headers: dict[str, str], **body: Any) -> str:
    r = api.post(SESSIONS, json=body, headers=headers)
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def send(
    api: TestClient, headers: dict[str, str], session_id: str, events: list[dict[str, Any]]
) -> Any:
    return api.post(f"{SESSIONS}/{session_id}/events", json={"events": events}, headers=headers)
