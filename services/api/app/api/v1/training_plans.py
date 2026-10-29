"""/training-plans (FR-02, blueprint §7). Thin: parse, call the service, map domain errors to HTTP.

Error bodies are `{"detail": {"code": ..., "message": ...}}`; the code is what clients branch on:
`profile_required` (409), `generation_in_progress` (409), `coach_busy` (503 + Retry-After),
`ai_unavailable` (503), `plan_not_found` (404).
"""

import math
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.plan import TrainingPlanOut
from app.schemas.workout_session import IDEMPOTENCY_KEY_PATTERN
from app.services.llm import LLMBusy, LLMClient, LLMUnavailable, get_llm_client
from app.services.plans import service as plans

router = APIRouter()

LLM = Annotated[LLMClient, Depends(get_llm_client)]
# Required: plan generation is the expensive, retried-by-clients call (blueprint §7).
IdempotencyKeyHeader = Annotated[
    str, Header(alias="Idempotency-Key", pattern=IDEMPOTENCY_KEY_PATTERN)
]
# When the provider gives no retry-after on a busy reply.
DEFAULT_BUSY_RETRY_S = 60
IN_PROGRESS_RETRY_S = 5


def _error(status_code: int, code: str, message: str, **headers: str) -> HTTPException:
    return HTTPException(
        status_code, detail={"code": code, "message": message}, headers=headers or None
    )


def _not_found() -> HTTPException:
    return _error(status.HTTP_404_NOT_FOUND, "plan_not_found", "Training plan not found")


@router.post(
    "/generate",
    response_model=TrainingPlanOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        202: {"model": TrainingPlanOut, "description": "Saved as needs_review"},
        409: {"description": "profile_required or generation_in_progress"},
        503: {"description": "coach_busy (with Retry-After) or ai_unavailable"},
    },
)
def generate_plan(
    user: CurrentUser,
    db: DbSession,
    llm: LLM,
    response: Response,
    idempotency_key: IdempotencyKeyHeader,
) -> Any:
    """Generate a new plan version from the caller's profile.

    201: a valid plan, now `active` (the previous active plan is `superseded`).
    202: the generator couldn't produce a valid plan after one repair; saved as `needs_review`
    with its issues, and the current plan stays active.
    200: the same Idempotency-Key was used before; that plan is returned, nothing is generated.
    """
    try:
        result = plans.generate_for_member(db, user, idempotency_key, llm)
    except plans.ProfileRequired as e:
        raise _error(
            status.HTTP_409_CONFLICT, "profile_required", "Create your profile first"
        ) from e
    except plans.GenerationInProgress as e:
        raise _error(
            status.HTTP_409_CONFLICT,
            "generation_in_progress",
            "A plan is already being generated",
            **{"Retry-After": str(IN_PROGRESS_RETRY_S)},
        ) from e
    except LLMBusy as e:
        retry = math.ceil(e.retry_after_s) if e.retry_after_s else DEFAULT_BUSY_RETRY_S
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "coach_busy",
            "The coach is busy right now. Try again later.",
            **{"Retry-After": str(retry)},
        ) from e
    except LLMUnavailable as e:
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "ai_unavailable",
            "Plan generation is unavailable right now.",
        ) from e

    out = plans.to_out(result.plan)
    if result.replayed:
        response.status_code = status.HTTP_200_OK
        response.headers["Idempotent-Replayed"] = "true"
    elif out.status == "needs_review":
        response.status_code = status.HTTP_202_ACCEPTED
    return out


@router.get("/current", response_model=TrainingPlanOut)
def current_plan(user: CurrentUser, db: DbSession) -> TrainingPlanOut:
    """The caller's active plan; 404 when there is none yet."""
    try:
        return plans.to_out(plans.get_current(db, user))
    except plans.PlanNotFound as e:
        raise _not_found() from e


@router.get("", response_model=list[TrainingPlanOut])
def list_plans(
    user: CurrentUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[TrainingPlanOut]:
    """Every version the caller has, newest first (FR-02: current plan and previous versions)."""
    return [plans.to_out(p) for p in plans.list_versions(db, user, limit)]


@router.get("/{plan_id}", response_model=TrainingPlanOut)
def get_plan(plan_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TrainingPlanOut:
    try:
        return plans.to_out(plans.get_own(db, user, plan_id))
    except plans.PlanNotFound as e:
        raise _not_found() from e
