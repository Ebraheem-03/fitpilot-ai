"""Every tracking reason the contract allows reaches the session summary unchanged (FR-06/FR-07).
Pure: `build_summary` needs no database."""

import uuid
from typing import get_args

import pytest
from pydantic import TypeAdapter

from app.schemas.session import SessionEvent, TrackingDegradedReason
from app.services.catalog import load_catalog
from app.services.session_summary import build_summary
from tests.test_session_schemas import VALID

EVENT = TypeAdapter(SessionEvent)


def test_camera_stalled_is_a_reason_of_its_own() -> None:
    # PR #49 review: a stalled camera used to be recorded as slow_device
    assert "camera_stalled" in get_args(TrackingDegradedReason)
    assert "slow_device" in get_args(TrackingDegradedReason)


@pytest.mark.parametrize("reason", get_args(TrackingDegradedReason))
def test_summary_keeps_each_tracking_reason(reason: str) -> None:
    events = [
        EVENT.validate_python(
            {**VALID["tracking_degraded"], "reason": reason, "duration_ms": 2000}
        ),
        EVENT.validate_python({**VALID["set_completed"], "idempotency_key": "key-000002"}),
    ]
    summary, metrics = build_summary(
        session_id=uuid.UUID(VALID["tracking_degraded"]["session_id"]),
        started_at=None,
        completed_at=None,
        events=events,
        catalog=load_catalog(),
        perceived_difficulty=None,
        note=None,
    )
    [exercise] = summary.exercises
    assert [s.reason for s in exercise.tracking_degraded] == [reason]
    assert metrics[0].tracking_degraded_ms == 2000
