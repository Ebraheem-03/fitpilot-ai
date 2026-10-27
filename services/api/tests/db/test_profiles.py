"""S4 (#10): POST /profiles, GET + PATCH /profiles/me (FR-01).

FR-01 acceptance: "Attempts to access another member's records are denied by the backend."
"""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.auth_helpers import bearer

URL = "/api/v1/profiles"
ME = "/api/v1/profiles/me"

VALID: dict[str, Any] = {
    "primary_goal": "strength",
    "experience_level": "intermediate",
    "days_per_week": 3,
    "session_minutes": 45,
    "equipment": ["dumbbells", "bench"],
}


def test_anonymous_requests_are_401(api: TestClient) -> None:
    assert api.get(ME).status_code == 401
    assert api.post(URL, json=VALID).status_code == 401
    assert api.patch(ME, json={"days_per_week": 4}).status_code == 401


def test_me_is_404_before_profile_exists(api: TestClient) -> None:
    assert api.get(ME, headers=bearer(uuid.uuid4())).status_code == 404


def test_create_then_read_own_profile(api: TestClient) -> None:
    a = bearer(uuid.uuid4())
    created = api.post(URL, json=VALID, headers=a)
    assert created.status_code == 201
    got = api.get(ME, headers=a)
    assert got.status_code == 200
    assert got.json() == created.json()
    assert {k: got.json()[k] for k in VALID} == VALID


def test_defaults_for_minimal_profile(api: TestClient) -> None:
    body = api.post(URL, json={"primary_goal": "mobility"}, headers=bearer(uuid.uuid4())).json()
    assert body["experience_level"] == "beginner"
    assert body["equipment"] == []
    assert body["days_per_week"] is None


def test_second_create_is_409_and_leaves_profile_unchanged(api: TestClient) -> None:
    a = bearer(uuid.uuid4())
    api.post(URL, json=VALID, headers=a)
    r = api.post(URL, json={**VALID, "primary_goal": "fat_loss"}, headers=a)
    assert r.status_code == 409
    assert api.get(ME, headers=a).json()["primary_goal"] == "strength"


def test_member_never_sees_another_members_profile(api: TestClient) -> None:
    a, b = bearer(uuid.uuid4()), bearer(uuid.uuid4())
    api.post(URL, json=VALID, headers=a)

    assert api.get(ME, headers=b).status_code == 404  # B has no profile; A's is not returned

    api.post(URL, json={"primary_goal": "mobility"}, headers=b)
    assert api.get(ME, headers=b).json()["primary_goal"] == "mobility"
    assert api.get(ME, headers=a).json()["primary_goal"] == "strength"


@pytest.mark.parametrize(
    "smuggled",
    [{"user_id": "A"}, {"role": "platform_admin"}, {"status": "active"}],
    ids=["user_id", "role", "status"],
)
def test_body_cannot_target_another_user_or_escalate(
    api: TestClient, smuggled: dict[str, str]
) -> None:
    a_id = uuid.uuid4()
    a, b = bearer(a_id), bearer(uuid.uuid4())
    api.post(URL, json=VALID, headers=a)
    payload = {k: (str(a_id) if v == "A" else v) for k, v in smuggled.items()}

    assert api.post(URL, json={**VALID, **payload}, headers=b).status_code == 422
    assert api.patch(ME, json={"primary_goal": "fat_loss", **payload}, headers=a).status_code == 422
    assert api.get(ME, headers=a).json()["primary_goal"] == "strength"


def test_patch_updates_only_own_profile(api: TestClient) -> None:
    a, b = bearer(uuid.uuid4()), bearer(uuid.uuid4())
    api.post(URL, json=VALID, headers=a)
    api.post(URL, json=VALID, headers=b)

    r = api.patch(ME, json={"days_per_week": 5}, headers=b)
    assert r.status_code == 200
    assert r.json()["days_per_week"] == 5
    assert r.json()["primary_goal"] == "strength"  # untouched fields stay
    assert api.get(ME, headers=a).json()["days_per_week"] == 3


def test_patch_without_profile_is_404(api: TestClient) -> None:
    assert api.patch(ME, json={"days_per_week": 2}, headers=bearer(uuid.uuid4())).status_code == 404


@pytest.mark.parametrize(
    "bad",
    [
        {"primary_goal": "become_superhuman"},
        {"experience_level": "godlike"},
        {"days_per_week": 0},
        {"days_per_week": 8},
        {"session_minutes": 5},
        {"equipment": ["jetpack"]},
        {"equipment": ["bench", "bench"]},
    ],
    ids=["goal", "experience", "days-low", "days-high", "minutes", "equipment", "dup-equipment"],
)
def test_invalid_values_are_422(api: TestClient, bad: dict[str, Any]) -> None:
    assert api.post(URL, json={**VALID, **bad}, headers=bearer(uuid.uuid4())).status_code == 422


def test_patch_cannot_null_required_goal(api: TestClient) -> None:
    a = bearer(uuid.uuid4())
    api.post(URL, json=VALID, headers=a)
    assert api.patch(ME, json={"primary_goal": None}, headers=a).status_code == 422
