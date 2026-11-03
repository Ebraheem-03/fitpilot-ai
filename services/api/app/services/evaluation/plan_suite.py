"""Plan-generation eval suite: fixtures, scoring and aggregation (FR-02, FR-13, blueprint §10).

The fixtures (`data/evaluation-fixtures/ai/plans/suite.json`) are synthetic profiles with
expected *properties*, never exact plans. Every generated plan is scored on:

- validity: parsed into TrainingPlan (schema) and passed domain validation, on the first call and
  after the one repair;
- constraint adherence of every *accepted* plan, re-checked here independently of
  `plans/validation.py` (catalogue, equipment, days, session length, prescription). Anything
  below 100% means the generator accepted a plan it should have rejected;
- expected properties (reported, not gated): the shortest day fills `min_fill` of the session,
  owned equipment named in `uses_equipment` is used;
- escalation correctness: expected escalations end in needs_review, feasible profiles don't;
- operations: latency, tokens, list-price cost, 429s.

Pure functions only. The runner (plans.py) does the calling, pacing and stopping.
"""

import json
import math
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import ExperienceLevel, Goal
from app.schemas.exercise import ExerciseContract
from app.schemas.plan import TrainingDay, TrainingPlan
from app.schemas.profile import Equipment
from app.services.llm import ValidationIssue
from app.services.plans.generator import PlanDraft
from app.services.plans.inputs import PlanInputs
from app.services.plans.validation import SECONDS_PER_REP, WARMUP_MIN

REPO_ROOT = Path(__file__).resolve().parents[5]
SUITE_DIR = REPO_ROOT / "data" / "evaluation-fixtures" / "ai" / "plans"
SUITE_PATH = SUITE_DIR / "suite.json"
OFFLINE_REPLIES_PATH = SUITE_DIR / "offline-replies.json"

ExpectedOutcome = Literal["active", "needs_review", "either"]
RunResult = Literal["valid_first_try", "repaired", "escalated", "error"]
CONSTRAINTS = ("catalogue", "equipment", "days", "session_length", "prescription")
PROPERTIES = ("min_fill", "uses_equipment")
# The API's floor (app/schemas/profile.py). Fixtures may go below it only to force an escalation.
API_MIN_SESSION_MINUTES = 10
MAX_FAILURES_PER_RUN = 3
MAX_ISSUES_PER_FAILURE = 3


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FixtureInputs(_Strict):
    primary_goal: Goal
    experience_level: ExperienceLevel
    days_per_week: int = Field(ge=1, le=7)
    session_minutes: int = Field(ge=1, le=180)
    equipment: list[Equipment]

    def plan_inputs(self) -> PlanInputs:
        return PlanInputs(
            primary_goal=str(self.primary_goal),
            experience_level=str(self.experience_level),
            days_per_week=self.days_per_week,
            session_minutes=self.session_minutes,
            equipment=tuple(sorted(str(e) for e in self.equipment)),
        )


class Expectation(_Strict):
    outcome: ExpectedOutcome
    # shortest day's estimated minutes / session_minutes, for accepted plans
    min_fill: float | None = Field(default=None, gt=0, le=1)
    # owned equipment the plan should use at least once
    uses_equipment: list[Equipment] = []


class PlanFixture(_Strict):
    id: str = Field(pattern=r"^p\d{2}_[a-z0-9_]+$")
    description: str = Field(min_length=1)
    inputs: FixtureInputs
    expect: Expectation

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if (
            self.inputs.session_minutes < API_MIN_SESSION_MINUTES
            and self.expect.outcome != "needs_review"
        ):
            raise ValueError(
                f"{self.id}: session_minutes below the API floor is only for escalation fixtures"
            )
        missing = set(self.expect.uses_equipment) - set(self.inputs.equipment)
        if missing:
            raise ValueError(f"{self.id}: uses_equipment lists items the profile doesn't own")
        return self


class Gate(_Strict):
    valid_after_repair_min: float = Field(ge=0, le=1)
    constraint_adherence_min: float = Field(ge=0, le=1)
    expected_escalation_min: float = Field(ge=0, le=1)
    false_escalation_max: float = Field(ge=0, le=1)
    min_scored_plans: int = Field(ge=1)


class Suite(_Strict):
    suite_version: int = Field(ge=1)
    description: str
    gate: Gate
    profiles: list[PlanFixture] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique(self) -> Self:
        ids = [p.id for p in self.profiles]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate profile ids")
        keys = [p.inputs.plan_inputs().fixture_key() for p in self.profiles]
        if len(set(keys)) != len(keys):
            raise ValueError("two profiles have identical inputs")
        if not any(p.expect.outcome == "needs_review" for p in self.profiles):
            raise ValueError("the suite needs at least one escalation-expected profile")
        return self


