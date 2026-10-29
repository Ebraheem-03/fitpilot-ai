"""FR-13 / ADR-0011 §6: session endpoints log counts, types and outcomes, never measurement values,
notes or payloads."""

import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.db.plan_helpers import seed_plan, sub_of
from tests.db.session_helpers import (
    CONSENT,
    PROFILE,
    SESSIONS,
    SQUAT,
    event,
    member,
    rep,
    send,
    set_completed,
    set_logged,
    shown,
    start,
)
from tests.db.test_logging import events, raw_output

SECRETS = ("my private knee note", "112.5173", "session-wide secret", "typed-in secret")


def named(caplog: pytest.LogCaptureFixture, name: str) -> list[dict[str, Any]]:
    return [e for e in events(caplog) if e["event"] == name]


def test_ingestion_logs_counts_and_types_only(
    api: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    h = member(api)
    sid = start(api, h)
    caplog.set_level(logging.DEBUG)
    batch = [
        rep(sid, 0, 0),
        rep(sid, 0, 1),
        shown(sid, angle=112.5173),
        set_completed(sid, 0, 2, note="my private knee note"),
    ]
    send(api, h, sid, batch)
    send(api, h, sid, batch)

    first, second = named(caplog, "session.events_ingested")
    assert first["session_id"] == sid
    assert (first["received"], first["accepted"], first["duplicates"]) == (4, 4, 0)
    assert first["type_counts"] == {"rep_completed": 2, "feedback_shown": 1, "set_completed": 1}
    assert first["user_id"]
    assert (second["accepted"], second["duplicates"]) == (0, 4)
    assert isinstance(first["duration_ms"], (int, float))

    out = raw_output(caplog)
    for secret in SECRETS:
        assert secret not in out
    for event_ in batch:
        assert event_["idempotency_key"] not in out


def test_rejections_log_the_reason_code_not_the_content(
    api: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    h = member(api, with_consent=False)
    sid = start(api, h)
    caplog.set_level(logging.DEBUG)

    send(api, h, sid, [rep(sid, 0, 0)])  # no consent
    send(
        api, h, sid, [set_logged(sid, 0, "plank", reps=5, note="typed-in secret")]
    )  # wrong measure
    bad = shown(sid, angle=112.5173)
    bad["rule_id"] = "squat.invented.rule"
    send(api, h, sid, [bad, set_logged(sid, 1, SQUAT, reps=3, note="my private knee note")])

    reasons = [e["reason"] for e in named(caplog, "session.events_rejected")]
    assert reasons[:2] == ["tracking_consent_required", "invalid_events"]
    rejected = named(caplog, "session.events_rejected")
    assert rejected[0]["received"] == 1
    assert rejected[1]["invalid_count"] == 1

    out = raw_output(caplog)
    for secret in SECRETS:
        assert secret not in out


def test_completion_logs_counts_and_replay_flag(
    api: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    h = member(api)
    sid = start(api, h)
    send(api, h, sid, [set_logged(sid, 0, SQUAT, reps=5, note="typed-in secret")])
    caplog.set_level(logging.DEBUG)
    body = {"note": "session-wide secret", "perceived_difficulty": 9}
    api.post(f"{SESSIONS}/{sid}/complete", json=body, headers=h)
    api.post(f"{SESSIONS}/{sid}/complete", json=body, headers=h)

    first, again = named(caplog, "session.completed")
    assert first["session_id"] == sid
    assert (first["exercise_count"], first["event_count"], first["replayed"]) == (1, 1, False)
    assert again["replayed"] is True
    out = raw_output(caplog)
    for secret in SECRETS:
        assert secret not in out


def test_lifecycle_events_carry_ids_only(
    api: TestClient, db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    h = member(api)
    plan_id = str(seed_plan(db, sub_of(h)).id)
    caplog.set_level(logging.DEBUG)
    sid = start(api, h, training_plan_id=plan_id, plan_day_index=1)
    api.delete(f"{SESSIONS}/{sid}", headers=h)

    started = named(caplog, "session.started")[0]
    assert started["session_id"] == sid and started["has_plan"] is True
    assert named(caplog, "session.deleted")[0]["session_id"] == sid
    assert plan_id not in raw_output(caplog)


def test_denied_access_is_logged_with_the_requested_id_and_action(
    api: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    owner, other = member(api), member(api)
    sid = start(api, owner)
    caplog.set_level(logging.DEBUG)
    send(api, other, sid, [event("exercise_skipped", sid, exercise_id="plank")])
    denied = named(caplog, "session.not_found")
    assert denied[0]["action"] == "ingest_events" and denied[0]["session_id"] == sid
    assert denied[0]["user_id"]


def test_consent_changes_are_logged(api: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    h = member(api, with_consent=False)
    api.post(PROFILE, json={"primary_goal": "strength"}, headers=h)
    caplog.set_level(logging.DEBUG)
    api.put(CONSENT, json={"version": 1}, headers=h)
    api.delete(CONSENT, headers=h)
    assert named(caplog, "consent.granted")[0]["version"] == 1
    assert named(caplog, "consent.withdrawn")
