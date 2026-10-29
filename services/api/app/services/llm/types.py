"""Provider-neutral request/response types for the LLM layer (ADR-0004, ADR-0006)."""

from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

from pydantic import BaseModel

Role = Literal["system", "user", "assistant"]


class Message(TypedDict):
    role: Role
    content: str


@dataclass(frozen=True)
class CompletionRequest:
    """One structured-output call. `fixture_key` is read only by the fake provider (tests, offline
    evals) to pick a canned reply. Real providers ignore it, and it is never logged."""

    model: str
    messages: tuple[Message, ...]
    json_schema: dict[str, Any]
    schema_name: str
    max_completion_tokens: int
    reasoning_effort: str
    fixture_key: str | None = None


@dataclass(frozen=True)
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0


ProviderOutcome = Literal["ok", "invalid_output", "rate_limited", "busy", "unavailable"]


@dataclass(frozen=True)
class ProviderResponse:
    """What a provider returned, classified. `error` and `failed_generation` may contain model
    output: they go into the repair prompt only, never into logs or stored rows."""

    outcome: ProviderOutcome
    content: str | None = None
    usage: Usage = field(default_factory=Usage)
    finish_reason: str | None = None
    error: str | None = None
    failed_generation: str | None = None
    retry_after_s: float | None = None
    http_status: int | None = None
    # for `unavailable`: a short machine-readable reason (timeout, auth, transport, …)
    reason: str | None = None


@dataclass(frozen=True)
class ValidationIssue:
    """A reason an output was rejected. `code` is a stable slug; `message` is written by our
    validators (never copied from the model) and is safe to store and show."""

    code: str
    message: str


CallOutcome = Literal["ok", "invalid_output", "busy", "unavailable", "budget_refused"]


@dataclass(frozen=True)
class CallRecord:
    """FR-13 telemetry for one generate_structured call. Ids, timings and counts only."""

    provider: str
    model: str
    prompt_version: str
    schema_name: str
    attempt: int
    outcome: CallOutcome
    latency_ms: float
    tokens_in: int
    tokens_out: int
    cost_usd: float
    list_cost_usd: float
    http_status: int | None = None
    rate_limited_retries: int = 0
    issue_codes: tuple[str, ...] = ()

    def as_metadata(self) -> dict[str, Any]:
        return {
            "attempt": self.attempt,
            "outcome": self.outcome,
            "latency_ms": self.latency_ms,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "cost_usd": self.cost_usd,
            "list_cost_usd": self.list_cost_usd,
            "rate_limited_retries": self.rate_limited_retries,
            "issue_codes": list(self.issue_codes),
        }


@dataclass(frozen=True)
class StructuredResult[T: BaseModel]:
    """The parsed value, or why there isn't one. `issues` is empty exactly when `value` is set.
    `raw_output` / `provider_error` feed the repair prompt and must not be logged or stored."""

    value: T | None
    issues: tuple[ValidationIssue, ...]
    call: CallRecord
    raw_output: str | None = None
    provider_error: str | None = None


class LLMError(Exception):
    """Base class. `reason` is a short slug safe to log; the message never holds model output."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class LLMBusy(LLMError):
    """Rate limited or over capacity: tell the member "coach is busy, try again" (ADR-0006)."""

    def __init__(self, reason: str, retry_after_s: float | None) -> None:
        super().__init__(reason)
        self.retry_after_s = retry_after_s


class LLMUnavailable(LLMError):
    """Refused (budget guard, unpriced model, not configured) or the provider failed."""