class ReplySpec(_Strict):
    """One scripted fake reply for the offline run."""

    kind: Literal["planner", "json_validate_failed", "rate_limited", "busy", "unavailable"]
    # planner only: break the rule-based plan in one known way
    mutate: Literal["drop_day", "unknown_exercise", "add_dumbbells", "overlong"] | None = None
    retry_after_s: float | None = None


class OfflineReplies(_Strict):
    description: str
    replies: dict[str, list[ReplySpec]]


def load_suite(path: Path = SUITE_PATH) -> Suite:
    """Fails loudly on a malformed suite; nothing is skipped."""
    return Suite.model_validate(json.loads(path.read_text()))


def load_offline_replies(suite: Suite, path: Path = OFFLINE_REPLIES_PATH) -> OfflineReplies:
    replies = OfflineReplies.model_validate(json.loads(path.read_text()))
    unknown = set(replies.replies) - {p.id for p in suite.profiles}
    if unknown:
        raise ValueError(f"offline replies for unknown profiles: {sorted(unknown)}")
    return replies


# --- Independent constraint and property checks (deliberately not plans/validation.py).


def day_minutes(day: TrainingDay) -> float:
    """The session-length estimate stated in the prompt: warm-up + sets * (work + rest)."""
    seconds = 0
    for ex in day.exercises:
        work = SECONDS_PER_REP * ex.reps if ex.reps is not None else (ex.duration_s or 0)
        seconds += ex.sets * (work + ex.rest_s)
    return WARMUP_MIN + seconds / 60


def check_constraints(
    plan: TrainingPlan, inputs: PlanInputs, catalogue: Mapping[str, ExerciseContract]
) -> dict[str, bool]:
    owned = set(inputs.equipment)
    exercises = [ex for day in plan.days for ex in day.exercises]
    known = [(ex, catalogue[ex.exercise_id]) for ex in exercises if ex.exercise_id in catalogue]
    weekdays = {d.day_of_week for d in plan.days}
    return {
        "catalogue": len(known) == len(exercises),
        "equipment": all(set(entry.equipment) <= owned for _, entry in known),
        "days": len(plan.days) == inputs.days_per_week == len(weekdays),
        "session_length": all(day_minutes(d) <= inputs.session_minutes for d in plan.days),
        "prescription": all(
            (ex.reps is not None) == (entry.prescription == "reps")
            and (ex.duration_s is not None) == (entry.prescription == "duration")
            for ex, entry in known
        ),
    }


def check_properties(
    plan: TrainingPlan,
    inputs: PlanInputs,
    expect: Expectation,
    catalogue: Mapping[str, ExerciseContract],
) -> dict[str, bool]:
    result: dict[str, bool] = {}
    if expect.min_fill is not None:
        shortest = min(day_minutes(d) for d in plan.days)
        result["min_fill"] = shortest / inputs.session_minutes >= expect.min_fill
    if expect.uses_equipment:
        used = {
            item
            for day in plan.days
            for ex in day.exercises
            if ex.exercise_id in catalogue
            for item in catalogue[ex.exercise_id].equipment
        }
        result["uses_equipment"] = {str(e) for e in expect.uses_equipment} <= used
    return result


# --- One scored generation.


@dataclass(frozen=True)
class PlanRun:
    fixture_id: str
    expected: ExpectedOutcome
    result: RunResult
    error: str | None = None
    first_call_parsed: bool = False
    final_call_parsed: bool = False
    first_issue_codes: tuple[str, ...] = ()
    # escalated only: our validator's messages (never model text)
    final_issues: tuple[ValidationIssue, ...] = ()
    constraints: dict[str, bool] = field(default_factory=dict)
    properties: dict[str, bool] = field(default_factory=dict)
    calls: int = 0
    latency_ms: float = 0.0
    first_latency_ms: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    list_cost_usd: float = 0.0
    rate_limited: int = 0

    @property
    def accepted(self) -> bool:
        return self.result in ("valid_first_try", "repaired")

    @property
    def outcome_as_expected(self) -> bool:
        if self.result == "error" or self.expected == "either":
            return True
        return (self.expected == "needs_review") == (self.result == "escalated")


