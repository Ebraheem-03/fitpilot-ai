"""`LLMClient.generate_structured`: the one way the app calls a model (ADR-0004).

Per call:
1. Budget guard (budget.py), fail closed: unpriced model or billed model over budget ⇒
   `LLMUnavailable`; daily token cap reached ⇒ `LLMBusy`.
2. Provider call. A 429 whose `retry-after` ≤ `max_retry_wait_s` is waited out and retried once;
   a longer one (Groq's daily cap) or a second 429 ⇒ `LLMBusy` immediately. 502/503 ⇒ `LLMBusy`.
   Anything else that isn't a reply ⇒ `LLMUnavailable`.
3. The reply is parsed into the Pydantic schema. A truncated reply, a provider-side schema
   rejection (Groq `json_validate_failed`, ADR-0006 §4) or a ValidationError is returned as
   issues, not raised: the caller decides whether to repair (repair.py).
4. One `llm.call` event (FR-13): provider, model, prompt_version, schema, attempt, outcome,
   latency, tokens, cost. Never messages, outputs, provider error text or fixture keys.
"""

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from pydantic import BaseModel, ValidationError

from app.core.logging import log_event
from app.services.llm.budget import BudgetGuard
from app.services.llm.pricing import price_for
from app.services.llm.providers import Provider
from app.services.llm.schema import strict_json_schema
from app.services.llm.types import (
    CallOutcome,
    CallRecord,
    CompletionRequest,
    LLMBusy,
    LLMError,
    LLMUnavailable,
    Message,
    ProviderResponse,
    StructuredResult,
    ValidationIssue,
)

logger = logging.getLogger("fitpilot.llm")

# A 429 without retry-after is treated as a short wait of this many seconds.
DEFAULT_RETRY_WAIT_S = 2.0
_MAX_ISSUES = 50
_MAX_ISSUE_CHARS = 300


def issues_from_validation_error(
    error: ValidationError, custom_codes: frozenset[str] = frozenset()
) -> list[ValidationIssue]:
    """`loc: msg` per error. Pydantic messages don't echo the input value, so these are safe to
    store and show. A custom error type listed in `custom_codes` keeps its code."""
    issues = []
    for err in error.errors()[:_MAX_ISSUES]:
        loc = ".".join(str(part) for part in err["loc"]) or "(root)"
        code = err["type"] if err["type"] in custom_codes else "schema"
        issues.append(ValidationIssue(code, f"{loc}: {err['msg']}"[:_MAX_ISSUE_CHARS]))
    return issues


