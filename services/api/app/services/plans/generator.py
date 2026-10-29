"""Plan generation without a database (FR-02): the function the API and the eval suite share.

    draft = generate_plan(PlanInputs.from_profile(profile), load_catalog(), client)

1. Narrow the catalogue to what the member's equipment allows; that list is both the prompt's
   table and the wire schema's `exercise_id` enum (ADR-0006 §3).
2. Generate (strict structured output), parse into TrainingPlan, validate against the catalogue
   and the member (validation.py).
3. Invalid ⇒ one repair call with the issues ⇒ still invalid ⇒ `needs_review` with the issues.
   Never silently accepted (ADR-0004).

`LLMBusy` / `LLMUnavailable` propagate: nothing is saved when the model couldn't be asked.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from app.schemas.exercise import ExerciseContract
from app.schemas.plan import CONTRACT_ISSUE_CODES, TrainingPlan
from app.services.llm import (
    CallRecord,
    LLMClient,
    Message,
    ValidationIssue,
    generate_with_repair,
    strict_json_schema,
)
from app.services.plans import prompts
from app.services.plans.inputs import PlanInputs
from app.services.plans.validation import eligible_exercises, validate_plan

SCHEMA_NAME = "training_plan"
PlanResult = Literal["valid_first_try", "repaired", "escalated"]


@dataclass(frozen=True)
class PlanDraft:
    status: Literal["active", "needs_review"]
    # the accepted plan (active), or the last parsed draft that failed validation (needs_review;
    # None when nothing parsed). A rejected draft is kept for trainer review, never shown.
    plan: TrainingPlan | None
    issues: tuple[ValidationIssue, ...]
    result: PlanResult
    inputs: PlanInputs
    prompt_version: str
    provider: str
    model: str
    calls: tuple[CallRecord, ...]
    first_issue_codes: tuple[str, ...] = ()

    def metadata(self) -> dict[str, Any]:
        """Stored as `training_plans.generation_metadata`: no prompt text, no model text."""
        return {
            "result": self.result,
            "provider": self.provider,
            "prompt_sha256": prompts.prompt_sha256(self.prompt_version),
            "inputs": self.inputs.as_metadata(),
            "first_issue_codes": list(self.first_issue_codes),
            "attempts": [c.as_metadata() for c in self.calls],
            "tokens_in": sum(c.tokens_in for c in self.calls),
            "tokens_out": sum(c.tokens_out for c in self.calls),
            "latency_ms": round(sum(c.latency_ms for c in self.calls), 1),
            "cost_usd": sum(c.cost_usd for c in self.calls),
            "list_cost_usd": round(sum(c.list_cost_usd for c in self.calls), 8),
        }


def wire_schema(exercise_ids: list[str]) -> dict[str, Any]:
    """Strict JSON schema for TrainingPlan with `exercise_id` narrowed to these ids."""
    schema = strict_json_schema(TrainingPlan)
    schema["$defs"]["PlannedExercise"]["properties"]["exercise_id"] = {
        "type": "string",
        "enum": exercise_ids,
    }
    return schema


def build_messages(
    inputs: PlanInputs, exercises: Mapping[str, ExerciseContract], version: str
) -> list[Message]:
    return [
        {"role": "system", "content": prompts.system_prompt(exercises, version)},
        {"role": "user", "content": prompts.user_prompt(inputs, version)},
    ]


def generate_plan(
    inputs: PlanInputs,
    catalogue: Mapping[str, ExerciseContract],
    client: LLMClient,
    *,
    prompt_version: str = prompts.PROMPT_VERSION,
    fixture_key: str | None = None,
) -> PlanDraft:
    exercises = eligible_exercises(catalogue, inputs.equipment)

    def draft(
        plan: TrainingPlan | None,
        issues: tuple[ValidationIssue, ...],
        result: PlanResult,
        calls: tuple[CallRecord, ...] = (),
        first_issues: tuple[ValidationIssue, ...] = (),
    ) -> PlanDraft:
        return PlanDraft(
            status="needs_review" if issues else "active",
            plan=plan,
            issues=issues,
            result=result,
            inputs=inputs,
            prompt_version=prompt_version,
            provider=client.provider_name,
            model=client.model,
            calls=calls,
            first_issue_codes=tuple(sorted({i.code for i in first_issues})),
        )

    if not exercises:  # unreachable while the catalogue has bodyweight exercises
        issue = ValidationIssue("catalogue", "no approved exercise fits the member's equipment")
        return draft(None, (issue,), "escalated")

    outcome = generate_with_repair(
        client,
        TrainingPlan,
        build_messages(inputs, exercises, prompt_version),
        validate=lambda plan: validate_plan(plan, inputs, catalogue),
        repair_instruction=lambda issues: prompts.repair_prompt(issues, prompt_version),
        schema_name=SCHEMA_NAME,
        prompt_version=prompt_version,
        json_schema=wire_schema(list(exercises)),
        custom_issue_codes=CONTRACT_ISSUE_CODES,
        fixture_key=fixture_key if fixture_key is not None else inputs.fixture_key(),
    )
    if outcome.value is not None:
        return draft(outcome.value, (), outcome.result, outcome.calls, outcome.first_issues)
    return draft(outcome.draft, outcome.issues, outcome.result, outcome.calls, outcome.first_issues)
