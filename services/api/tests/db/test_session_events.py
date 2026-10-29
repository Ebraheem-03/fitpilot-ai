"""POST /workout-sessions/{id}/events (FR-07, ADR-0011 §1-3): validated, deduplicated, consented."""

import json
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import SessionEventRow
from app.services import workout_sessions
from tests.db.session_helpers import (
    CONSENT,
    RULE,
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


def stored(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(SessionEventRow)) or 0


def code(response: Any) -> str:
    return str(response.json()["detail"]["code"])


# --- ownership / path ----------------------------------------------------------------------------


def test_other_members_session_is_404_even_for_a_valid_batch(api: TestClient, db: Session) -> None:
    owner, other = member(api), member(api)
    sid = start(api, owner)
    r = send(api, other, sid, [rep(sid, 0, 0), set_completed(sid, 0, 1)])
    assert r.status_code == 404
    assert code(r) == "session_not_found"
    assert stored(db) == 0


def test_batch_session_id_must_equal_the_path_id(api: TestClient, db: Session) -> None:
    h = member(api)
    mine, other_session = start(api, h), start(api, h)
    r = send(api, h, mine, [rep(other_session, 0, 0)])
    assert r.status_code == 422
    assert code(r) == "session_id_mismatch"
    assert stored(db) == 0


def test_mismatched_batch_against_someone_elses_session_is_still_404(api: TestClient) -> None:
    owner, other = member(api), member(api)
    sid = start(api, owner)
    assert send(api, other, sid, [rep(str(uuid.uuid4()), 0, 0)]).status_code == 404


def test_batch_mixing_sessions_is_422(api: TestClient, db: Session) -> None:
    h = member(api)
    a, b = start(api, h), start(api, h)
    assert send(api, h, a, [rep(a, 0, 0), rep(b, 0, 1)]).status_code == 422
    assert stored(db) == 0


# --- happy path + de-duplication -----------------------------------------------------------------


def test_events_are_stored_and_counted(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    r = send(api, h, sid, [rep(sid, 0, 0), rep(sid, 0, 1), shown(sid), set_completed(sid, 0, 2)])
    assert r.status_code == 200
    assert r.json() == {"accepted": 4, "duplicates": 0}
    assert stored(db) == 4


def test_a_resent_batch_is_stored_once(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    batch = [rep(sid, 0, 0), rep(sid, 0, 1), set_completed(sid, 0, 2)]
    first = send(api, h, sid, batch)
    again = send(api, h, sid, batch)
    assert first.json() == {"accepted": 3, "duplicates": 0}
    assert again.status_code == 200
    assert again.json() == {"accepted": 0, "duplicates": 3}
    assert stored(db) == 3


def test_partial_overlap_stores_only_the_new_events(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    old = [rep(sid, 0, 0), rep(sid, 0, 1)]
    send(api, h, sid, old)
    r = send(api, h, sid, [*old, rep(sid, 0, 2)])
    assert r.json() == {"accepted": 1, "duplicates": 2}
    assert stored(db) == 3


def test_the_same_key_twice_in_one_batch_is_stored_once(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    e = rep(sid, 0, 0, key="the-same-key-1")
    r = send(api, h, sid, [e, dict(e)])
    assert r.json() == {"accepted": 1, "duplicates": 1}
    assert stored(db) == 1


def test_keys_are_scoped_to_their_session(api: TestClient, db: Session) -> None:
    h = member(api)
    a, b = start(api, h), start(api, h)
    assert send(api, h, a, [rep(a, 0, 0, key="shared-key-001")]).json()["accepted"] == 1
    assert send(api, h, b, [rep(b, 0, 0, key="shared-key-001")]).json()["accepted"] == 1
    assert stored(db) == 2


def test_a_realistic_batch_fits_the_size_cap(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    r = send(api, h, sid, [rep(sid, 0, i) for i in range(100)])
    assert r.json() == {"accepted": 100, "duplicates": 0}


# --- after completion ----------------------------------------------------------------------------


def test_events_after_completion_are_409(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    batch = [rep(sid, 0, 0), set_completed(sid, 0, 1)]
    send(api, h, sid, batch)
    api.post(f"{SESSIONS}/{sid}/complete", headers=h)

    for events in ([rep(sid, 0, 5)], batch):  # a new event and a resend are both refused
        r = send(api, h, sid, events)
        assert r.status_code == 409
        assert code(r) == "session_completed"
    assert stored(db) == 2


# --- body size -----------------------------------------------------------------------------------


def test_oversize_body_is_413_before_anything_is_stored(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    pad = json.dumps({"events": [], "pad": "x" * 70_000})
    r = api.post(
        f"{SESSIONS}/{sid}/events",
        content=pad,
        headers={**h, "Content-Type": "application/json"},
    )
    assert r.status_code == 413
    assert code(r) == "payload_too_large"
    assert stored(db) == 0


def test_oversize_chunked_body_is_413_too(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)

    def chunks() -> Any:
        yield b'{"events": [], "pad": "'
        for _ in range(80):
            yield b"x" * 1024
        yield b'"}'

    r = api.post(
        f"{SESSIONS}/{sid}/events",
        content=chunks(),
        headers={**h, "Content-Type": "application/json"},
    )
    assert r.status_code == 413


def test_a_body_just_under_the_cap_is_parsed(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    r = api.post(
        f"{SESSIONS}/{sid}/events",
        content=json.dumps({"events": [], "pad": "x" * 60_000}),
        headers={**h, "Content-Type": "application/json"},
    )
    assert r.status_code == 422  # validated (empty batch, unknown field), not size-rejected


# --- contract validation at the boundary (422) ---------------------------------------------------


def test_empty_batch_and_oversized_batch_are_422(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    assert send(api, h, sid, []).status_code == 422
    assert api.post(f"{SESSIONS}/{sid}/events", json={}, headers=h).status_code == 422


def test_unknown_rule_id_is_422(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    bad = shown(sid)
    bad["rule_id"] = "squat.invented.rule"
    assert send(api, h, sid, [bad]).status_code == 422
    assert stored(db) == 0


def test_undeclared_measurement_key_is_422(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    bad = shown(sid)
    bad["measurements"] = {"min_knee_angle_deg": 100.0, "left_knee_x": 0.4}
    r = send(api, h, sid, [bad])
    assert r.status_code == 422
    assert stored(db) == 0


def test_rule_for_another_exercise_is_422(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    bad = shown(sid, exercise_id="push_up")
    assert send(api, h, sid, [bad]).status_code == 422
    assert stored(db) == 0


def test_landmark_or_frame_fields_cannot_ride_along(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    for extra in ({"landmarks": [[0.1, 0.2, 0.3]]}, {"frame": "AAAA"}, {"angles": [1, 2]}):
        assert send(api, h, sid, [{**rep(sid, 0, 0), **extra}]).status_code == 422
    assert stored(db) == 0


# --- feedback responses must refer to a shown cue (review: (a)) ----------------------------------


def respond(kind: str, session_id: str, message_id: str = "go_deeper", **kw: Any) -> Any:
    return event(kind, session_id, rule_id=RULE, message_id=message_id, **kw)


@pytest.mark.parametrize("kind", ["feedback_acknowledged", "feedback_dismissed"])
def test_response_without_a_shown_cue_is_422(api: TestClient, db: Session, kind: str) -> None:
    h = member(api)
    sid = start(api, h)
    r = send(api, h, sid, [respond(kind, sid)])
    assert r.status_code == 422
    assert code(r) == "invalid_events"
    assert stored(db) == 0


@pytest.mark.parametrize("kind", ["feedback_acknowledged", "feedback_dismissed"])
def test_response_to_a_cue_stored_earlier_is_accepted(api: TestClient, kind: str) -> None:
    h = member(api)
    sid = start(api, h)
    send(api, h, sid, [shown(sid)])
    assert send(api, h, sid, [respond(kind, sid)]).json()["accepted"] == 1


@pytest.mark.parametrize("kind", ["feedback_acknowledged", "feedback_dismissed"])
def test_response_after_the_cue_in_the_same_batch_is_accepted(api: TestClient, kind: str) -> None:
    h = member(api)
    sid = start(api, h)
    assert send(api, h, sid, [shown(sid), respond(kind, sid)]).json()["accepted"] == 2


def test_response_before_the_cue_in_the_same_batch_is_422(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    r = send(api, h, sid, [respond("feedback_acknowledged", sid), shown(sid)])
    assert r.status_code == 422
    assert stored(db) == 0


def test_response_must_match_message_id_and_exercise(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    send(api, h, sid, [shown(sid, message_id="go_deeper")])
    wrong_message = respond("feedback_acknowledged", sid, message_id="other_message")
    assert send(api, h, sid, [wrong_message]).status_code == 422
    wrong_exercise = respond("feedback_acknowledged", sid, exercise_id="push_up")
    assert send(api, h, sid, [wrong_exercise]).status_code == 422


def test_another_sessions_cue_does_not_count(api: TestClient) -> None:
    h = member(api)
    a, b = start(api, h), start(api, h)
    send(api, h, a, [shown(a)])
    assert send(api, h, b, [respond("feedback_acknowledged", b)]).status_code == 422


def test_a_resent_response_is_a_duplicate_not_an_error(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    batch = [shown(sid), respond("feedback_dismissed", sid, key="dismiss-key-001")]
    send(api, h, sid, batch)
    assert send(api, h, sid, batch).json() == {"accepted": 0, "duplicates": 2}
    assert stored(db) == 2


# --- consent (ADR-0011 §4) -----------------------------------------------------------------------


def tracked_events(sid: str) -> dict[str, dict[str, Any]]:
    return {
        "rep_completed": rep(sid, 0, 0),
        "feedback_shown": shown(sid),
        "feedback_acknowledged": event(
            "feedback_acknowledged", sid, rule_id=RULE, message_id="go_deeper"
        ),
        "feedback_dismissed": event(
            "feedback_dismissed", sid, rule_id=RULE, message_id="go_deeper"
        ),
        "tracking_degraded": event("tracking_degraded", sid, reason="low_light", duration_ms=2500),
        "set_completed": set_completed(sid, 0, 5),
    }


@pytest.mark.parametrize(
    "kind",
    [
        "rep_completed",
        "feedback_shown",
        "feedback_acknowledged",
        "feedback_dismissed",
        "tracking_degraded",
        "set_completed",
    ],
)
def test_tracked_event_types_need_consent(api: TestClient, db: Session, kind: str) -> None:
    h = member(api, with_consent=False)
    sid = start(api, h)
    r = send(api, h, sid, [tracked_events(sid)[kind]])
    assert r.status_code == 403
    assert code(r) == "tracking_consent_required"
    assert stored(db) == 0


def test_manual_events_need_no_consent(api: TestClient, db: Session) -> None:
    h = member(api, with_consent=False)
    sid = start(api, h)
    r = send(
        api,
        h,
        sid,
        [
            set_logged(sid, 0, SQUAT, reps=12),
            event("exercise_skipped", sid, exercise_id="push_up", reason="no_time"),
        ],
    )
    assert r.status_code == 200
    assert stored(db) == 2


def test_one_tracked_event_rejects_the_whole_batch(api: TestClient, db: Session) -> None:
    h = member(api, with_consent=False)
    sid = start(api, h)
    r = send(api, h, sid, [set_logged(sid, 0, SQUAT, reps=12), rep(sid, 0, 0)])
    assert r.status_code == 403
    assert stored(db) == 0


def test_member_without_a_profile_has_no_consent(api: TestClient) -> None:
    from tests.auth_helpers import bearer

    h = bearer(uuid.uuid4())
    sid = start(api, h)
    assert send(api, h, sid, [rep(sid, 0, 0)]).status_code == 403
    assert send(api, h, sid, [set_logged(sid, 0, SQUAT, reps=5)]).status_code == 200


def test_withdrawing_consent_stops_tracked_uploads(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    assert send(api, h, sid, [rep(sid, 0, 0)]).status_code == 200
    api.delete(CONSENT, headers=h)
    assert send(api, h, sid, [rep(sid, 0, 1)]).status_code == 403
    assert send(api, h, sid, [set_logged(sid, 1, SQUAT, reps=3)]).status_code == 200
    assert stored(db) == 2


# --- catalogue checks ----------------------------------------------------------------------------


def test_unknown_exercise_is_422(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    r = send(api, h, sid, [set_logged(sid, 0, "made_up_move", reps=5)])
    assert r.status_code == 422
    assert code(r) == "invalid_events"
    assert r.json()["detail"]["errors"][0]["index"] == 0
    assert stored(db) == 0


def test_errors_name_the_offending_events_without_echoing_values(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    ok = set_logged(sid, 0, SQUAT, reps=5, note="my knee clicked")
    bad = set_logged(sid, 1, "plank", reps=5, note="secret text")
    r = send(api, h, sid, [ok, bad])
    assert [e["index"] for e in r.json()["detail"]["errors"]] == [1]
    assert "secret text" not in r.text


def test_manual_set_must_match_the_prescription(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    plank_reps = set_logged(sid, 0, "plank", reps=10)
    squat_seconds = set_logged(sid, 0, SQUAT, duration_s=30)
    for bad in (plank_reps, squat_seconds):
        r = send(api, h, sid, [bad])
        assert r.status_code == 422, bad
    assert stored(db) == 0
    good = [set_logged(sid, 0, "plank", duration_s=45), set_logged(sid, 0, SQUAT, reps=10)]
    assert send(api, h, sid, good).json()["accepted"] == 2


def test_tracked_events_need_a_tracked_rep_exercise(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    for bad in (
        set_completed(sid, 0, 5, exercise_id="plank"),  # duration exercise
        set_completed(sid, 0, 5, exercise_id="dumbbell_row"),  # not camera-tracked
        rep(sid, 0, 0, exercise_id="dumbbell_row"),
        event("tracking_degraded", sid, exercise_id="push_up", reason="no_person", duration_ms=1),
    ):
        assert send(api, h, sid, [bad]).status_code == 422, bad
    assert stored(db) == 0


def test_skip_needs_a_known_exercise(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    assert (
        send(api, h, sid, [event("exercise_skipped", sid, exercise_id="nope")]).status_code == 422
    )


# --- null handling (review) ----------------------------------------------------------------------


def test_json_null_for_an_optional_field_means_absent(api: TestClient, db: Session) -> None:
    """Pydantic accepts `null` where zod would reject it; the API treats it as 'not provided'."""
    h = member(api)
    sid = start(api, h)
    e = set_logged(sid, 0, SQUAT, reps=8, note=None, perceived_difficulty=None)
    assert send(api, h, sid, [e]).json()["accepted"] == 1

    api.post(f"{SESSIONS}/{sid}/complete", headers=h)
    summary = api.get(f"{SESSIONS}/{sid}", headers=h).json()["summary"]
    ex = summary["exercises"][0]
    assert ex["note"] is None and ex["perceived_difficulty"] is None
    assert ex["sets"][0]["perceived_difficulty"] is None
    assert db.scalar(select(SessionEventRow.payload)) is not None


def test_null_does_not_rescue_a_missing_required_measure(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    # exactly one of reps / duration_s: two nulls is still "neither"
    e = set_logged(sid, 0, SQUAT, reps=None, duration_s=None)
    assert send(api, h, sid, [e]).status_code == 422


# --- abuse limit ---------------------------------------------------------------------------------


def test_a_session_cannot_grow_without_bound(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(workout_sessions, "MAX_EVENTS_PER_SESSION", 5)
    h = member(api)
    sid = start(api, h)
    first = [rep(sid, 0, i) for i in range(4)]
    assert send(api, h, sid, first).status_code == 200
    r = send(api, h, sid, [rep(sid, 0, i) for i in range(10, 13)])
    assert r.status_code == 409
    assert code(r) == "event_limit_reached"
    assert stored(db) == 4
    # a resend of what is already stored does not count against the limit
    assert send(api, h, sid, first).json() == {"accepted": 0, "duplicates": 4}
    assert send(api, h, sid, [rep(sid, 0, 98)]).status_code == 200  # the fifth fits
    assert send(api, h, sid, [rep(sid, 0, 99)]).status_code == 409
