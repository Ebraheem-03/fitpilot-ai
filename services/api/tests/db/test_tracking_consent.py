"""Tracking-data consent (ADR-0011 §4): PUT grants, DELETE withdraws, nothing else can set it."""

import uuid

from fastapi.testclient import TestClient

from tests.auth_helpers import bearer
from tests.db.session_helpers import CONSENT, PROFILE

ME = "/api/v1/profiles/me"


def profile_for(api: TestClient) -> dict[str, str]:
    headers = bearer(uuid.uuid4())
    assert api.post(PROFILE, json={"primary_goal": "strength"}, headers=headers).status_code == 201
    return headers


def test_new_profile_has_no_consent(api: TestClient) -> None:
    body = api.get(ME, headers=profile_for(api)).json()
    assert body["tracking_data_consent_at"] is None
    assert body["tracking_data_consent_version"] is None


def test_anonymous_is_401(api: TestClient) -> None:
    assert api.put(CONSENT, json={"version": 1}).status_code == 401
    assert api.delete(CONSENT).status_code == 401


def test_grant_records_version_and_server_time(api: TestClient) -> None:
    h = profile_for(api)
    r = api.put(CONSENT, json={"version": 1}, headers=h)
    assert r.status_code == 200
    assert r.json()["tracking_data_consent_version"] == 1
    assert r.json()["tracking_data_consent_at"] is not None
    assert api.get(ME, headers=h).json() == r.json()


def test_grant_is_idempotent_and_keeps_the_original_timestamp(api: TestClient) -> None:
    h = profile_for(api)
    first = api.put(CONSENT, json={"version": 1}, headers=h).json()
    second = api.put(CONSENT, json={"version": 1}, headers=h).json()
    assert second["tracking_data_consent_at"] == first["tracking_data_consent_at"]


def test_withdraw_clears_consent_and_is_idempotent(api: TestClient) -> None:
    h = profile_for(api)
    api.put(CONSENT, json={"version": 1}, headers=h)
    for _ in range(2):
        r = api.delete(CONSENT, headers=h)
        assert r.status_code == 200
        assert r.json()["tracking_data_consent_at"] is None
        assert r.json()["tracking_data_consent_version"] is None
    assert api.get(ME, headers=h).json()["tracking_data_consent_version"] is None


def test_can_grant_again_after_withdrawing(api: TestClient) -> None:
    h = profile_for(api)
    api.put(CONSENT, json={"version": 1}, headers=h)
    api.delete(CONSENT, headers=h)
    assert api.put(CONSENT, json={"version": 1}, headers=h).json()["tracking_data_consent_at"]


def test_unknown_version_is_422(api: TestClient) -> None:
    h = profile_for(api)
    for bad in (0, 2, -1):
        assert api.put(CONSENT, json={"version": bad}, headers=h).status_code == 422
    assert api.put(CONSENT, json={}, headers=h).status_code == 422
    assert api.put(CONSENT, json={"version": 1, "at": "2020-01-01"}, headers=h).status_code == 422


def test_consent_needs_a_profile(api: TestClient) -> None:
    h = bearer(uuid.uuid4())
    assert api.put(CONSENT, json={"version": 1}, headers=h).status_code == 404
    assert api.delete(CONSENT, headers=h).status_code == 404


def test_consent_is_per_member(api: TestClient) -> None:
    a, b = profile_for(api), profile_for(api)
    api.put(CONSENT, json={"version": 1}, headers=a)
    assert api.get(ME, headers=b).json()["tracking_data_consent_version"] is None
    api.delete(CONSENT, headers=b)  # B withdrawing never touches A
    assert api.get(ME, headers=a).json()["tracking_data_consent_version"] == 1


def test_profile_patch_and_create_cannot_set_consent(api: TestClient) -> None:
    h = profile_for(api)
    forged = {
        "tracking_data_consent_at": "2020-01-01T00:00:00Z",
        "tracking_data_consent_version": 1,
    }
    assert api.patch(ME, json=forged, headers=h).status_code == 422
    assert api.post(
        PROFILE, json={"primary_goal": "strength", **forged}, headers=h
    ).status_code in (
        409,
        422,
    )
    assert api.get(ME, headers=h).json()["tracking_data_consent_version"] is None
