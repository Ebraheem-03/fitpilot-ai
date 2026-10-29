"""Training plans (FR-02). Mirror of packages/exercise-contracts/src/training-plan.ts.

The zod schemas are the source of truth; tests/test_plan_contract_parity.py fails when the two
drift. `TrainingPlan` is the LLM's output shape: under Groq's strict JSON schema every field is
required, so "absent" is spelled `null` (reps / duration_s), never omitted.

The contract-level invariants raise `PydanticCustomError` with the issue code as the error type,
so the plan validator can report them under their own code instead of a generic "schema" error.
Catalogue- and member-dependent rules live in app/services/plans/validation.py.
"""

from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

DayOfWeek = Literal["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
DAYS_OF_WEEK: tuple[DayOfWeek, ...] = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)

# PLAN_LIMITS in training-plan.ts
SETS = (1, 6)
REPS = (1, 30)
DURATION_S = (10, 180)
REST_S = (15, 240)
EXERCISES_PER_DAY = (1, 8)
PROGRESSION_LENGTH = 200
FOCUS_LENGTH = 80
RATIONALE_LENGTH = 600

ExerciseId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]+$", max_length=64)]

PlanStatus = Literal["active", "needs_review", "superseded"]
PlanIssueCode = Literal[
    "generation_failed",
    "schema",
    "reps_or_duration",
    "days_distinct",
    "duplicate_exercise",
    "catalogue",
    "equipment",
    "days_count",
    "prescription",
    "session_length",
]
# The codes the contract itself raises (as the pydantic error type).
CONTRACT_ISSUE_CODES: frozenset[str] = frozenset(
    {"reps_or_duration", "days_distinct", "duplicate_exercise"}
)
MAX_PLAN_ISSUES = 50
ISSUE_MESSAGE_LENGTH = 500


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PlannedExercise(_Strict):
    # a catalogue id; checked against data/exercise-catalog by the plan validator
    exercise_id: ExerciseId
    sets: int = Field(ge=SETS[0], le=SETS[1])
    # set for rep-based exercises, null for timed ones
    reps: int | None = Field(ge=REPS[0], le=REPS[1])
    # set for timed exercises (seconds per set), null for rep-based ones
    duration_s: int | None = Field(ge=DURATION_S[0], le=DURATION_S[1])
    rest_s: int = Field(ge=REST_S[0], le=REST_S[1])
    # one sentence on how to progress week to week
    progression: str = Field(min_length=1, max_length=PROGRESSION_LENGTH)

    @model_validator(mode="after")
    def _exactly_one_measure(self) -> Self:
        if (self.reps is None) == (self.duration_s is None):
            raise PydanticCustomError(
                "reps_or_duration", "a planned exercise needs exactly one of reps or duration_s"
            )
        return self


class TrainingDay(_Strict):
    day_of_week: DayOfWeek
    focus: str = Field(min_length=1, max_length=FOCUS_LENGTH)
    exercises: list[PlannedExercise] = Field(
        min_length=EXERCISES_PER_DAY[0], max_length=EXERCISES_PER_DAY[1]
    )

    @model_validator(mode="after")
    def _no_repeated_exercise(self) -> Self:
        ids = [e.exercise_id for e in self.exercises]
        if len(set(ids)) != len(ids):
            raise PydanticCustomError(
                "duplicate_exercise",
                "{day}: an exercise appears more than once",
                {"day": self.day_of_week},
            )
        return self


class TrainingPlan(_Strict):
    days: list[TrainingDay] = Field(min_length=1, max_length=7)
    # at most 3 sentences on how the plan fits the goal; no medical claims
    rationale: str = Field(min_length=1, max_length=RATIONALE_LENGTH)

    @model_validator(mode="after")
    def _distinct_days(self) -> Self:
        days = [d.day_of_week for d in self.days]
        if len(set(days)) != len(days):
            raise PydanticCustomError("days_distinct", "day_of_week values must be distinct")
        return self


class PlanValidationIssue(_Strict):
    """Why a generated plan was rejected. Messages come from the validator, never the model."""

    code: PlanIssueCode
    message: str = Field(min_length=1, max_length=ISSUE_MESSAGE_LENGTH)


class TrainingPlanOut(_Strict):
    """A stored plan as the API returns it (zod `TrainingPlanResource`)."""

    id: UUID
    # 1, 2, 3… per member, one per generation (including needs_review ones)
    version: int = Field(gt=0)
    status: PlanStatus
    # the prompt that produced it, e.g. "plan-v1" (FR-13)
    prompt_version: str = Field(min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=128)
    created_at: AwareDatetime
    # empty unless needs_review
    validation_issues: list[PlanValidationIssue] = Field(max_length=MAX_PLAN_ISSUES)
    # null exactly when needs_review: a rejected draft is never shown to the member
    plan: TrainingPlan | None

    @model_validator(mode="after")
    def _review_invariants(self) -> Self:
        review = self.status == "needs_review"
        if review != (self.plan is None):
            raise ValueError("plan must be null exactly when status is needs_review")
        if review != bool(self.validation_issues):
            raise ValueError(
                "validation_issues must be non-empty exactly when status is needs_review"
            )
        return self
