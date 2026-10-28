"""Session events, batches and summaries (FR-06, FR-07, ADR-0011). Mirrors the zod tests in
packages/exercise-contracts/test/session-events.test.ts."""

from collections.abc import Callable
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.cue_rules import CUE_RULES, cue_rule_violation
from app.schemas.session import (
    MAX_EVENTS_PER_BATCH,
    SessionEvent,
    SessionEventBatch,
    SessionSummary,
)

SESSION = "0b3f6a52-6a0b-4f43-8d4e-5f4a5f6a7b8c"
EVENT = TypeAdapter(SessionEvent)


def _base(n: int = 1) -> dict[str, Any]:
    return {
        "session_id": SESSION,
        "exercise_id": "bodyweight_squat",
        "occurred_at": "2026-10-29T10:00:00Z",
        "idempotency_key": f"key-{n:06d}",
    }


def _feedback() -> dict[str, Any]:
    return {
        **_base(),
        "type": "feedback_shown",
        "rule_id": "squat.depth.shallow",
        "ruleset_version": 3,
        "message_id": "squat_depth_shallow_v1",
        "measurements": {"min_knee_angle_deg": 112},
        "tracking_confidence": 0.9,
    }


VALID: dict[str, dict[str, Any]] = {
    "rep_completed": {
        **_base(),
        "type": "rep_completed",
        "set_index": 0,
        "rep_index": 0,
        "duration_ms": 2400,
        "tracking_confidence": 0.8,
    },
    "feedback_shown": _feedback(),
    "feedback_acknowledged": {
        **_base(),
        "type": "feedback_acknowledged",
        "rule_id": "squat.depth.shallow",
        "message_id": "squat_depth_shallow_v1",
    },
    "feedback_dismissed": {
        **_base(),
        "type": "feedback_dismissed",
        "rule_id": "squat.depth.shallow",
        "message_id": "squat_depth_shallow_v1",
    },
    "tracking_degraded": {
        **_base(),
        "type": "tracking_degraded",
        "reason": "slow_device",
        "duration_ms": 900,
    },
    "set_completed": {
        **_base(),
        "type": "set_completed",
        "set_index": 0,
        "reps": 10,
        "perceived_difficulty": 6,
    },
    "set_logged": {**_base(), "type": "set_logged", "set_index": 0, "reps": 12, "note": "fine"},
    "exercise_skipped": {**_base(), "type": "exercise_skipped", "reason": "no_equipment"},
}


@pytest.mark.parametrize("event_type", list(VALID))
def test_accepts_each_event_type(event_type: str) -> None:
    EVENT.validate_python(VALID[event_type])


@pytest.mark.parametrize("event_type", list(VALID))
def test_rejects_fields_outside_the_contract(event_type: str) -> None:
    with pytest.raises(ValidationError):
        EVENT.validate_python({**VALID[event_type], "landmarks": [[0, 0, 0]]})


def test_rejects_ids_that_are_not_slugs() -> None:
    with pytest.raises(ValidationError):
        EVENT.validate_python({**VALID["rep_completed"], "exercise_id": "Squat; DROP"})
    with pytest.raises(ValidationError):
        EVENT.validate_python({**VALID["feedback_dismissed"], "rule_id": "no dots"})


def test_rejects_naive_timestamps() -> None:
    with pytest.raises(ValidationError):
        EVENT.validate_python({**VALID["rep_completed"], "occurred_at": "2026-10-29T10:00:00"})


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda e: e.update(rule_id="squat.made.up"), 'unknown rule_id "squat.made.up"'),
        (
            lambda e: e.update(exercise_id="push_up"),
            'rule_id "squat.depth.shallow" does not belong to exercise "push_up"',
        ),
        (
            lambda e: e.update(measurements={"min_knee_angle_deg": 100, "left_knee_x": 0.4}),
            'measurements not declared by "squat.depth.shallow": left_knee_x',
        ),
        (lambda e: e.update(rule_id="constructor.name"), 'unknown rule_id "constructor.name"'),
    ],
)
def test_feedback_shown_must_trace_to_a_declared_rule(
    mutate: Callable[[dict[str, Any]], object], message: str
) -> None:
    event = _feedback()
    mutate(event)
    with pytest.raises(ValidationError, match=message):
        EVENT.validate_python(event)


@pytest.mark.parametrize("value", ["100", float("nan"), float("inf")])
def test_feedback_measurements_must_be_finite_numbers(value: Any) -> None:
    event = _feedback()
    event["measurements"] = {"min_knee_angle_deg": value}
    with pytest.raises(ValidationError):
        EVENT.validate_python(event)


