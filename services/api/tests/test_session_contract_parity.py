"""The pydantic session models must match the zod contract exported to JSON Schema
(blueprint §12). Compares field sets, required sets, enums/consts and bounds, recursively."""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.cue_rules import CUE_RULES_PATH
from app.schemas.session import SessionEvent, SessionEventBatch, SessionSummary
from app.services.catalog import load_catalog
from tests.schema_parity import schema_facets
from tests.test_session_schemas import VALID

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
        "ruleset_version": 4,
        "measurements": ["min_knee_angle_deg"],
    }
    for rule_id, rule in rules.items():
        assert rule["measurements"], f"{rule_id} declares no measurements"


def test_each_cue_rule_carries_its_exercise_catalogue_ruleset_version() -> None:
    catalogue = load_catalog()
    for rule_id, rule in json.loads(CUE_RULES_PATH.read_text()).items():
        assert rule["ruleset_version"] == catalogue[rule["exercise_id"]].ruleset_version, rule_id


# Null-payload parity (PR #45 review nit #1): zod `.optional()` rejects an explicit null, so the
# pydantic mirror must too. The zod side is packages/exercise-contracts/test/session-events.test.ts
# ("rejects an explicit null"); this list must stay the same as that one.
OPTIONAL_EVENT_FIELDS = [
    ("exercise_skipped", "reason"),
    ("set_completed", "perceived_difficulty"),
    ("set_completed", "note"),
    ("set_logged", "perceived_difficulty"),
    ("set_logged", "note"),
    ("set_logged", "duration_s"),
]


def test_optional_fields_are_exactly_the_non_nullable_optional_zod_fields() -> None:
    variants = schema_facets(_zod("session-event.schema.json"))["variants"]
    optional = {
        (event_type, name)
        for event_type, facets in variants.items()
        for name, field in facets["properties"].items()
        if name not in facets["required"] and not field["nullable"]
    }
    # set_logged.reps is the other half of the reps/duration pair: also optional, also not null
    assert optional == {*OPTIONAL_EVENT_FIELDS, ("set_logged", "reps")}


@pytest.mark.parametrize(("event_type", "field"), OPTIONAL_EVENT_FIELDS)
def test_optional_fields_reject_null_like_zod(event_type: str, field: str) -> None:
    event = dict(VALID[event_type])
    TypeAdapter(SessionEvent).validate_python(event)
    with pytest.raises(ValidationError, match="omit the field instead of sending null"):
        TypeAdapter(SessionEvent).validate_python({**event, field: None})
