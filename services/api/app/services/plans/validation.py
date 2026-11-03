"""Domain validation of a parsed TrainingPlan against the catalogue and the member (FR-02).

The contract (app/schemas/plan.py) already guarantees bounds, exactly one of reps/duration,
distinct days and no repeated exercise in a day. This adds what needs the catalogue and the
member's inputs. Messages are ours (never model text), so they are safe to store and show, and
they go back to the model on repair.
"""

import re
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

# Content safety (M3 security L4): the prompt forbids medical claims, but the model's free text
# (rationale, day focus, progression) is shown to members, so enforce it here too. Whole words,
# case-insensitive. A deny-list is a backstop, not a classifier: it catches the obvious wording.
MEDICAL_TERMS: frozenset[str] = frozenset(
    {
        "diagnose",
        "diagnosed",
        "diagnosis",
        "injury",
        "injuries",
        "injured",
        "pain",
        "painful",
        "rehab",
        "rehabilitation",
        "cure",
        "cured",
        "cures",
        "medication",
        "medications",
        "physiotherapy",
        "physiotherapist",
    }
)
_MEDICAL_RE = re.compile(r"\b(" + "|".join(sorted(MEDICAL_TERMS)) + r")\b", re.IGNORECASE)


def medical_term_in(text: str) -> str | None:
    """The first deny-listed word in `text` (lower-cased), or None."""
    match = _MEDICAL_RE.search(text)
    return match.group(1).lower() if match else None


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


def _check_medical(issues: list[ValidationIssue], where: str, text: str) -> None:
    term = medical_term_in(text)
    if term is not None:
        issues.append(
            ValidationIssue(
                "medical_claim",
                f"{where}: contains the medical term '{term}'. Don't diagnose, treat or "
                "promise recovery; describe training only",
            )
        )


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
    _check_medical(issues, "rationale", plan.rationale)
    for day in plan.days:
        name = day.day_of_week
        _check_medical(issues, f"{name} focus", day.focus)
        for ex in day.exercises:
            _check_medical(issues, f"{name} {ex.exercise_id} progression", ex.progression)
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
