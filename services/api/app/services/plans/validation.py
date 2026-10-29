"""Domain validation of a parsed TrainingPlan against the catalogue and the member (FR-02).

The contract (app/schemas/plan.py) already guarantees bounds, exactly one of reps/duration,
distinct days and no repeated exercise in a day. This adds what needs the catalogue and the
member's inputs. Messages are ours (never model text), so they are safe to store and show, and
they go back to the model on repair.
"""

from collections.abc import Mapping

from app.schemas.exercise import ExerciseContract
from app.schemas.plan import MAX_PLAN_ISSUES, TrainingDay, TrainingPlan
from app.services.llm import ValidationIssue
from app.services.plans.inputs import PlanInputs

# Session-length estimate (M3 S0 spike; also stated in the prompt):
#   minutes = WARMUP_MIN + sum(sets * (work_s + rest_s)) / 60, work_s = SECONDS_PER_REP * reps or
#   duration_s.
WARMUP_MIN = 5
SECONDS_PER_REP = 3


def eligible_exercises(
    catalogue: Mapping[str, ExerciseContract], equipment: tuple[str, ...]
) -> dict[str, ExerciseContract]:
    """Catalogue entries whose every required item the member owns. Bodyweight ones always fit."""
    owned = set(equipment)
    return {i: e for i, e in catalogue.items() if set(e.equipment) <= owned}


def estimate_minutes(day: TrainingDay) -> float:
    total_s = 0
    for ex in day.exercises:
        work_s = ex.reps * SECONDS_PER_REP if ex.reps is not None else ex.duration_s or 0
        total_s += ex.sets * (work_s + ex.rest_s)
    return WARMUP_MIN + total_s / 60


def validate_plan(
    plan: TrainingPlan, inputs: PlanInputs, catalogue: Mapping[str, ExerciseContract]
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    if len(plan.days) != inputs.days_per_week:
        issues.append(
            ValidationIssue(
                "days_count",
                f"the plan has {len(plan.days)} training days; days_per_week is "
                f"{inputs.days_per_week}",
            )
        )
    owned = set(inputs.equipment)
    for day in plan.days:
        name = day.day_of_week
        for ex in day.exercises:
            entry = catalogue.get(ex.exercise_id)
            if entry is None:
                issues.append(
                    ValidationIssue(
                        "catalogue", f"{name}: {ex.exercise_id} is not in the approved catalogue"
                    )
                )
                continue
            missing = [item for item in entry.equipment if item not in owned]
            if missing:
                issues.append(
                    ValidationIssue(
                        "equipment",
                        f"{name}: {entry.id} needs {', '.join(missing)}, which the member "
                        "doesn't have",
                    )
                )
            if entry.prescription == "reps" and ex.reps is None:
                issues.append(
                    ValidationIssue(
                        "prescription",
                        f"{name}: {entry.id} is reps-based: set reps, duration_s null",
                    )
                )
            if entry.prescription == "duration" and ex.duration_s is None:
                issues.append(
                    ValidationIssue(
                        "prescription",
                        f"{name}: {entry.id} is duration-based: set duration_s, reps null",
                    )
                )
        minutes = estimate_minutes(day)
        if minutes > inputs.session_minutes:
            issues.append(
                ValidationIssue(
                    "session_length",
                    f"{name}: estimated {minutes:.1f} min exceeds session_minutes "
                    f"{inputs.session_minutes} ({WARMUP_MIN} + sum of sets*(work_s+rest_s)/60)",
                )
            )
    return issues[:MAX_PLAN_ISSUES]
