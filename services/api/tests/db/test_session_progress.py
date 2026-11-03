"""GET /workout-sessions/{id} `progress` (M3 close-out, review 3, FR-07): what the server has stored
for a started session, per exercise, so the web runner can resume without its local ledger.
Derived from stored events only."""

from typing import Any

from fastapi.testclient import TestClient

from tests.db.session_helpers import (
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

PLANK = "plank"


def progress(api: TestClient, headers: dict[str, str], sid: str) -> Any:
    r = api.get(f"{SESSIONS}/{sid}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["progress"]


def test_a_new_session_has_empty_progress(api: TestClient) -> None:
    h = member(api)
    assert progress(api, h, start(api, h)) == {}


def test_progress_lists_stored_sets_skips_and_the_highest_index_per_exercise(
    api: TestClient,
) -> None:
    h = member(api)
    sid = start(api, h)
    batch = [
        set_completed(sid, 0, 8),
        set_completed(sid, 1, 8),
        rep(sid, 2, 0),  # a camera set in progress: counted reps, no set_completed yet
        set_logged(sid, 0, PLANK, duration_s=30),
        event("exercise_skipped", sid, exercise_id="push_up", reason="no_time"),
    ]
    assert send(api, h, sid, batch).status_code == 200
    assert progress(api, h, sid) == {
        SQUAT: {"set_indexes": [0, 1], "skipped": False, "highest_set_index": 2},
        PLANK: {"set_indexes": [0], "skipped": False, "highest_set_index": 0},
        "push_up": {"set_indexes": [], "skipped": True, "highest_set_index": None},
    }


def test_set_indexes_are_distinct_and_sorted_and_reps_alone_are_not_stored_sets(
    api: TestClient,
) -> None:
    h = member(api)
    sid = start(api, h)
    batch = [
        set_completed(sid, 3, 5),
        set_completed(sid, 1, 5),
        set_completed(sid, 1, 6),  # a retry of set 1: still one stored set index
        rep(sid, 3, 0),
        rep(sid, 3, 1),
    ]
    assert send(api, h, sid, batch).status_code == 200
    assert progress(api, h, sid) == {
        SQUAT: {"set_indexes": [1, 3], "skipped": False, "highest_set_index": 3}
    }


def test_cue_only_exercises_are_not_listed(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    assert send(api, h, sid, [shown(sid)]).status_code == 200
    assert progress(api, h, sid) == {}


def test_a_skip_and_a_later_set_both_show(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    batch = [event("exercise_skipped", sid), set_completed(sid, 0, 4)]
    assert send(api, h, sid, batch).status_code == 200
    assert progress(api, h, sid) == {
        SQUAT: {"set_indexes": [0], "skipped": True, "highest_set_index": 0}
    }


def test_progress_follows_new_events(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    send(api, h, sid, [set_completed(sid, 0, 5)])
    assert progress(api, h, sid)[SQUAT]["set_indexes"] == [0]
    send(api, h, sid, [set_completed(sid, 1, 5)])
    assert progress(api, h, sid)[SQUAT]["set_indexes"] == [0, 1]


def test_progress_is_null_once_the_session_is_completed(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    send(api, h, sid, [set_completed(sid, 0, 5)])
    assert api.post(f"{SESSIONS}/{sid}/complete", headers=h).status_code == 200
    body = api.get(f"{SESSIONS}/{sid}", headers=h).json()
    assert body["status"] == "completed" and body["progress"] is None
    assert body["summary"] is not None  # the summary takes over


def test_progress_only_counts_this_sessions_events(api: TestClient) -> None:
    h = member(api)
    one, two = start(api, h), start(api, h)
    send(api, h, one, [set_completed(one, 0, 5)])
    assert progress(api, h, two) == {}


def test_another_member_cannot_read_progress(api: TestClient) -> None:
    owner, other = member(api), member(api)
    sid = start(api, owner)
    send(api, owner, sid, [set_completed(sid, 0, 5)])
    r = api.get(f"{SESSIONS}/{sid}", headers=other)
    assert r.status_code == 404
    assert "progress" not in r.text and SQUAT not in r.text
    assert r.json()["detail"]["code"] == "session_not_found"


def test_progress_is_not_on_the_list_and_a_replayed_start_carries_it(api: TestClient) -> None:
    h = member(api)
    headers = {**h, "Idempotency-Key": "start-key-0001"}
    first = api.post(SESSIONS, json={}, headers=headers)
    assert first.status_code == 201 and first.json()["progress"] == {}
    sid = first.json()["id"]
    send(api, h, sid, [set_completed(sid, 0, 5)])
    page = api.get(SESSIONS, headers=h).json()
    assert all("progress" not in item for item in page["items"])
    again = api.post(SESSIONS, json={}, headers=headers)  # a retried start resumes the session
    assert again.status_code == 200
    assert again.json()["progress"][SQUAT]["set_indexes"] == [0]
