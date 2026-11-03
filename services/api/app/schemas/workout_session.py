"""Request/response bodies for /workout-sessions (FR-07). Events and summaries live in
`app.schemas.session`; these wrap them for the HTTP boundary."""

from datetime import datetime
from typing import Annotated, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.models import SessionStatus
from app.schemas.session import Difficulty, Note, SessionSummary

IDEMPOTENCY_KEY_PATTERN = r"^[A-Za-z0-9_.:\-]{8,128}$"
IdempotencyKey = Annotated[str, StringConstraints(pattern=IDEMPOTENCY_KEY_PATTERN)]
PlanDayIndex = Annotated[int, Field(ge=0, le=30)]


class StartSession(BaseModel):
    """Both plan fields or neither: a day index means nothing without its plan."""

    model_config = ConfigDict(extra="forbid")

    training_plan_id: UUID | None = None
    plan_day_index: PlanDayIndex | None = None

    @model_validator(mode="after")
    def _both_or_neither(self) -> Self:
        if (self.training_plan_id is None) != (self.plan_day_index is None):
            raise ValueError("training_plan_id and plan_day_index go together")
        return self


class CompleteSession(BaseModel):
    """Session-level answers given at the end (FR-07). Everything optional."""

    model_config = ConfigDict(extra="forbid")

    perceived_difficulty: Difficulty | None = None
    note: Note | None = None


class WorkoutSessionBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: SessionStatus
    training_plan_id: UUID | None
    plan_day_index: int | None
    started_at: datetime
    completed_at: datetime | None
    perceived_difficulty: int | None


class ExerciseProgress(BaseModel):
    """What the server has stored for one exercise of a started session (events only)."""

    # distinct set indexes with a stored `set_logged` or `set_completed`, ascending
    set_indexes: list[int]
    # an `exercise_skipped` event is stored (a later set does not clear it)
    skipped: bool
    # highest set index in any stored set_logged / set_completed / rep_completed (reps of a set
    # still in progress count); null when there is none
    highest_set_index: int | None


class WorkoutSessionOut(WorkoutSessionBrief):
    note: str | None
    # present once the session is completed
    summary: SessionSummary | None
    # While the session is `started` (GET and start responses, not the list): per exercise_id,
    # for exercises with a stored set, rep or skip. null once completed.
    progress: dict[str, ExerciseProgress] | None = None


class WorkoutSessionPage(BaseModel):
    items: list[WorkoutSessionBrief]
    total: int
    limit: int
    offset: int


class EventIngestResult(BaseModel):
    accepted: int
    # Events whose idempotency_key was already stored (or repeated in the batch): not stored again
    duplicates: int
    # Of those, how many carried a different payload than the one kept. The first stored event
    # wins; this only makes a misbehaving client visible.
    conflicting_duplicates: int = 0
