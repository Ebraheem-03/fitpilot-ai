"""Generate → validate → repair once → escalate (ADR-0004, FR-02). Never silently accepts.

The caller supplies the domain validator and the (versioned) repair instruction. The repair call
resends the original messages, then the rejected output as the assistant turn (when there is
one; for Groq `json_validate_failed` that is `failed_generation`), then the issue list. If the
repaired output is still invalid, the outcome is `escalated` with the remaining issues and the
last parsed draft (if any) for human review.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel

from app.services.llm.client import LLMClient
from app.services.llm.types import CallRecord, Message, StructuredResult, ValidationIssue

# A truncated failed_generation can be the whole 6,000-token budget; keep the repair prompt small.
_MAX_FEEDBACK_CHARS = 12_000

RepairResult = Literal["valid_first_try", "repaired", "escalated"]


@dataclass(frozen=True)
class RepairOutcome[T: BaseModel]:
    result: RepairResult
    # the accepted value; None when escalated
    value: T | None
    # escalated only: the last output that parsed but failed domain validation (may be None)
    draft: T | None
    # empty unless escalated: why the final attempt was rejected
    issues: tuple[ValidationIssue, ...]
    # why the first attempt was rejected (empty when valid first try)
    first_issues: tuple[ValidationIssue, ...]
    calls: tuple[CallRecord, ...]


def _issues[T: BaseModel](
    result: StructuredResult[T], validate: Callable[[T], Sequence[ValidationIssue]]
) -> Any:
    if result.value is None:
        return tuple(result.issues)
    return tuple(validate(result.value))


def generate_with_repair[T: BaseModel](
    client: LLMClient,
    schema: type[T],
    messages: Sequence[Message],
    *,
    validate: Callable[[T], Sequence[ValidationIssue]],
    repair_instruction: Callable[[Sequence[str]], str],
    **kwargs: Any,
) -> RepairOutcome[T]:
    """`kwargs` go to `generate_structured` (schema_name, prompt_version, json_schema, …).
    `LLMBusy` / `LLMUnavailable` propagate from either attempt."""
    first = client.generate_structured(schema, messages, attempt=1, **kwargs)
    first_issues: tuple[ValidationIssue, ...] = _issues(first, validate)
    if not first_issues:
        return RepairOutcome("valid_first_try", first.value, None, (), (), (first.call,))

    feedback = [i.message for i in first_issues]
    if first.provider_error:
        feedback.insert(0, f"provider: {first.provider_error}")
    repair: list[Message] = list(messages)
    if first.raw_output:
        repair.append({"role": "assistant", "content": first.raw_output[:_MAX_FEEDBACK_CHARS]})
    repair.append({"role": "user", "content": repair_instruction(feedback)})

    second = client.generate_structured(schema, repair, attempt=2, **kwargs)
    second_issues: tuple[ValidationIssue, ...] = _issues(second, validate)
    calls = (first.call, second.call)
    if not second_issues:
        return RepairOutcome("repaired", second.value, None, (), first_issues, calls)
    return RepairOutcome("escalated", None, second.value, second_issues, first_issues, calls)
