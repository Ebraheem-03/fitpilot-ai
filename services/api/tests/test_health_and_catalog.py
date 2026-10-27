from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_catalog_lists_squat() -> None:
    r = client.get("/api/v1/exercises")
    assert r.status_code == 200
    assert "bodyweight_squat" in {e["id"] for e in r.json()}


def test_unknown_exercise_is_404() -> None:
    assert client.get("/api/v1/exercises/made_up_move").status_code == 404
