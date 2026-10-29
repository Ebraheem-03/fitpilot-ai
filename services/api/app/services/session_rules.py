"""Checks an event batch must pass beyond its schema: the exercise exists in the catalogue, sets
match the exercise's prescription, tracked events belong to tracked exercises, and a cue response
refers to a cue that was actually shown (FR-06/FR-07, ADR-0011 §1).

Pure functions; error messages never echo member-typed values.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.schemas.exercise import TRACKED_CAPABILITIES, ExerciseContract
from app.schemas.session import (
    ExerciseSkippedEvent,
    FeedbackAcknowledgedEvent,
    FeedbackDismissedEvent,
    FeedbackShownEvent,
    RepCompletedEvent,
    SessionEvent,
    SetCompletedEvent,
    SetLoggedEvent,
    TrackingDegradedEvent,
)

# Events that exist only because the camera analysed the member: they need consent (ADR-0011 §4).
# `set_completed` is the closing record of a camera-counted set, so it is tracked data too.
TRACKED_EVENT_TYPES = frozenset(
    {
        "rep_completed",
        "feedback_shown",
        "feedback_acknowledged",
        "feedback_dismissed",
        "tracking_degraded",
        "set_completed",
    }
)

CueKey = tuple[str, str, str]  # (exercise_id, rule_id, message_id)


@dataclass(frozen=True)
class EventError:
    index: int
    code: str
    message: str


def is_camera_tracked(exercise: ExerciseContract) -> bool:
    return bool(TRACKED_CAPABILITIES.intersection(exercise.supported_capabilities))


def validate_events(
    events: Sequence[SessionEvent],
    catalog: Mapping[str, ExerciseContract],
    shown_before: set[CueKey],
) -> list[EventError]:
    """All problems in the batch, in order. `shown_before` = cues already stored for the session."""
    errors: list[EventError] = []
    shown = set(shown_before)
    for index, event in enumerate(events):
        exercise = catalog.get(event.exercise_id)
        if exercise is None:
            errors.append(EventError(index, "unknown_exercise", "exercise is not in the catalogue"))
            continue
        problem = _exercise_problem(event, exercise)
        if problem:
            errors.append(EventError(index, *problem))
            continue
        if isinstance(event, FeedbackShownEvent):
            shown.add((event.exercise_id, event.rule_id, event.message_id))
        elif isinstance(event, FeedbackAcknowledgedEvent | FeedbackDismissedEvent):
            if (event.exercise_id, event.rule_id, event.message_id) not in shown:
                errors.append(
                    EventError(
                        index,
                        "unknown_cue",
                        f"{event.type} refers to a cue that was not shown in this session",
                    )
                )
    return errors


def _exercise_problem(event: SessionEvent, exercise: ExerciseContract) -> tuple[str, str] | None:
    if isinstance(event, SetLoggedEvent):
        wants = "reps" if event.reps is not None else "duration"
        if exercise.prescription != wants:
            return (
                "prescription_mismatch",
                f"this exercise is prescribed by {exercise.prescription}, not {wants}",
            )
    elif isinstance(event, RepCompletedEvent | SetCompletedEvent):
        if not is_camera_tracked(exercise):
            return "not_tracked", "this exercise is not camera-tracked"
        if exercise.prescription != "reps":
            return "prescription_mismatch", "counted reps need a rep-prescribed exercise"
    elif isinstance(
        event,
        FeedbackShownEvent
        | FeedbackAcknowledgedEvent
        | FeedbackDismissedEvent
        | TrackingDegradedEvent,
    ):
        if not is_camera_tracked(exercise):
            return "not_tracked", "this exercise is not camera-tracked"
    elif isinstance(event, ExerciseSkippedEvent):
        return None
    return None
