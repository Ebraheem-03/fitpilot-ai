"""POST/GET/DELETE /workout-sessions (FR-07): ownership, tenant scoping, idempotent start."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy import table as sa_table
from sqlalchemy.orm import Session

from app.models import Gym, GymMembership, MembershipStatus, SessionEventRow, WorkoutSession
from tests.auth_helpers import bearer
from tests.db.session_helpers import SESSIONS, member, rep, send, set_completed, start


def test_anonymous_requests_are_401(api: TestClient) -> None:
    sid = str(uuid.uuid4())
    assert api.post(SESSIONS, json={}).status_code == 401
    assert api.get(SESSIONS).status_code == 401
    assert api.get(f"{SESSIONS}/{sid}").status_code == 401
    assert api.post(f"{SESSIONS}/{sid}/events", json={"events": []}).status_code == 401
    assert api.post(f"{SESSIONS}/{sid}/complete").status_code == 401
    assert api.delete(f"{SESSIONS}/{sid}").status_code == 401


# --- denial first: another member, another gym ---------------------------------------------------


def test_another_member_gets_404_on_every_session_route(api: TestClient) -> None:
    owner, other = member(api), member(api)
    sid = start(api, owner)

    assert api.get(f"{SESSIONS}/{sid}", headers=other).status_code == 404
    assert api.post(f"{SESSIONS}/{sid}/complete", headers=other).status_code == 404
    assert api.delete(f"{SESSIONS}/{sid}", headers=other).status_code == 404
    r = send(api, other, sid, [rep(sid, 0, 0)])
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "session_not_found"

    # The owner's session is untouched by all of that.
    assert api.get(f"{SESSIONS}/{sid}", headers=owner).json()["status"] == "started"


def test_a_missing_session_looks_identical_to_someone_elses(api: TestClient) -> None:
    owner, other = member(api), member(api)
    sid = start(api, owner)
    theirs = api.get(f"{SESSIONS}/{sid}", headers=other)
    missing = api.get(f"{SESSIONS}/{uuid.uuid4()}", headers=other)
    assert theirs.status_code == missing.status_code == 404
    assert theirs.json() == missing.json()


def test_list_only_returns_own_sessions(api: TestClient) -> None:
    a, b = member(api), member(api)
    mine = start(api, a)
    start(api, b)
    page = api.get(SESSIONS, headers=a).json()
    assert [s["id"] for s in page["items"]] == [mine]
    assert page["total"] == 1


def test_member_of_another_gym_gets_404(api: TestClient, db: Session) -> None:
    gym_a, gym_b = Gym(name="Gym A"), Gym(name="Gym B")
    db.add_all([gym_a, gym_b])
    db.flush()
    a, b = bearer(uuid.uuid4()), bearer(uuid.uuid4())
    # Provision both users through the API, then attach each to a different gym.
    sid_a = start(api, a)
    sid_b = start(api, b)
    for sid, gym in ((sid_a, gym_a), (sid_b, gym_b)):
        row = db.get(WorkoutSession, uuid.UUID(sid))
        assert row is not None
        db.add(GymMembership(gym_id=gym.id, user_id=row.user_id, status=MembershipStatus.active))
    db.flush()

    assert api.get(f"{SESSIONS}/{sid_a}", headers=b).status_code == 404
    assert api.delete(f"{SESSIONS}/{sid_a}", headers=b).status_code == 404
    assert api.post(f"{SESSIONS}/{sid_a}/complete", headers=b).status_code == 404
    assert api.get(f"{SESSIONS}/{sid_a}", headers=a).status_code == 200


def test_session_is_stamped_with_the_members_single_active_gym(
    api: TestClient, db: Session
) -> None:
    gym = Gym(name="Solo Gym")
    db.add(gym)
    db.flush()
    h = bearer(uuid.uuid4())
    first = start(api, h)  # provisions the user
    user_id = db.get(WorkoutSession, uuid.UUID(first)).user_id  # type: ignore[union-attr]
    db.add(GymMembership(gym_id=gym.id, user_id=user_id, status=MembershipStatus.active))
    db.flush()

    second = db.get(WorkoutSession, uuid.UUID(start(api, h)))
    assert second is not None and second.gym_id == gym.id
    assert db.get(WorkoutSession, uuid.UUID(first)).gym_id is None  # type: ignore[union-attr]


def test_session_has_no_gym_when_membership_is_ambiguous_or_inactive(
    api: TestClient, db: Session
) -> None:
    g1, g2 = Gym(name="One"), Gym(name="Two")
    db.add_all([g1, g2])
    db.flush()
    h = bearer(uuid.uuid4())
    user_id = db.get(WorkoutSession, uuid.UUID(start(api, h))).user_id  # type: ignore[union-attr]
    db.add_all(
        [
            GymMembership(gym_id=g1.id, user_id=user_id, status=MembershipStatus.active),
            GymMembership(gym_id=g2.id, user_id=user_id, status=MembershipStatus.active),
        ]
    )
    db.flush()
    row = db.get(WorkoutSession, uuid.UUID(start(api, h)))
    assert row is not None and row.gym_id is None


# --- start ---------------------------------------------------------------------------------------


def test_start_creates_a_started_session(api: TestClient) -> None:
    h = member(api)
    r = api.post(SESSIONS, json={}, headers=h)
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "started"
    assert body["completed_at"] is None and body["summary"] is None
    assert body["training_plan_id"] is None and body["plan_day_index"] is None
    assert api.get(f"{SESSIONS}/{body['id']}", headers=h).json() == body


def test_start_accepts_no_body_at_all(api: TestClient) -> None:
    assert api.post(SESSIONS, headers=member(api)).status_code == 201


def test_start_with_a_plan_reference(api: TestClient) -> None:
    plan = str(uuid.uuid4())
    r = api.post(
        SESSIONS, json={"training_plan_id": plan, "plan_day_index": 2}, headers=member(api)
    )
    assert r.status_code == 201
    assert (r.json()["training_plan_id"], r.json()["plan_day_index"]) == (plan, 2)


def test_plan_reference_needs_both_fields_in_range(api: TestClient) -> None:
    h = member(api)
    plan = str(uuid.uuid4())
    for bad in (
        {"training_plan_id": plan},
        {"plan_day_index": 1},
        {"training_plan_id": plan, "plan_day_index": -1},
        {"training_plan_id": plan, "plan_day_index": 31},
        {"training_plan_id": "nope", "plan_day_index": 1},
    ):
        assert api.post(SESSIONS, json=bad, headers=h).status_code == 422


def test_body_cannot_set_owner_status_or_summary(api: TestClient) -> None:
    h = member(api)
    for smuggled in ({"user_id": str(uuid.uuid4())}, {"status": "completed"}, {"summary": {}}):
        assert api.post(SESSIONS, json=smuggled, headers=h).status_code == 422


def test_same_idempotency_key_returns_the_same_session(api: TestClient, db: Session) -> None:
    h = {**member(api), "Idempotency-Key": "start-key-0001"}
    first = api.post(SESSIONS, json={}, headers=h)
    again = api.post(SESSIONS, json={}, headers=h)
    assert first.status_code == 201 and again.status_code == 200
    assert again.json() == first.json()
    assert db.scalar(select(func.count()).select_from(WorkoutSession)) == 1


def test_idempotency_keys_are_scoped_per_member(api: TestClient) -> None:
    key = {"Idempotency-Key": "shared-key-0001"}
    a, b = {**member(api), **key}, {**member(api), **key}
    sa, sb = api.post(SESSIONS, json={}, headers=a), api.post(SESSIONS, json={}, headers=b)
    assert sa.status_code == sb.status_code == 201
    assert sa.json()["id"] != sb.json()["id"]


def test_reusing_a_key_for_a_different_plan_is_409(api: TestClient) -> None:
    h = {**member(api), "Idempotency-Key": "start-key-0002"}
    api.post(SESSIONS, json={}, headers=h)
    r = api.post(
        SESSIONS, json={"training_plan_id": str(uuid.uuid4()), "plan_day_index": 0}, headers=h
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "idempotency_key_reuse"


def test_malformed_idempotency_key_is_422(api: TestClient) -> None:
    for bad in ("short", "has spaces in it", "x" * 129):
        h = {**member(api), "Idempotency-Key": bad}
        assert api.post(SESSIONS, json={}, headers=h).status_code == 422


# --- list / get ----------------------------------------------------------------------------------


def test_list_is_newest_first_and_paginated(api: TestClient) -> None:
    h = member(api)
    ids = [start(api, h) for _ in range(5)]
    newest_first = list(reversed(ids))

    page1 = api.get(SESSIONS, params={"limit": 2}, headers=h).json()
    page2 = api.get(SESSIONS, params={"limit": 2, "offset": 2}, headers=h).json()
    page3 = api.get(SESSIONS, params={"limit": 2, "offset": 4}, headers=h).json()
    got = [s["id"] for p in (page1, page2, page3) for s in p["items"]]
    assert got == newest_first
    assert (page1["total"], page1["limit"], page1["offset"]) == (5, 2, 0)
    assert len(page3["items"]) == 1


def test_list_limits_are_validated(api: TestClient) -> None:
    h = member(api)
    for bad in ({"limit": 0}, {"limit": 51}, {"offset": -1}):
        assert api.get(SESSIONS, params=bad, headers=h).status_code == 422


def test_get_with_a_malformed_id_is_422(api: TestClient) -> None:
    assert api.get(f"{SESSIONS}/not-a-uuid", headers=member(api)).status_code == 422


# --- delete --------------------------------------------------------------------------------------


def test_delete_removes_session_events_records_and_summary(api: TestClient, db: Session) -> None:
    h = member(api)
    sid = start(api, h)
    assert send(api, h, sid, [rep(sid, 0, 0), rep(sid, 0, 1), set_completed(sid, 0, 2)]).is_success
    assert api.post(f"{SESSIONS}/{sid}/complete", headers=h).status_code == 200
    assert db.scalar(select(func.count()).select_from(SessionEventRow)) == 3

    assert api.delete(f"{SESSIONS}/{sid}", headers=h).status_code == 204

    assert api.get(f"{SESSIONS}/{sid}", headers=h).status_code == 404
    assert api.get(SESSIONS, headers=h).json()["total"] == 0
    for name in ("session_events", "performance_records", "workout_sessions"):
        assert db.execute(select(func.count()).select_from(sa_table(name))).scalar_one() == 0


def test_delete_is_404_the_second_time(api: TestClient) -> None:
    h = member(api)
    sid = start(api, h)
    assert api.delete(f"{SESSIONS}/{sid}", headers=h).status_code == 204
    assert api.delete(f"{SESSIONS}/{sid}", headers=h).status_code == 404


def test_delete_leaves_other_sessions_alone(api: TestClient) -> None:
    h = member(api)
    keep, drop = start(api, h), start(api, h)
    api.delete(f"{SESSIONS}/{drop}", headers=h)
    assert [s["id"] for s in api.get(SESSIONS, headers=h).json()["items"]] == [keep]