class LLMClient:
    def __init__(
        self,
        provider: Provider,
        *,
        model: str,
        budget: BudgetGuard,
        reasoning_effort: str = "low",
        max_completion_tokens: int = 6000,
        max_retry_wait_s: float = 10.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.provider = provider
        self.model = model
        self.budget = budget
        self.reasoning_effort = reasoning_effort
        self.max_completion_tokens = max_completion_tokens
        self.max_retry_wait_s = max_retry_wait_s
        self._sleep = sleep

    @property
    def provider_name(self) -> str:
        return self.provider.name

    def generate_structured[T: BaseModel](
        self,
        schema: type[T],
        messages: Sequence[Message],
        *,
        schema_name: str,
        prompt_version: str,
        json_schema: Mapping[str, Any] | None = None,
        custom_issue_codes: frozenset[str] = frozenset(),
        fixture_key: str | None = None,
        attempt: int = 1,
    ) -> StructuredResult[T]:
        """Ask for one `schema` object. `json_schema` overrides the wire schema derived from
        `schema` (e.g. to narrow an id field to a per-request enum); the reply is always parsed
        with `schema` itself."""
        request = CompletionRequest(
            model=self.model,
            messages=tuple(messages),
            json_schema=dict(json_schema) if json_schema else strict_json_schema(schema),
            schema_name=schema_name,
            max_completion_tokens=self.max_completion_tokens,
            reasoning_effort=self.reasoning_effort,
            fixture_key=fixture_key,
        )
        price = price_for(self.provider.name, self.model)
        meta = {"prompt_version": prompt_version, "schema_name": schema_name, "attempt": attempt}
        started = time.perf_counter()
        try:
            est_in = sum(len(m["content"]) for m in messages) // 3
            self.budget.check(price, est_in, self.max_completion_tokens)
        except LLMError as e:
            outcome: CallOutcome = "budget_refused" if isinstance(e, LLMUnavailable) else "busy"
            self._log(self._record(meta, outcome, started), reason=e.reason)
            raise

        response, retries = self._call_with_rate_limit(request, meta, started)
        tokens_in, tokens_out = response.usage.prompt_tokens, response.usage.completion_tokens
        assert price is not None  # checked by the guard
        self.budget.record(price, tokens_in, tokens_out)

        value: T | None = None
        issues: list[ValidationIssue] = []
        raw = response.content
        provider_error: str | None = None
        if response.outcome == "invalid_output":
            provider_error = response.error
            raw = response.failed_generation
            issues = [
                ValidationIssue(
                    "generation_failed", "The model's output did not match the required format."
                )
            ]
        elif response.finish_reason == "length":
            provider_error = "the output was cut off at the token limit"
            issues = [ValidationIssue("generation_failed", "The model's output was cut off.")]
        elif not raw:
            issues = [ValidationIssue("generation_failed", "The model returned no output.")]
        else:
            try:
                value = schema.model_validate_json(raw)
            except ValidationError as e:
                issues = issues_from_validation_error(e, custom_issue_codes)

        record = CallRecord(
            provider=self.provider.name,
            model=self.model,
            outcome="ok" if value is not None else "invalid_output",
            latency_ms=round((time.perf_counter() - started) * 1000, 1),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=price.billed_cost(tokens_in, tokens_out),
            list_cost_usd=round(price.list_cost(tokens_in, tokens_out), 8),
            http_status=response.http_status,
            rate_limited_retries=retries,
            issue_codes=tuple(sorted({i.code for i in issues})),
            **meta,  # type: ignore[arg-type]
        )
        self._log(record, finish_reason=response.finish_reason)
        return StructuredResult(
            value=value,
            issues=tuple(issues),
            call=record,
            raw_output=raw,
            provider_error=provider_error,
        )

    def _call_with_rate_limit(
        self, request: CompletionRequest, meta: dict[str, Any], started: float
    ) -> tuple[ProviderResponse, int]:
        retries = 0
        while True:
            response = self.provider.complete(request)
            if response.outcome == "rate_limited":
                wait = response.retry_after_s
                wait = DEFAULT_RETRY_WAIT_S if wait is None else wait
                if retries == 0 and wait <= self.max_retry_wait_s:
                    retries += 1
                    self._sleep(wait)
                    continue
                self._fail(meta, started, response, retries, "rate_limited", wait)
                raise LLMBusy("rate_limited", wait)
            if response.outcome == "busy":
                self._fail(
                    meta, started, response, retries, "provider_busy", response.retry_after_s
                )
                raise LLMBusy("provider_busy", response.retry_after_s)
            if response.outcome == "unavailable":
                reason = response.reason or "provider_error"
                self._fail(meta, started, response, retries, reason, None, outcome="unavailable")
                raise LLMUnavailable(reason)
            return response, retries

    def _fail(
        self,
        meta: dict[str, Any],
        started: float,
        response: ProviderResponse,
        retries: int,
        reason: str,
        retry_after_s: float | None,
        outcome: CallOutcome = "busy",
    ) -> None:
        record = self._record(
            meta, outcome, started, http_status=response.http_status, retries=retries
        )
        self._log(record, reason=reason, retry_after_s=retry_after_s)

    def _record(
        self,
        meta: dict[str, Any],
        outcome: CallOutcome,
        started: float,
        *,
        http_status: int | None = None,
        retries: int = 0,
    ) -> CallRecord:
        return CallRecord(
            provider=self.provider.name,
            model=self.model,
            outcome=outcome,
            latency_ms=round((time.perf_counter() - started) * 1000, 1),
            tokens_in=0,
            tokens_out=0,
            cost_usd=0.0,
            list_cost_usd=0.0,
            http_status=http_status,
            rate_limited_retries=retries,
            **meta,
        )

    @staticmethod
    def _log(record: CallRecord, **extra: Any) -> None:
        level = logging.INFO if record.outcome == "ok" else logging.WARNING
        log_event(
            logger,
            "llm.call",
            level,
            provider=record.provider,
            model=record.model,
            prompt_version=record.prompt_version,
            schema=record.schema_name,
            attempt=record.attempt,
            outcome=record.outcome,
            latency_ms=record.latency_ms,
            tokens_in=record.tokens_in,
            tokens_out=record.tokens_out,
            cost_usd=record.cost_usd,
            list_cost_usd=record.list_cost_usd,
            http_status=record.http_status,
            rate_limited_retries=record.rate_limited_retries,
            issue_codes=list(record.issue_codes),
            **{k: v for k, v in extra.items() if v is not None},
        )
