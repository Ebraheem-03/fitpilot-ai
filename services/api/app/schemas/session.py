"""Workout-session events, batches and summaries (FR-06, FR-07, ADR-0011).

Mirror of packages/exercise-contracts/src/session-events.ts; the zod schemas are the source of
truth and tests/test_session_contract_parity.py fails when the two drift. Everything is
`extra="forbid"`: nothing can ride along with an event (no landmarks, frames or per-frame values).
"""

from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.schemas.cue_rules import cue_rule_violation
from app.schemas.exercise import Prescription

_SLUG = r"^[a-z0-9_]+$"

ExerciseId = Annotated[str, StringConstraints(pattern=_SLUG, max_length=64)]
RuleId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]+(\.[a-z0-9_]+)+$", max_length=64)]
MessageId = Annotated[str, StringConstraints(pattern=_SLUG, max_length=64)]
MeasurementKey = Annotated[str, StringConstraints(pattern=_SLUG, max_length=48)]
Finite = Annotated[float, Field(allow_inf_nan=False, strict=True)]

# Only the measurements a rule declares; the cap is a second line of defence against smuggling.
MAX_MEASUREMENTS_PER_CUE = 16
Measurements = Annotated[dict[MeasurementKey, Finite], Field(max_length=MAX_MEASUREMENTS_PER_CUE)]
Confidence = Annotated[float, Field(ge=0, le=1)]
Difficulty = Annotated[int, Field(ge=1, le=10)]
# Member-typed free text. Never logged (ADR-0011 §6).
MAX_NOTE_LENGTH = 500
Note = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NOTE_LENGTH)
]
SetIndex = Annotated[int, Field(ge=0, le=50)]
# Hard cap for one ingestion request (ADR-0011 §3).
MAX_EVENTS_PER_BATCH = 500

TrackingDegradedReason = Literal[
    "low_visibility", "out_of_frame", "low_light", "unsupported_view", "no_person", "slow_device"
]
SkipReason = Literal["no_equipment", "too_difficult", "discomfort", "no_time", "other"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class _EventBase(_Strict):
    session_id: UUID
    exercise_id: ExerciseId
    occurred_at: AwareDatetime
    # client-generated, makes event ingestion idempotent on retry
    idempotency_key: str = Field(min_length=8, max_length=128)


class RepCompletedEvent(_EventBase):
    type: Literal["rep_completed"]
    set_index: SetIndex
    rep_index: int = Field(ge=0, le=500)
    duration_ms: int = Field(gt=0, le=60_000)
    tracking_confidence: Confidence


class FeedbackShownEvent(_EventBase):
    type: Literal["feedback_shown"]
    rule_id: RuleId
    ruleset_version: int = Field(gt=0)
    message_id: MessageId
    measurements: Measurements
    tracking_confidence: Confidence

    @model_validator(mode="after")
    def _traces_to_a_declared_rule(self) -> Self:
        violation = cue_rule_violation(self.rule_id, self.exercise_id, self.measurements)
        if violation:
            raise ValueError(violation)
        return self


class FeedbackAcknowledgedEvent(_EventBase):
    type: Literal["feedback_acknowledged"]
    rule_id: RuleId
    message_id: MessageId


class FeedbackDismissedEvent(_EventBase):
    type: Literal["feedback_dismissed"]
    rule_id: RuleId
    message_id: MessageId


class TrackingDegradedEvent(_EventBase):
    """A span of unreliable tracking: starts at `occurred_at`, lasts `duration_ms`."""

    type: Literal["tracking_degraded"]
    reason: TrackingDegradedReason
    duration_ms: int = Field(ge=0, le=3_600_000)


class SetCompletedEvent(_EventBase):
    type: Literal["set_completed"]
    set_index: SetIndex
    reps: int = Field(ge=0, le=1000)
    perceived_difficulty: Difficulty | None = None
    note: Note | None = None


class SetLoggedEvent(_EventBase):
    """A set the member typed in themselves: exactly one of `reps` or `duration_s`."""

    type: Literal["set_logged"]
    set_index: SetIndex
    reps: int | None = Field(default=None, gt=0, le=1000)
    duration_s: int | None = Field(default=None, gt=0, le=3600)
    perceived_difficulty: Difficulty | None = None
    note: Note | None = None

    @model_validator(mode="after")
    def _exactly_one_measure(self) -> Self:
        if (self.reps is None) == (self.duration_s is None):
            raise ValueError("set_logged needs exactly one of reps or duration_s")
        return self


class ExerciseSkippedEvent(_EventBase):
    type: Literal["exercise_skipped"]
    reason: SkipReason | None = None


SessionEvent = Annotated[
    RepCompletedEvent
    | FeedbackShownEvent
    | FeedbackAcknowledgedEvent
    | FeedbackDismissedEvent
    | TrackingDegradedEvent
    | SetCompletedEvent
    | SetLoggedEvent
    | ExerciseSkippedEvent,
    Field(discriminator="type"),
]


def _one_session(events: list[SessionEvent]) -> list[SessionEvent]:
    if len({event.session_id for event in events}) > 1:
        raise ValueError("all events in a batch must belong to one session")
    return events


class SessionEventBatch(_Strict):
    """One ingestion request: all events belong to one session, at most 500."""

    events: Annotated[
        list[SessionEvent],
        Field(min_length=1, max_length=MAX_EVENTS_PER_BATCH),
        AfterValidator(_one_session),
    ]


# --- SessionSummary: computed server-side from stored events only (ADR-0011 §3) ---------------


class SummarySet(_Strict):
    """One recorded set. `source` says whether the camera counted it or the member typed it."""

    set_index: SetIndex
    source: Literal["tracked", "manual"]
    reps: int | None = Field(ge=0)
    duration_s: int | None = Field(ge=0)
    perceived_difficulty: Difficulty | None


class SummaryCue(_Strict):
    """A cue the member was shown, with the rule and measurements behind it (FR-06)."""

    rule_id: RuleId
    ruleset_version: int = Field(gt=0)
    message_id: MessageId
    shown_at: AwareDatetime
    measurements: Measurements
    response: Literal["acknowledged", "dismissed"] | None


class SummaryTrackingSpan(_Strict):
    reason: TrackingDegradedReason
    started_at: AwareDatetime
    duration_ms: int = Field(ge=0)


class ExerciseSummary(_Strict):
    exercise_id: ExerciseId
    status: Literal["completed", "skipped"]
    skip_reason: SkipReason | None
    prescription: Prescription
    # true when at least one set was counted by the camera
    tracked: bool
    sets: list[SummarySet] = Field(max_length=51)
    total_reps: int = Field(ge=0)
    total_duration_s: int = Field(ge=0)
    cues: list[SummaryCue] = Field(max_length=200)
    tracking_degraded: list[SummaryTrackingSpan] = Field(max_length=100)
    # the rating / note on the exercise's last set that carried one
    perceived_difficulty: Difficulty | None
    note: Note | None


class SessionSummary(_Strict):
    session_id: UUID
    started_at: AwareDatetime | None
    completed_at: AwareDatetime | None
    exercises: list[ExerciseSummary] = Field(max_length=50)
    # reported when the member completes the session (FR-07)
    perceived_difficulty: Difficulty | None
    note: Note | None
