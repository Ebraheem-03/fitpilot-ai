import json
from pathlib import Path

from pydantic import BaseModel

from app.schemas.exercise import AnimationPhase, ExerciseAnimation, ExerciseContract

SCHEMA = (
    Path(__file__).resolve().parents[3]
    / "data"
    / "exercise-catalog"
    / "_schema"
    / "exercise.schema.json"
)


def _assert_same_fields(ts_properties: dict[str, object], model: type[BaseModel]) -> None:
    ts_fields = set(ts_properties)
    py_fields = set(model.model_fields)
    assert ts_fields == py_fields, (
        f"{model.__name__} TS-only: {ts_fields - py_fields}, Py-only: {py_fields - ts_fields}"
    )


def test_pydantic_fields_match_exported_zod_schema() -> None:
    """Fails when the TS contract and the Python mirror drift (blueprint §12 contract rule)."""
    schema = json.loads(SCHEMA.read_text())
    _assert_same_fields(schema["properties"], ExerciseContract)
    animation = schema["properties"]["animation"]
    _assert_same_fields(animation["properties"], ExerciseAnimation)
    _assert_same_fields(animation["properties"]["phases"]["items"]["properties"], AnimationPhase)
