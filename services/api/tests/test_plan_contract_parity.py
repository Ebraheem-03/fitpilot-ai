"""The pydantic plan models must match the zod contract exported to JSON Schema (FR-02, blueprint
§12), and enforce the same invariants as packages/exercise-contracts/test/training-plan.test.ts."""

import copy
import json
from pathlib import Path
from typing import Any, get_args

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.plan import (
    DAYS_OF_WEEK,
    DayOfWeek,
    PlanIssueCode,
    TrainingPlan,
    TrainingPlanOut,
)
from tests.schema_parity import schema_facets

SCHEMA_DIR = Path(__file__).resolve().parents[3] / "data" / "exercise-catalog" / "_schema"


def _zod(name: str) -> dict[str, Any]:
    schema: dict[str, Any] = json.loads((SCHEMA_DIR / name).read_text())
    return schema


def test_training_plan_matches() -> None:
    mirror = TypeAdapter(TrainingPlan).json_schema(mode="validation")
    assert schema_facets(mirror) == schema_facets(_zod("training-plan.schema.json"))


def test_training_plan_resource_matches() -> None:
    mirror = TypeAdapter(TrainingPlanOut).json_schema(mode="validation")
    assert schema_facets(mirror) == schema_facets(_zod("training-plan-resource.schema.json"))


def test_days_tuple_matches_the_literal() -> None:
    assert DAYS_OF_WEEK == get_args(DayOfWeek)


def test_issue_codes_match() -> None:
    zod = _zod("training-plan-resource.schema.json")
    codes = zod["properties"]["validation_issues"]["items"]["properties"]["code"]["enum"]
    assert codes == list(get_args(PlanIssueCode))


SQUAT = {
    "exercise_id": "bodyweight_squat",
    "sets": 3,
    "reps": 10,
    "duration_s": None,
    "rest_s": 60,
    "progression": "Add two reps a week until 15.",
}
PLANK = {**SQUAT, "exercise_id": "plank", "reps": None, "duration_s": 30}
PLAN: dict[str, Any] = {
    "days": [
        {"day_of_week": "monday", "focus": "Full body", "exercises": [SQUAT, PLANK]},
        {"day_of_week": "thursday", "focus": "Full body", "exercises": [SQUAT]},
    ],
    "rationale": "Two full-body days suit a beginner with no equipment.",
}


def _plan() -> dict[str, Any]:
    return copy.deepcopy(PLAN)


def _error_types(data: dict[str, Any]) -> list[str]:
    try:
        TrainingPlan.model_validate(data)
    except ValidationError as e:
        return [err["type"] for err in e.errors()]
    return []


def test_accepts_a_valid_plan() -> None:
    assert _error_types(_plan()) == []


@pytest.mark.parametrize("change", [{"duration_s": 30}, {"reps": None}])
def test_exactly_one_of_reps_or_duration(change: dict[str, Any]) -> None:
    plan = _plan()
    plan["days"][0]["exercises"][0] = {**SQUAT, **change}
    assert _error_types(plan) == ["reps_or_duration"]


def test_reps_and_duration_must_be_present_not_omitted() -> None:
    plan = _plan()
    plan["days"][0]["exercises"][0] = {k: v for k, v in SQUAT.items() if k != "duration_s"}
    assert _error_types(plan) == ["missing"]


def test_distinct_days_and_no_repeat_within_a_day() -> None:
    same_day = _plan()
    same_day["days"][1]["day_of_week"] = "monday"
    assert _error_types(same_day) == ["days_distinct"]
    twice = _plan()
    twice["days"][1]["exercises"].append(SQUAT)
    assert _error_types(twice) == ["duplicate_exercise"]


def test_bounds_and_closed_objects() -> None:
    plan = _plan()
    plan["days"][0]["exercises"][0] = {**SQUAT, "sets": 7}
    assert _error_types(plan) != []
    assert _error_types({**_plan(), "member_id": "x"}) != []
    assert _error_types({**_plan(), "days": []}) != []


def _resource(**overrides: Any) -> dict[str, Any]:
    return {
        "id": "0b3f6a52-6a0b-4f43-8d4e-5f4a5f6a7b8c",
        "version": 2,
        "status": "active",
        "prompt_version": "plan-v1",
        "model": "openai/gpt-oss-120b",
        "created_at": "2026-10-29T10:00:00.123456+00:00",
        "validation_issues": [],
        "plan": _plan(),
        **overrides,
    }


def test_resource_review_invariants() -> None:
    TrainingPlanOut.model_validate(_resource())
    TrainingPlanOut.model_validate(_resource(status="superseded"))
    issue = [{"code": "equipment", "message": "monday: dumbbell_row needs dumbbells"}]
    TrainingPlanOut.model_validate(
        _resource(status="needs_review", plan=None, validation_issues=issue)
    )
    with pytest.raises(ValidationError, match="plan must be null"):
        TrainingPlanOut.model_validate(_resource(status="needs_review", validation_issues=issue))
    with pytest.raises(ValidationError, match="validation_issues must be non-empty"):
        TrainingPlanOut.model_validate(_resource(status="needs_review", plan=None))
    with pytest.raises(ValidationError, match="plan must be null"):
        TrainingPlanOut.model_validate(_resource(plan=None))
    with pytest.raises(ValidationError):
        TrainingPlanOut.model_validate(_resource(validation_issues=issue))
