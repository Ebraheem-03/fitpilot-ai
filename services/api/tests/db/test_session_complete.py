"""POST /workout-sessions/{id}/complete (FR-07, ADR-0011 §3): idempotent; the summary is computed
on the server from stored events only, and per-exercise performance records are derived from it."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import PerformanceRecord, SessionStatus, WorkoutSession
from app.schemas.session import SessionSummary
from tests.db.session_helpers import (
    RULE,
    SESSIONS,
    SQUAT,
    at,
    event,
    member,
    rep,
    send,
    set_completed,
    set_logged,
    shown,
    start,
)


def complete(
    api: TestClient, h: dict[str, str], sid: str, body: dict[str, Any] | None = None
) -> Any:
    return api.post(f"{SESSIONS}/{sid}/complete", json=body, headers=h)


def records(db: Session) -> list[PerformanceRecord]:
    return list(db.scalars(select(PerformanceRecord).order_by(PerformanceRecord.exercise_id)))


def by_exercise(summary: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {e["exercise_id"]: e for e in summary["exercises"]}


def full_workout(api: TestClient, h: dict[str, str]) -> str:
    """A squat set the camera counted (with cues + a tracking gap), a second squat set, a typed
    plank, a skipped push-up and a typed row that was corrected once."""
    sid = start(api, h)
    batch1 = [
        *[rep(sid, 0, i, conf=c, t=10 + i) for i, c in enumerate((0.9, 0.8, 0.7, 0.9, 0.95))],
        shown(sid, angle=112.5, t=12),
        event("feedback_acknowledged", sid, rule_id=RULE, message_id="go_deeper", t=13),
        event("tracking_degraded", sid, reason="low_light", duration_ms=2500, t=14),
        set_completed(sid, 0, 5, t=16, perceived_difficulty=6, note="felt good"),
        set_completed(sid, 1, 4, t=40, perceived_difficulty=8),
    ]
    batch2 = [
        set_logged(sid, 0, "plank", duration_s=45, t=60, perceived_difficulty=5),
        event("exercise_skipped", sid, exercise_id="push_up", reason="no_equipment", t=80),
        set_logged(sid, 0, "dumbbell_row", reps=8, t=100),
        set_logged(sid, 0, "dumbbell_row", reps=10, t=110, note="corrected"),
    ]
    assert send(api, h, sid, batch1).status_code == 200
    assert send(api, h, sid, batch2).status_code == 200
    return sid


# --- denial --------------------------------------------------------------------------------------


def test_another_member_cannot_complete_and_the_session_stays_open(
    api: TestClient, db: Session
) -> None:
    owner, other = member(api), member(api)
    sid = start(api, owner)
    assert complete(api, other, sid).status_code == 404
    assert db.scalar(select(WorkoutSession.status)) is SessionStatus.started
    assert records(db) == []


# --- the summary is what the events imply --------------------------------------------------------


def test_summary_matches_the_events(api: TestClient) -> None:
    h = member(api)
    sid = full_workout(api, h)
    r = complete(api, h, sid, {"perceived_difficulty": 7, "note": "good session"})
    assert r.status_code == 200
    summary = SessionSummary.model_validate(r.json())  # the response honours the contract
    body = r.json()

    assert body["session_id"] == sid
    assert body["perceived_difficulty"] == 7 and body["note"] == "good session"
    assert body["started_at"] and body["completed_at"]
    # exercises appear in the order the member did them
    assert [e["exercise_id"] for e in body["exercises"]] == [
        SQUAT,
        "plank",
        "push_up",
        "dumbbell_row",
    ]
    assert len(summary.exercises) == 4
    ex = by_exercise(body)

    squat = ex[SQUAT]
    assert squat["status"] == "completed" and squat["skip_reason"] is None
    assert squat["prescription"] == "reps" and squat["tracked"] is True
    assert squat["sets"] == [
        {
            "set_index": 0,
            "source": "tracked",
            "reps": 5,
            "duration_s": None,
            "perceived_difficulty": 6,
        },
        {
            "set_index": 1,
            "source": "tracked",
            "reps": 4,
            "duration_s": None,
            "perceived_difficulty": 8,
        },
    ]
    assert squat["total_reps"] == 9 and squat["total_duration_s"] == 0
    assert squat["perceived_difficulty"] == 8  # the last set that carried one
    assert squat["note"] == "felt good"  # the last set that carried a note
    assert squat["cues"] == [
        {
            "rule_id": RULE,
            "ruleset_version": 4,
            "message_id": "go_deeper",
            "shown_at": at(12).replace("+00:00", "Z"),
            "measurements": {"min_knee_angle_deg": 112.5},
            "response": "acknowledged",
        }
    ]
    assert squat["tracking_degraded"] == [
        {"reason": "low_light", "started_at": at(14).replace("+00:00", "Z"), "duration_ms": 2500}
    ]

    plank = ex["plank"]
    assert plank["prescription"] == "duration" and plank["tracked"] is False
    assert plank["sets"][0]["source"] == "manual"
    assert (plank["sets"][0]["reps"], plank["sets"][0]["duration_s"]) == (None, 45)
    assert (plank["total_reps"], plank["total_duration_s"]) == (0, 45)

    skipped = ex["push_up"]
    assert skipped["status"] == "skipped" and skipped["skip_reason"] == "no_equipment"
    assert skipped["sets"] == [] and skipped["total_reps"] == 0

    row = ex["dumbbell_row"]  # the later entry for set 0 replaces the earlier one
    assert [s["reps"] for s in row["sets"]] == [10]
    assert row["total_reps"] == 10 and row["note"] == "corrected"


def test_get_returns_the_same_summary_after_completion(api: TestClient) -> None:
    h = member(api)
    sid = full_workout(api, h)
    completed = complete(api, h, sid).json()
    got = api.get(f"{SESSIONS}/{sid}", headers=h).json()
    assert got["status"] == "completed"
    assert got["summary"] == completed
    assert got["completed_at"] == completed["completed_at"]
    listed = api.get(SESSIONS, headers=h).json()["items"][0]
    assert listed["status"] == "completed" and "summary" not in listed


def test_a_session_in_progress_has_no_summary(api: TestClient) -> None:
    h = member(api)
    sid = full_workout(api, h)
    got = api.get(f"{SESSIONS}/{sid}", headers=h).json()
    assert got["status"] == "started" and got["summary"] is None


def test_session_level_answers_are_optional_and_validated(api: TestClient) -> None:
    h = member(api)
    plain = complete(api, h, start(api, h))
    assert plain.status_code == 200
    assert plain.json()["perceived_difficulty"] is None and plain.json()["note"] is None
    assert plain.json()["exercises"] == []

    for bad in ({"perceived_difficulty": 0}, {"perceived_difficulty": 11}, {"note": ""}, {"x": 1}):
        assert complete(api, h, start(api, h), bad).status_code == 422
    assert complete(api, h, start(api, h), {"note": None, "perceived_difficulty": None}).is_success


def test_only_stored_events_count(api: TestClient) -> None:
    """Rejected batches leave no trace in the summary."""
    h = member(api, with_consent=False)
    sid = start(api, h)
    assert send(api, h, sid, [rep(sid, 0, 0), set_completed(sid, 0, 9)]).status_code == 403
    assert send(api, h, sid, [set_logged(sid, 0, SQUAT, reps=3)]).status_code == 200
    ex = by_exercise(complete(api, h, sid).json())[SQUAT]
    assert ex["tracked"] is False and ex["total_reps"] == 3
    assert [s["source"] for s in ex["sets"]] == ["manual"]


def test_reps_the_camera_counted_survive_a_set_that_never_closed(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    send(api, h, sid, [rep(sid, 0, i) for i in range(3)])  # no set_completed arrived
    ex = by_exercise(complete(api, h, sid).json())[SQUAT]
    assert ex["sets"] == [
        {
            "set_index": 0,
            "source": "tracked",
            "reps": 3,
            "duration_s": None,
            "perceived_difficulty": None,
        }
    ]
    assert ex["tracked"] is True


def test_set_completed_is_authoritative_over_individual_rep_events(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    send(api, h, sid, [*[rep(sid, 0, i) for i in range(6)], set_completed(sid, 0, 5)])
    assert by_exercise(complete(api, h, sid).json())[SQUAT]["total_reps"] == 5


def test_exercises_with_only_cues_or_tracking_gaps_are_not_listed(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    send(
        api,
        h,
        sid,
        [shown(sid), event("tracking_degraded", sid, reason="no_person", duration_ms=9)],
    )
    assert complete(api, h, sid).json()["exercises"] == []


def test_a_skip_followed_by_a_set_counts_as_completed(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    send(
        api,
        h,
        sid,
        [
            event("exercise_skipped", sid, exercise_id="plank", t=1),
            set_logged(sid, 0, "plank", duration_s=20, t=2),
        ],
    )
    plank = by_exercise(complete(api, h, sid).json())["plank"]
    assert plank["status"] == "completed" and plank["skip_reason"] is None


def test_a_response_attaches_to_the_latest_cue_it_follows(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    send(
        api,
        h,
        sid,
        [
            shown(sid, t=10),
            shown(sid, t=20),
            event("feedback_dismissed", sid, rule_id=RULE, message_id="go_deeper", t=21),
            shown(sid, t=30),
            set_completed(sid, 0, 1, t=40),
        ],
    )
    cues = by_exercise(complete(api, h, sid).json())[SQUAT]["cues"]
    assert [c["response"] for c in cues] == [None, "dismissed", None]


def test_cue_lists_are_capped_but_the_records_count_every_cue(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    send(api, h, sid, [shown(sid, t=i) for i in range(120)])
    send(api, h, sid, [shown(sid, t=200 + i) for i in range(101)])
    send(api, h, sid, [set_completed(sid, 0, 1, t=500)])
    summary = complete(api, h, sid).json()
    assert len(by_exercise(summary)[SQUAT]["cues"]) == 200
    assert records(db)[0].cue_count == 221


# --- idempotency ---------------------------------------------------------------------------------


def test_double_complete_returns_the_same_summary_and_writes_one_set_of_records(
    api: TestClient, db: Session
) -> None:
    h = member(api)
    sid = full_workout(api, h)
    first = complete(api, h, sid, {"perceived_difficulty": 7, "note": "first"})
    n_records = len(records(db))
    # a different body the second time must not rewrite history
    second = complete(api, h, sid, {"perceived_difficulty": 2, "note": "second"})

    assert first.status_code == second.status_code == 200
    assert second.json() == first.json()
    assert second.json()["note"] == "first"
    assert len(records(db)) == n_records == 4
    assert db.scalar(select(func.count()).select_from(WorkoutSession)) == 1


def test_complete_honours_an_idempotency_key_header(api: TestClient) -> None:
    h = member(api)
    sid = full_workout(api, h)
    keyed = {**h, "Idempotency-Key": "complete-key-0001"}
    a = api.post(f"{SESSIONS}/{sid}/complete", headers=keyed)
    b = api.post(f"{SESSIONS}/{sid}/complete", headers=keyed)
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    bad = {**h, "Idempotency-Key": "short"}
    assert api.post(f"{SESSIONS}/{sid}/complete", headers=bad).status_code == 422


def test_completing_never_changes_completed_at_on_replay(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    first = complete(api, h, sid).json()["completed_at"]
    again = complete(api, h, sid).json()["completed_at"]
    assert first == again


# --- performance records -------------------------------------------------------------------------


def test_performance_records_hold_only_derived_metrics(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = full_workout(api, h)
    complete(api, h, sid)
    rows = {r.exercise_id: r for r in records(db)}
    assert set(rows) == {SQUAT, "plank", "push_up", "dumbbell_row"}

    squat = rows[SQUAT]
    assert (squat.skipped, squat.tracked, squat.set_count) == (False, True, 2)
    assert (squat.total_reps, squat.total_duration_s) == (9, 0)
    assert float(squat.avg_tracking_confidence or 0) == pytest.approx(0.85)
    assert squat.tracking_degraded_ms == 2500
    assert squat.cue_count == 1 and squat.cue_counts == {RULE: 1}
    session = db.get(WorkoutSession, squat.session_id)
    assert session is not None and squat.user_id == session.user_id

    plank = rows["plank"]
    assert (plank.tracked, plank.total_duration_s, plank.avg_tracking_confidence) == (
        False,
        45,
        None,
    )
    assert rows["push_up"].skipped is True and rows["push_up"].set_count == 0


def test_records_carry_the_sessions_gym(api: TestClient, db: Session) -> None:
    from app.models import Gym, GymMembership, MembershipStatus
    from tests.auth_helpers import bearer

    gym = Gym(name="Record Gym")
    db.add(gym)
    db.flush()
    h = bearer(uuid.uuid4())
    first = start(api, h)
    user_id = db.get(WorkoutSession, uuid.UUID(first)).user_id  # type: ignore[union-attr]
    db.add(GymMembership(gym_id=gym.id, user_id=user_id, status=MembershipStatus.active))
    db.flush()
    sid = start(api, h)
    send(api, h, sid, [set_logged(sid, 0, SQUAT, reps=5)])
    complete(api, h, sid)
    assert [r.gym_id for r in records(db)] == [gym.id]