def test_set_logged_takes_reps_or_duration_never_both_or_neither() -> None:
    logged = VALID["set_logged"]
    message = "set_logged needs exactly one of reps or duration_s"
    with pytest.raises(ValidationError, match=message):
        EVENT.validate_python({**logged, "duration_s": 30})
    without_reps = {k: v for k, v in logged.items() if k != "reps"}
    with pytest.raises(ValidationError, match=message):
        EVENT.validate_python(without_reps)
    EVENT.validate_python({**without_reps, "duration_s": 45})


def test_bounds_notes_and_difficulty() -> None:
    with pytest.raises(ValidationError):
        EVENT.validate_python({**VALID["set_logged"], "note": "x" * 501})
    with pytest.raises(ValidationError):
        EVENT.validate_python({**VALID["set_completed"], "perceived_difficulty": 11})


def _events(n: int) -> list[dict[str, Any]]:
    return [{**VALID["rep_completed"], **_base(i + 1)} for i in range(n)]


def test_batch_cap() -> None:
    SessionEventBatch.model_validate({"events": _events(MAX_EVENTS_PER_BATCH)})
    with pytest.raises(ValidationError):
        SessionEventBatch.model_validate({"events": _events(MAX_EVENTS_PER_BATCH + 1)})
    with pytest.raises(ValidationError):
        SessionEventBatch.model_validate({"events": []})


def test_batch_must_be_one_session() -> None:
    events = _events(2)
    events[1]["session_id"] = "7c1f0e2a-0000-4000-8000-000000000000"
    with pytest.raises(ValidationError, match="one session"):
        SessionEventBatch.model_validate({"events": events})


def test_batch_rejects_extra_top_level_fields() -> None:
    with pytest.raises(ValidationError):
        SessionEventBatch.model_validate({"events": _events(1), "user_id": "x"})


def _summary() -> dict[str, Any]:
    return {
        "session_id": SESSION,
        "started_at": "2026-10-29T10:00:00Z",
        "completed_at": "2026-10-29T10:20:00Z",
        "perceived_difficulty": 7,
        "note": None,
        "exercises": [
            {
                "exercise_id": "bodyweight_squat",
                "status": "completed",
                "skip_reason": None,
                "prescription": "reps",
                "tracked": True,
                "sets": [
                    {
                        "set_index": 0,
                        "source": "tracked",
                        "reps": 10,
                        "duration_s": None,
                        "perceived_difficulty": 6,
                    }
                ],
                "total_reps": 10,
                "total_duration_s": 0,
                "cues": [
                    {
                        "rule_id": "squat.depth.shallow",
                        "ruleset_version": 3,
                        "message_id": "squat_depth_shallow_v1",
                        "shown_at": "2026-10-29T10:05:00Z",
                        "measurements": {"min_knee_angle_deg": 112},
                        "response": "acknowledged",
                    }
                ],
                "tracking_degraded": [
                    {
                        "reason": "low_light",
                        "started_at": "2026-10-29T10:06:00Z",
                        "duration_ms": 1200,
                    }
                ],
                "perceived_difficulty": 6,
                "note": None,
            },
            {
                "exercise_id": "plank",
                "status": "completed",
                "skip_reason": None,
                "prescription": "duration",
                "tracked": False,
                "sets": [
                    {
                        "set_index": 0,
                        "source": "manual",
                        "reps": None,
                        "duration_s": 40,
                        "perceived_difficulty": None,
                    }
                ],
                "total_reps": 0,
                "total_duration_s": 40,
                "cues": [],
                "tracking_degraded": [],
                "perceived_difficulty": None,
                "note": "Held it longer than last week",
            },
        ],
    }


def test_accepts_summary_with_tracked_and_manual_exercises() -> None:
    SessionSummary.model_validate(_summary())


def test_summary_is_closed_to_extra_fields_at_every_level() -> None:
    with pytest.raises(ValidationError):
        SessionSummary.model_validate({**_summary(), "user_id": "x"})
    s = _summary()
    s["exercises"][0]["cues"][0]["landmarks"] = []
    with pytest.raises(ValidationError):
        SessionSummary.model_validate(s)


def test_summary_cues_must_name_a_rule_id() -> None:
    s = _summary()
    s["exercises"][0]["cues"][0]["rule_id"] = "not a rule"
    with pytest.raises(ValidationError):
        SessionSummary.model_validate(s)


def test_declared_rules_are_loaded_from_the_generated_file() -> None:
    assert CUE_RULES["squat.depth.shallow"]["measurements"] == ["min_knee_angle_deg"]
    assert (
        cue_rule_violation("squat.depth.shallow", "bodyweight_squat", ["min_knee_angle_deg"])
        is None
    )
