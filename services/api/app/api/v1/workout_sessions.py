"""/workout-sessions (FR-07, ADR-0011). Thin: parse, call the service, map domain errors to HTTP.

Error bodies are `{"detail": {"code": ..., "message": ...}}`; the code is what clients branch on.
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.api.limits import limited_route
from app.schemas.session import SessionEventBatch, SessionSummary
from app.schemas.workout_session import (
    IDEMPOTENCY_KEY_PATTERN,
    CompleteSession,
    EventIngestResult,
    StartSession,
    WorkoutSessionOut,
    WorkoutSessionPage,
)
from app.services import workout_sessions as sessions

router = APIRouter()

# ADR-0011 §3: a batch is at most 500 events and 64 KiB.
MAX_EVENTS_BODY_BYTES = 64 * 1024
events_router = APIRouter(route_class=limited_route(MAX_EVENTS_BODY_BYTES))

IdempotencyKeyHeader = Annotated[
    str | None, Header(alias="Idempotency-Key", pattern=IDEMPOTENCY_KEY_PATTERN)
]


def _error(status_code: int, code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code, detail={"code": code, "message": message, **extra})


def _not_found() -> HTTPException:
    return _error(status.HTTP_404_NOT_FOUND, "session_not_found", "Session not found")


@router.post("", response_model=WorkoutSessionOut, status_code=status.HTTP_201_CREATED)
def start_session(
    user: CurrentUser,
    db: DbSession,
    response: Response,
    body: StartSession | None = None,
    idempotency_key: IdempotencyKeyHeader = None,
) -> WorkoutSessionOut:
    """Start a workout. Same `Idempotency-Key` returns the same session (200 instead of 201)."""
    try:
        session, created = sessions.start(db, user, body or StartSession(), idempotency_key)
    except sessions.IdempotencyKeyReuse as e:
        raise _error(
            status.HTTP_409_CONFLICT,
            "idempotency_key_reuse",
            "This Idempotency-Key was used for a different request",
        ) from e
    except sessions.PlanNotFound as e:
        raise _error(status.HTTP_404_NOT_FOUND, "plan_not_found", "Training plan not found") from e
    except sessions.PlanDayOutOfRange as e:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "plan_day_out_of_range",
            "plan_day_index is not a day of that training plan",
        ) from e
    if not created:
        response.status_code = status.HTTP_200_OK
    return WorkoutSessionOut.model_validate(session)


@router.get("", response_model=WorkoutSessionPage)
def list_sessions(
    user: CurrentUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> WorkoutSessionPage:
    """The caller's sessions, newest first."""
    return sessions.list_own(db, user, limit, offset)


@router.get("/{session_id}", response_model=WorkoutSessionOut)
def get_session(session_id: uuid.UUID, user: CurrentUser, db: DbSession) -> WorkoutSessionOut:
    try:
        return sessions.get(db, user, session_id)
    except sessions.SessionNotFound as e:
        raise _not_found() from e


@events_router.post("/{session_id}/events", response_model=EventIngestResult)
def ingest_events(
    session_id: uuid.UUID, body: SessionEventBatch, user: CurrentUser, db: DbSession
) -> EventIngestResult:
    """Store a batch of derived events. Events already stored (same `idempotency_key`) are
    counted as duplicates, not stored twice. The whole batch is accepted or rejected."""
    try:
        return sessions.ingest_events(db, user, session_id, body)
    except sessions.SessionNotFound as e:
        raise _not_found() from e
    except sessions.SessionIdMismatch as e:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "session_id_mismatch",
            "Every event's session_id must equal the session in the URL",
        ) from e
    except sessions.SessionCompleted as e:
        raise _error(
            status.HTTP_409_CONFLICT, "session_completed", "Session is already completed"
        ) from e
    except sessions.TrackingConsentRequired as e:
        raise _error(
            status.HTTP_403_FORBIDDEN,
            "tracking_consent_required",
            "Tracked events can only be saved after the member agrees to save tracking data",
        ) from e
    except sessions.InvalidEvents as e:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "invalid_events",
            "Some events are not valid for this exercise",
            errors=[{"index": i.index, "code": i.code, "message": i.message} for i in e.errors],
        ) from e
    except sessions.EventLimitReached as e:
        raise _error(
            status.HTTP_409_CONFLICT,
            "event_limit_reached",
            "This session has reached its event limit",
        ) from e


@router.post("/{session_id}/complete", response_model=SessionSummary)
def complete_session(
    session_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    body: CompleteSession | None = None,
    idempotency_key: IdempotencyKeyHeader = None,
) -> SessionSummary:
    """Finish the workout. Idempotent: repeat calls return the first summary unchanged."""
    try:
        return sessions.complete(db, user, session_id, body, idempotency_key)
    except sessions.SessionNotFound as e:
        raise _not_found() from e


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    """Remove the session with its events, performance records and summary (ADR-0011 §5)."""
    try:
        sessions.delete(db, user, session_id)
    except sessions.SessionNotFound as e:
        raise _not_found() from e


router.include_router(events_router)
