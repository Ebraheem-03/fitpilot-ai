"""Training plans for the calling member (FR-02): generate, current, versions, one by id.

Scoping: every read goes through the member's own id; another member's plan is "not found".

Generation (blueprint §7: tolerates retries):
- One generation per member at a time, by a claim row (`plan_generation_claims`, migration 0005).
  A concurrent request gets `GenerationInProgress`, so a client retry after a timeout can't start
  a second LLM call. A claim older than `CLAIM_STALE_AFTER` (3 minutes) can be taken over, so a
  crashed worker never leaves a permanent lock.
- No database transaction or pooled connection is held during the provider call (up to a minute
  or more): claim (short transaction, commit) -> provider call -> save + supersede + release
  claim (short transaction). A worker that overran the timeout and lost its claim drops its result.
- The same Idempotency-Key returns the stored plan, without an LLM call. The plan is replayed as
  it was, whatever the member's profile says now.
- A valid plan becomes `active` and the previous active plan `superseded`. An invalid one is saved
  as `needs_review` with its issues and leaves the active plan alone (ADR-0004 amendment).
- `LLMBusy` / `LLMUnavailable` propagate and nothing is saved.

Logging (FR-13): ids, version, status, outcome, issue codes, tokens, latency. Never profile
values, prompts, plan text or idempotency keys.
"""

import logging
import math
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
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


class PlanLimitReached(Exception):
    """The member already made `plan_generations_per_day` plans in the last 24 h."""

    def __init__(self, retry_after_s: int) -> None:
        super().__init__("plan generation limit reached")
        self.retry_after_s = retry_after_s


class PlanNotFound(Exception):
    pass


GENERATION_WINDOW = timedelta(hours=24)


def _check_generation_cap(db: Session, user_id: uuid.UUID, max_per_day: int) -> None:
    """Raise PlanLimitReached when the member has `max_per_day` plans (any status) younger than
    24 h. Retry-After is the time until the oldest of those ages out."""
    created, now = repo.recent_generation_times(db, user_id, GENERATION_WINDOW)
    if len(created) < max_per_day:
        return
    # the row that must age out for a slot to open is the (len - max + 1)th oldest
    blocking = created[len(created) - max_per_day]
    retry = max(1, math.ceil((blocking + GENERATION_WINDOW - now).total_seconds()))
    log_event(logger, "plan.generation_rejected", logging.WARNING, reason="daily_limit")
    raise PlanLimitReached(retry)


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
    max_per_day: int = 5,
) -> Generated:
    # Plain values up front: the session is committed (and may expire `user`) between phases.
    user_id = user.id

    # Phase 1, short transaction: replay, preconditions, claim the member's generation slot.
    #
    # ORDER MATTERS, do not reorder: replay-check -> claim -> replay-check.
    # - The first check answers a retry without needing the slot (and before any profile check).
    # - The claim is the only thing that serialises generations for the member.
    # - The second check, made after the claim is ours, closes the window in which a competitor
    #   finished (saved its plan and dropped its claim in one transaction) between our first check
    #   and our claim. Without it we would call the LLM a second time for the same key. It is exact
    #   only because it runs after the claim: our claim cannot be granted until that competitor's
    #   transaction has committed, so its plan is then visible.
    existing = repo.get_by_idempotency_key(db, user_id, idempotency_key)
    if existing is not None:
        return _replayed(existing)
    profile = profiles.get(db, user_id)
    if profile is None:
        db.rollback()
        raise ProfileRequired
    inputs = PlanInputs.from_profile(profile)
    # Daily cap (security M2), before the claim so an over-limit member costs nothing. Replays
    # were answered above and are not generations.
    try:
        _check_generation_cap(db, user_id, max_per_day)
    except PlanLimitReached:
        db.rollback()
        raise
    claimed_at = repo.try_claim_generation(db, user_id, idempotency_key)
    if claimed_at is None:
        db.rollback()
        log_event(logger, "plan.generation_rejected", logging.WARNING, reason="in_progress")
        raise GenerationInProgress
    finished = repo.get_by_idempotency_key(db, user_id, idempotency_key)
    if finished is not None:
        repo.release_claim(db, user_id, idempotency_key, claimed_at)
        db.commit()
        return _replayed(finished)
    # Re-check under the claim: two requests that both passed the check above are now serialised,
    # so the later one sees the earlier one's plan and can't be the 6th.
    try:
        _check_generation_cap(db, user_id, max_per_day)
    except PlanLimitReached:
        repo.release_claim(db, user_id, idempotency_key, claimed_at)
        db.commit()
        raise
    db.commit()  # the claim is now visible; no transaction or connection is held past here

    # Phase 2: the provider call, with no database session in use.
    try:
        draft = generate_plan(inputs, catalogue or load_catalog(), client)
    except (LLMBusy, LLMUnavailable) as e:
        _release_claim(db, user_id, idempotency_key, claimed_at)
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
    except BaseException:
        _release_claim(db, user_id, idempotency_key, claimed_at)
        raise

    # Phase 3, short transaction: persist the result, supersede the old plan, drop the claim.
    return _persist(db, user_id, idempotency_key, claimed_at, draft)


def _replayed(plan: TrainingPlanRecord) -> Generated:
    log_event(logger, "plan.replayed", plan_id=str(plan.id), version=plan.version)
    return Generated(plan, replayed=True)


def _release_claim(db: Session, user_id: uuid.UUID, key: str, claimed_at: datetime) -> None:
    """Best effort, and only this worker's own claim (a takeover's is left alone): if this fails
    the claim goes stale and expires on its own."""
    try:
        db.rollback()
        repo.release_claim(db, user_id, key, claimed_at)
        db.commit()
    except Exception:
        db.rollback()
        log_event(logger, "plan.claim_release_failed", logging.ERROR)


def _persist(
    db: Session, user_id: uuid.UUID, key: str, claimed_at: datetime, draft: PlanDraft
) -> Generated:
    try:
        if not repo.lock_own_claim(db, user_id, key, claimed_at):
            # We overran the stale timeout and another generation took the slot over (even with
            # the same key). Saving now could interleave versions with theirs, so this result is
            # dropped; if they were retrying the same key and have finished, their plan is the
            # answer. Their claim is not ours to release.
            db.rollback()
            winner = repo.get_by_idempotency_key(db, user_id, key)
            if winner is not None:
                return _replayed(winner)
            log_event(logger, "plan.claim_lost", logging.WARNING)
            raise GenerationInProgress
        record = _save(db, user_id, key, draft)
        repo.release_claim(db, user_id, key, claimed_at)
        db.commit()
    except GenerationInProgress:
        raise
    except BaseException as e:
        # Any failure while saving (a constraint, a dropped connection, a bug) must not leave our
        # claim blocking the member's retries until it goes stale.
        _release_claim(db, user_id, key, claimed_at)
        if isinstance(e, IntegrityError):
            # unreachable while the claim holds; the constraints are the backstop
            winner = repo.get_by_idempotency_key(db, user_id, key)
            if winner is not None:
                return _replayed(winner)
        raise
    _log_generated(record, draft)
    return Generated(record, replayed=False)


def _save(db: Session, user_id: uuid.UUID, key: str, draft: PlanDraft) -> TrainingPlanRecord:
    active = draft.status == "active"
    if active:
        repo.supersede_active(db, user_id)
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
        user_id=user_id,
        exercises=exercises,
        version=repo.next_version(db, user_id),
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
