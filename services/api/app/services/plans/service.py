"""Training plans for the calling member (FR-02): generate, current, versions, one by id.

Scoping: every read goes through the member's own id; another member's plan is "not found".

Generation (blueprint §7: tolerates retries):
- One generation per member at a time (transaction-scoped advisory lock). A concurrent request
  gets `GenerationInProgress`, so a client retry after a timeout can't start a second LLM call.
- The same Idempotency-Key returns the stored plan, without an LLM call.
- A valid plan becomes `active` and the previous active plan `superseded`. An invalid one is saved
  as `needs_review` with its issues and leaves the active plan alone (ADR-0004 amendment).
- `LLMBusy` / `LLMUnavailable` propagate and nothing is saved.

Logging (FR-13): ids, version, status, outcome, issue codes, tokens, latency. Never profile
values, prompts, plan text or idempotency keys.
"""

import logging
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import cast

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.logging import log_event
from app.models import PlanStatus, TrainingPlanRecord, User
from app.repositories import profiles
from app.repositories import training_plans as repo
from app.schemas.exercise import ExerciseContract
from app.schemas.plan import (
    DAYS_OF_WEEK,
    DayOfWeek,
    PlannedExercise,
    PlanValidationIssue,
    TrainingDay,
    TrainingPlan,
    TrainingPlanOut,
)
from app.services.catalog import load_catalog
from app.services.llm import LLMBusy, LLMClient, LLMUnavailable
from app.services.plans import fake_planner  # noqa: F401  (registers the fake responder)
from app.services.plans.generator import PlanDraft, generate_plan
from app.services.plans.inputs import PlanInputs

logger = logging.getLogger("fitpilot.plans")


class ProfileRequired(Exception):
    pass


class GenerationInProgress(Exception):
    pass


class PlanNotFound(Exception):
    pass


@dataclass(frozen=True)
class Generated:
    plan: TrainingPlanRecord
    replayed: bool


def generate_for_member(
    db: Session,
    user: User,
    idempotency_key: str,
    client: LLMClient,
    catalogue: Mapping[str, ExerciseContract] | None = None,
) -> Generated:
    if not repo.try_lock_generation(db, user.id):
        log_event(logger, "plan.generation_rejected", logging.WARNING, reason="in_progress")
        raise GenerationInProgress
    existing = repo.get_by_idempotency_key(db, user.id, idempotency_key)
    if existing is not None:
        log_event(logger, "plan.replayed", plan_id=str(existing.id), version=existing.version)
        return Generated(existing, replayed=True)

    profile = profiles.get(db, user.id)
    if profile is None:
        db.rollback()
        raise ProfileRequired
    inputs = PlanInputs.from_profile(profile)

    try:
        draft = generate_plan(inputs, catalogue or load_catalog(), client)
    except (LLMBusy, LLMUnavailable) as e:
        db.rollback()
        log_event(
            logger,
            "plan.generation_failed",
            logging.WARNING,
            reason="coach_busy" if isinstance(e, LLMBusy) else "ai_unavailable",
            cause=e.reason,
            provider=client.provider_name,
            model=client.model,
        )
        raise

    record = _save(db, user, idempotency_key, draft)
    try:
        db.commit()
    except IntegrityError:  # unreachable while the lock holds; the constraints are the backstop
        db.rollback()
        winner = repo.get_by_idempotency_key(db, user.id, idempotency_key)
        if winner is None:
            raise
        return Generated(winner, replayed=True)
    _log_generated(record, draft)
    return Generated(record, replayed=False)


