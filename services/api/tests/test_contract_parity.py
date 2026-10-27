import json
from pathlib import Path

from app.schemas.exercise import ExerciseContract

SCHEMA = (
    Path(__file__).resolve().parents[3]
    / "data"
    / "exercise-catalog"
    / "_schema"
    / "exercise.schema.json"
)


def test_pydantic_fields_match_exported_zod_schema() -> None:
    """Fails when the TS contract and the Python mirror drift (blueprint §12 contract rule)."""
    ts_fields = set(json.loads(SCHEMA.read_text())["properties"])
    py_fields = set(ExerciseContract.model_fields)
    assert ts_fields == py_fields, (
        f"TS-only: {ts_fields - py_fields}, Py-only: {py_fields - ts_fields}"
    )
