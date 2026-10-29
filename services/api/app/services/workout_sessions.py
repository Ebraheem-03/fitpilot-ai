"""Workout sessions (FR-07, ADR-0011). Every operation is scoped to the calling member: a session
that is not theirs is indistinguishable from one that does not exist.

Logging (FR-13): ids, counts, event types, outcomes and timings only. Never measurement values,
notes, idempotency keys or payloads.
"""

import logging
import time
import uuid
from collections import Counter
from datetime import UTC, datetime

from pydantic import TypeAdapter
from sqlalchemy.orm import Session

from app.core.logging import log_event
from app.models import (
    PerformanceRecord,
    SessionEventType,
    SessionStatus,
    User,
    WorkoutSession,
)
from app.repositories import workout_sessions as repo
from app.schemas.session import SessionEvent, SessionEventBatch, SessionSummary
from app.schemas.workout_session import (
    CompleteSession,
    EventIngestResult,
    StartSession,
    WorkoutSessionBrief,
    WorkoutSessionOut,
    WorkoutSessionPage,
)
from app.services import profiles, session_rules
from app.services.catalog import load_catalog
from app.services.session_summary import build_summary

logger = logging.getLogger("fitpilot.sessions")

# Abuse guard, not a product limit: a long workout is a few hundred events.
MAX_EVENTS_PER_SESSION = 5000

_EVENT = TypeAdapter(SessionEvent)


class SessionNotFound(Exception):
    pass


class SessionCompleted(Exception):
    pass


class SessionIdMismatch(Exception):
    pass


class TrackingConsentRequired(Exception):
    pass


class InvalidEvents(Exception):
    def __init__(self, errors: list[session_rules.EventError]) -> None:
        super().__init__("invalid events")
        self.errors = errors


class EventLimitReached(Exception):
    pass


class IdempotencyKeyReuse(Exception):
    pass


def _owned(
    db: Session, user: User, session_id: uuid.UUID, action: str, *, for_update: bool = False
) -> WorkoutSession:
    session = repo.get_owned(db, user.id, session_id, for_update=for_update)
    if session is None:
        log_event(
            logger, "session.not_found", logging.WARNING, session_id=str(session_id), action=action
        )
        raise SessionNotFound
    return session


# --- lifecycle -------------------------------------------------------------------------------


def start(
    db: Session, user: User, data: StartSession, idempotency_key: str | None
) -> tuple[WorkoutSession, bool]:
    """Returns (session, created). The same Idempotency-Key returns the same session."""
    if idempotency_key is not None:
        existing = repo.get_by_start_key(db, user.id, idempotency_key)
        if existing is not None:
            return _replayed_start(existing, data), False

    gyms = repo.active_gym_ids(db, user.id)
    session = repo.add(
        db,
        user_id=user.id,
        gym_id=gyms[0] if len(gyms) == 1 else None,
        training_plan_id=data.training_plan_id,
        plan_day_index=data.plan_day_index,
        start_idempotency_key=idempotency_key,
    )
    if session is None:  # lost a race on the key: the winner's session is the answer
        assert idempotency_key is not None
        winner = repo.get_by_start_key(db, user.id, idempotency_key)
        assert winner is not None
        return _replayed_start(winner, data), False
    db.commit()
    log_event(
        logger,
        "session.started",
        session_id=str(session.id),
        has_plan=data.training_plan_id is not None,
        has_gym=session.gym_id is not None,
    )
    return session, True


def _replayed_start(session: WorkoutSession, data: StartSession) -> WorkoutSession:
    if (session.training_plan_id, session.plan_day_index) != (
        data.training_plan_id,
        data.plan_day_index,
    ):
        log_event(logger, "session.start_rejected", logging.WARNING, reason="idempotency_key_reuse")
        raise IdempotencyKeyReuse
    log_event(logger, "session.start_replayed", session_id=str(session.id))
    return session


def get(db: Session, user: User, session_id: uuid.UUID) -> WorkoutSessionOut:
    return WorkoutSessionOut.model_validate(_owned(db, user, session_id, "get"))


