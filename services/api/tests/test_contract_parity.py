import json
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter

from app.schemas.exercise import ExerciseContract
from app.schemas.profile import Equipment
from tests.schema_parity import schema_facets

SCHEMA = (
    Path(__file__).resolve().parents[3]
    / "data"
    / "exercise-catalog"
    / "_schema"
    / "exercise.schema.json"
)


def _exported() -> dict[str, Any]:
    schema: dict[str, Any] = json.loads(SCHEMA.read_text())
    return schema


def test_pydantic_matches_exported_zod_schema() -> None:
    """Fails when the TS contract and the Python mirror drift (blueprint §12 contract rule):
    fields, required sets, enums (capabilities, camera views, prescription) and bounds."""
    mirror = TypeAdapter(ExerciseContract).json_schema(mode="validation")
    assert schema_facets(mirror) == schema_facets(_exported())


def test_exercise_equipment_is_exactly_the_profile_equipment() -> None:
    """An exercise can only need equipment a member can say they have (FR-02)."""
    items = _exported()["properties"]["equipment"]["items"]
    assert items["enum"] == [member.value for member in Equipment]