def _save(db: Session, user: User, key: str, draft: PlanDraft) -> TrainingPlanRecord:
    active = draft.status == "active"
    if active:
        repo.supersede_active(db, user.id)
    plan = draft.plan
    exercises = []
    if plan is not None:
        for day in plan.days:
            for position, ex in enumerate(day.exercises):
                exercises.append(
                    {
                        "day_of_week": day.day_of_week,
                        "position": position,
                        **ex.model_dump(),
                    }
                )
    return repo.add(
        db,
        user_id=user.id,
        exercises=exercises,
        version=repo.next_version(db, user.id),
        status=PlanStatus.active if active else PlanStatus.needs_review,
        idempotency_key=key,
        prompt_version=draft.prompt_version,
        provider=draft.provider,
        model=draft.model,
        rationale=plan.rationale if plan else None,
        day_focus={d.day_of_week: d.focus for d in plan.days} if plan else {},
        generation_metadata=draft.metadata(),
        validation_issues=[{"code": i.code, "message": i.message} for i in draft.issues],
    )


def _log_generated(record: TrainingPlanRecord, draft: PlanDraft) -> None:
    meta = draft.metadata()
    fields = {
        "plan_id": str(record.id),
        "version": record.version,
        "status": record.status.value,
        "result": draft.result,
        "attempts": len(draft.calls),
        "first_issue_codes": list(draft.first_issue_codes),
        "prompt_version": draft.prompt_version,
        "provider": draft.provider,
        "model": draft.model,
        "tokens_in": meta["tokens_in"],
        "tokens_out": meta["tokens_out"],
        "latency_ms": meta["latency_ms"],
        "cost_usd": meta["cost_usd"],
        "defaults_applied": list(draft.inputs.defaults_applied),
    }
    if record.status is PlanStatus.needs_review:
        # FR-13: a rejected plan produces a diagnosable event
        codes = sorted({i.code for i in draft.issues})
        log_event(logger, "plan.escalated", logging.WARNING, issue_codes=codes, **fields)
    else:
        log_event(logger, "plan.generated", **fields)


# --- reads ---------------------------------------------------------------------------------


def get_current(db: Session, user: User) -> TrainingPlanRecord:
    plan = repo.get_active(db, user.id)
    if plan is None:
        raise PlanNotFound
    return plan


def list_versions(db: Session, user: User, limit: int) -> list[TrainingPlanRecord]:
    return repo.list_owned(db, user.id, limit)


def get_own(db: Session, user: User, plan_id: uuid.UUID, action: str = "get") -> TrainingPlanRecord:
    plan = repo.get_owned(db, user.id, plan_id)
    if plan is None:
        log_event(logger, "plan.not_found", logging.WARNING, plan_id=str(plan_id), action=action)
        raise PlanNotFound
    return plan


def plan_of(record: TrainingPlanRecord) -> TrainingPlan | None:
    """The plan as the member sees it: days Monday first, exercises in order. None while it
    needs review (a rejected draft is never shown)."""
    if record.status is PlanStatus.needs_review:
        return None
    by_day: dict[str, list[PlannedExercise]] = {}
    for ex in sorted(
        record.exercises, key=lambda e: (DAYS_OF_WEEK.index(e.day_of_week), e.position)
    ):
        by_day.setdefault(ex.day_of_week, []).append(
            PlannedExercise(
                exercise_id=ex.exercise_id,
                sets=ex.sets,
                reps=ex.reps,
                duration_s=ex.duration_s,
                rest_s=ex.rest_s,
                progression=ex.progression,
            )
        )
    return TrainingPlan(
        days=[
            TrainingDay(
                day_of_week=cast(DayOfWeek, day), focus=record.day_focus[day], exercises=exercises
            )
            for day, exercises in by_day.items()
        ],
        rationale=record.rationale or "",
    )


def to_out(record: TrainingPlanRecord) -> TrainingPlanOut:
    return TrainingPlanOut(
        id=record.id,
        version=record.version,
        status=record.status.value,
        prompt_version=record.prompt_version,
        model=record.model,
        created_at=record.created_at,
        validation_issues=[PlanValidationIssue.model_validate(i) for i in record.validation_issues],
        plan=plan_of(record),
    )


def day_count(record: TrainingPlanRecord) -> int:
    """How many days a session can reference (`plan_day_index` < this). 0 while in review."""
    plan = plan_of(record)
    return len(plan.days) if plan else 0