def list_own(db: Session, user: User, limit: int, offset: int) -> WorkoutSessionPage:
    rows, total = repo.list_page(db, user.id, limit, offset)
    return WorkoutSessionPage(
        items=[WorkoutSessionBrief.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def delete(db: Session, user: User, session_id: uuid.UUID) -> None:
    session = _owned(db, user, session_id, "delete", for_update=True)
    repo.delete_session(db, session)
    db.commit()
    log_event(logger, "session.deleted", session_id=str(session_id))


# --- events ----------------------------------------------------------------------------------


def ingest_events(
    db: Session, user: User, session_id: uuid.UUID, batch: SessionEventBatch
) -> EventIngestResult:
    started = time.perf_counter()
    events = batch.events
    session = _owned(db, user, session_id, "ingest_events", for_update=True)

    def reject(reason: str, exc: Exception, **extra: int) -> Exception:
        log_event(
            logger,
            "session.events_rejected",
            logging.WARNING,
            session_id=str(session_id),
            reason=reason,
            received=len(events),
            **extra,
        )
        db.rollback()  # release the row lock
        return exc

    if any(e.session_id != session_id for e in events):
        raise reject("session_id_mismatch", SessionIdMismatch())
    if session.status is SessionStatus.completed:
        raise reject("session_completed", SessionCompleted())
    if any(e.type in session_rules.TRACKED_EVENT_TYPES for e in events) and not (
        profiles.has_tracking_consent(db, user)
    ):
        raise reject("tracking_consent_required", TrackingConsentRequired())

    errors = session_rules.validate_events(
        events, load_catalog(), repo.shown_cue_keys(db, session_id)
    )
    if errors:
        raise reject("invalid_events", InvalidEvents(errors), invalid_count=len(errors))

    keys = {e.idempotency_key for e in events}
    new_keys = keys - repo.existing_keys(db, session_id, keys)
    if repo.count_events(db, session_id) + len(new_keys) > MAX_EVENTS_PER_SESSION:
        raise reject("event_limit_reached", EventLimitReached())

    seen: set[str] = set()
    rows = []
    for e in events:
        if e.idempotency_key in seen or e.idempotency_key not in new_keys:
            continue
        seen.add(e.idempotency_key)
        rows.append(
            {
                "session_id": session_id,
                "idempotency_key": e.idempotency_key,
                "type": SessionEventType(e.type),
                "exercise_id": e.exercise_id,
                "occurred_at": e.occurred_at,
                "payload": e.model_dump(mode="json"),
            }
        )
    accepted = repo.insert_events(db, rows)
    db.commit()

    result = EventIngestResult(accepted=accepted, duplicates=len(events) - accepted)
    log_event(
        logger,
        "session.events_ingested",
        session_id=str(session_id),
        received=len(events),
        accepted=result.accepted,
        duplicates=result.duplicates,
        type_counts=dict(Counter(e.type for e in events)),
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    return result


# --- completion ------------------------------------------------------------------------------


def complete(
    db: Session,
    user: User,
    session_id: uuid.UUID,
    data: CompleteSession | None,
    idempotency_key: str | None,
) -> SessionSummary:
    """Idempotent: the first call computes and stores the summary from the stored events; any
    later call (same Idempotency-Key or not, same body or not) returns that stored summary."""
    started = time.perf_counter()
    session = _owned(db, user, session_id, "complete", for_update=True)
    if session.status is SessionStatus.completed and session.summary is not None:
        db.rollback()
        log_event(logger, "session.completed", session_id=str(session_id), replayed=True)
        return SessionSummary.model_validate(session.summary)

    data = data or CompleteSession()
    rows = repo.stored_events(db, session_id)
    events = [_EVENT.validate_python(row.payload) for row in rows]
    completed_at = datetime.now(UTC)
    summary, metrics = build_summary(
        session_id=session_id,
        started_at=session.started_at,
        completed_at=completed_at,
        events=events,
        catalog=load_catalog(),
        perceived_difficulty=data.perceived_difficulty,
        note=data.note,
    )
    stored = summary.model_dump(mode="json")
    repo.mark_completed(
        db,
        session,
        completed_at=completed_at,
        perceived_difficulty=data.perceived_difficulty,
        note=data.note,
        summary=stored,
    )
    repo.add_performance_records(
        db,
        (
            PerformanceRecord(
                session_id=session_id,
                user_id=user.id,
                gym_id=session.gym_id,
                exercise_id=m.exercise_id,
                skipped=m.skipped,
                tracked=m.tracked,
                set_count=m.set_count,
                total_reps=m.total_reps,
                total_duration_s=m.total_duration_s,
                avg_tracking_confidence=m.avg_tracking_confidence,
                tracking_degraded_ms=m.tracking_degraded_ms,
                cue_count=m.cue_count,
                cue_counts=m.cue_counts,
            )
            for m in metrics
        ),
    )
    db.commit()
    log_event(
        logger,
        "session.completed",
        session_id=str(session_id),
        replayed=False,
        has_idempotency_key=idempotency_key is not None,
        event_count=len(events),
        exercise_count=len(summary.exercises),
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    return SessionSummary.model_validate(stored)
