"""The pydantic session models must match the zod contract exported to JSON Schema
(blueprint §12). Compares field sets, required sets, enums/consts and bounds, recursively."""

import json
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter

from app.schemas.cue_rules import CUE_RULES_PATH
from app.schemas.session import SessionEvent, SessionEventBatch, SessionSummary
from tests.schema_parity import schema_facets

SCHEMA_DIR = Path(__file__).resolve().parents[3] / "data" / "exercise-catalog" / "_schema"


def _zod(name: str) -> dict[str, Any]:
    schema: dict[str, Any] = json.loads((SCHEMA_DIR / name).read_text())
    return schema


def _pydantic(adapter: TypeAdapter[Any]) -> dict[str, Any]:
    schema: dict[str, Any] = adapter.json_schema(mode="validation")
    return schema


def test_session_event_union_matches() -> None:
    assert schema_facets(_pydantic(TypeAdapter(SessionEvent))) == schema_facets(
        _zod("session-event.schema.json")
    )


def test_session_event_batch_matches() -> None:
    assert schema_facets(_pydantic(TypeAdapter(SessionEventBatch))) == schema_facets(
        _zod("session-event-batch.schema.json")
    )


def test_session_summary_matches() -> None:
    assert schema_facets(_pydantic(TypeAdapter(SessionSummary))) == schema_facets(
        _zod("session-summary.schema.json")
    )


def test_every_event_type_is_mirrored() -> None:
    zod_types = set(schema_facets(_zod("session-event.schema.json"))["variants"])
    assert zod_types == {
        "rep_completed",
        "feedback_shown",
        "feedback_acknowledged",
        "feedback_dismissed",
        "tracking_degraded",
        "set_completed",
        "set_logged",
        "exercise_skipped",
    }


def test_cue_rules_file_is_the_one_the_api_loads() -> None:
    assert CUE_RULES_PATH == SCHEMA_DIR / "cue-rules.json"
    rules = json.loads(CUE_RULES_PATH.read_text())
    assert rules["squat.depth.shallow"] == {
        "exercise_id": "bodyweight_squat",
        "measurements": ["min_knee_angle_deg"],
    }
    for rule_id, rule in rules.items():
        assert rule["measurements"], f"{rule_id} declares no measurements"