def score_draft(
    fixture: PlanFixture,
    draft: PlanDraft,
    catalogue: Mapping[str, ExerciseContract],
    *,
    rate_limited: int = 0,
) -> PlanRun:
    inputs = fixture.inputs.plan_inputs()
    calls = draft.calls
    accepted = draft.status == "active" and draft.plan is not None
    return PlanRun(
        fixture_id=fixture.id,
        expected=fixture.expect.outcome,
        result=draft.result,
        first_call_parsed=bool(calls) and calls[0].outcome == "ok",
        final_call_parsed=bool(calls) and calls[-1].outcome == "ok",
        first_issue_codes=draft.first_issue_codes,
        final_issues=draft.issues,
        constraints=check_constraints(draft.plan, inputs, catalogue)
        if accepted and draft.plan
        else {},
        properties=check_properties(draft.plan, inputs, fixture.expect, catalogue)
        if accepted and draft.plan
        else {},
        calls=len(calls),
        latency_ms=round(sum(c.latency_ms for c in calls), 1),
        first_latency_ms=calls[0].latency_ms if calls else 0.0,
        tokens_in=sum(c.tokens_in for c in calls),
        tokens_out=sum(c.tokens_out for c in calls),
        list_cost_usd=sum(c.list_cost_usd for c in calls),
        rate_limited=rate_limited,
    )


def failed_run(fixture: PlanFixture, reason: str, *, rate_limited: int = 0) -> PlanRun:
    """The model couldn't be asked (busy, unavailable): no plan, excluded from the rates."""
    return PlanRun(
        fixture_id=fixture.id,
        expected=fixture.expect.outcome,
        result="error",
        error=reason,
        rate_limited=rate_limited,
    )


# --- Aggregation.


def ratio(n: int, of: int) -> dict[str, Any]:
    return {"n": n, "of": of, "rate": round(n / of, 4) if of else None}


def percentile(values: Sequence[float], q: float) -> float | None:
    """Nearest-rank percentile; None for no values."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(q * len(ordered)) - 1)]


def aggregate(runs: Sequence[PlanRun]) -> dict[str, Any]:
    scored = [r for r in runs if r.result != "error"]
    feasible = [r for r in scored if r.expected == "active"]
    must_escalate = [r for r in scored if r.expected == "needs_review"]
    either = [r for r in scored if r.expected == "either"]
    accepted = [r for r in scored if r.accepted]

    def count(rs: Sequence[PlanRun], pred: Any) -> int:
        return sum(1 for r in rs if pred(r))

    constraints = {
        c: ratio(count(accepted, lambda r, c=c: r.constraints.get(c, False)), len(accepted))
        for c in CONSTRAINTS
    }
    constraints["all"] = ratio(
        count(accepted, lambda r: all(r.constraints.get(c, False) for c in CONSTRAINTS)),
        len(accepted),
    )
    properties = {}
    for p in PROPERTIES:
        judged = [r for r in accepted if p in r.properties]
        properties[p] = ratio(count(judged, lambda r, p=p: r.properties[p]), len(judged))

    plan_latency = [r.latency_ms / 1000 for r in scored]
    first_latency = [r.first_latency_ms / 1000 for r in scored]
    tokens_in = sum(r.tokens_in for r in scored)
    tokens_out = sum(r.tokens_out for r in scored)
    calls = sum(r.calls for r in scored)
    cost = sum(r.list_cost_usd for r in scored)
    per_fixture: dict[str, dict[str, int]] = {}
    for r in runs:
        row = per_fixture.setdefault(
            r.fixture_id, {"valid_first_try": 0, "repaired": 0, "escalated": 0, "error": 0}
        )
        row[r.result] += 1

    return {
        "attempted": len(runs),
        "scored": len(scored),
        "errors": dict(sorted(Counter(r.error or "" for r in runs if r.result == "error").items())),
        "validity": {
            "feasible_plans": len(feasible),
            "schema_valid_first_try": ratio(
                count(feasible, lambda r: r.first_call_parsed), len(feasible)
            ),
            "valid_first_try": ratio(
                count(feasible, lambda r: r.result == "valid_first_try"), len(feasible)
            ),
            "schema_valid_after_repair": ratio(
                count(feasible, lambda r: r.final_call_parsed), len(feasible)
            ),
            "valid_after_repair": ratio(count(feasible, lambda r: r.accepted), len(feasible)),
            "repaired": ratio(count(feasible, lambda r: r.result == "repaired"), len(feasible)),
            "first_issue_codes": dict(
                sorted(Counter(c for r in scored for c in r.first_issue_codes).items())
            ),
        },
        "constraints": constraints,
        "properties": properties,
        "escalation": {
            "expected_escalations": ratio(
                count(must_escalate, lambda r: r.result == "escalated"), len(must_escalate)
            ),
            "false_escalations": ratio(
                count(feasible, lambda r: r.result == "escalated"), len(feasible)
            ),
            "either_outcomes": {
                "active": count(either, lambda r: r.accepted),
                "needs_review": count(either, lambda r: r.result == "escalated"),
            },
        },
        "latency_s": {
            "plan_p50": percentile(plan_latency, 0.5),
            "plan_p95": percentile(plan_latency, 0.95),
            "first_call_p50": percentile(first_latency, 0.5),
            "first_call_p95": percentile(first_latency, 0.95),
        },
        "tokens": {
            "calls": calls,
            "total_in": tokens_in,
            "total_out": tokens_out,
            "per_plan_in": round(tokens_in / len(scored)) if scored else None,
            "per_plan_out": round(tokens_out / len(scored)) if scored else None,
        },
        "cost_usd": {
            "list_total": round(cost, 6),
            "list_per_plan": round(cost / len(scored), 6) if scored else None,
            "billed_total": 0.0,
        },
        "rate_limited_429": sum(r.rate_limited for r in runs),
        "per_fixture": per_fixture,
        "failures": representative_failures(runs),
    }


def representative_failures(
    runs: Sequence[PlanRun], limit: int = MAX_FAILURES_PER_RUN
) -> list[dict[str, Any]]:
    """Up to `limit`, one per profile: accepted-but-broken plans first, then wrong outcomes,
    errors and repairs, preferring distinct kinds of failure."""

    def rank(r: PlanRun) -> int | None:
        if r.accepted and not all(r.constraints.values()):
            return 0  # accepted a plan that breaks a hard constraint
        if not r.outcome_as_expected:
            return 1
        if r.result == "error":
            return 2
        if r.result == "repaired":
            return 3
        return None

    # within a rank, the first run of each kind of failure comes before repeats of a kind
    kinds: set[tuple[Any, ...]] = set()
    keyed = []
    for i, r in enumerate(runs):
        r_rank = rank(r)
        if r_rank is None:
            continue
        kind = (r_rank, r.result, r.error, r.first_issue_codes)
        keyed.append(((r_rank, kind in kinds, i), r))
        kinds.add(kind)
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for _, r in sorted(keyed, key=lambda t: t[0]):
        if r.fixture_id in seen:
            continue
        seen.add(r.fixture_id)
        out.append(
            {
                "fixture_id": r.fixture_id,
                "expected": r.expected,
                "result": r.result,
                "error": r.error,
                "first_issue_codes": list(r.first_issue_codes),
                "final_issues": [
                    f"{i.code}: {i.message}" for i in r.final_issues[:MAX_ISSUES_PER_FAILURE]
                ],
                "violated_constraints": [c for c, ok in r.constraints.items() if not ok],
            }
        )
        if len(out) == limit:
            break
    return out


def gate_failures(agg: Mapping[str, Any], gate: Gate) -> list[str]:
    """Why this run misses the suite's gate; empty when it passes. Can't pass vacuously."""
    failures = []
    if agg["scored"] < gate.min_scored_plans:
        failures.append(
            f"only {agg['scored']} plans scored; the gate needs {gate.min_scored_plans}"
        )
    valid = agg["validity"]["valid_after_repair"]
    if valid["rate"] is None or valid["rate"] < gate.valid_after_repair_min:
        failures.append(
            f"valid after repair {valid['n']}/{valid['of']} < {gate.valid_after_repair_min:.0%}"
        )
    for name in CONSTRAINTS:
        c = agg["constraints"][name]
        if c["rate"] is not None and c["rate"] < gate.constraint_adherence_min:
            failures.append(f"accepted plans broke {name}: {c['n']}/{c['of']} adhered")
    esc = agg["escalation"]["expected_escalations"]
    if esc["rate"] is None:
        failures.append("no escalation-expected plan was scored")
    elif esc["rate"] < gate.expected_escalation_min:
        failures.append(f"expected escalations {esc['n']}/{esc['of']} escalated")
    false_esc = agg["escalation"]["false_escalations"]
    if false_esc["rate"] is not None and false_esc["rate"] > gate.false_escalation_max:
        failures.append(
            f"false escalations {false_esc['n']}/{false_esc['of']} > "
            f"{gate.false_escalation_max:.0%}"
        )
    return failures
