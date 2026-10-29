"""LLM layer (ADR-0004, ADR-0006, FR-13): parsing, 429 policy, fail-closed budget, telemetry."""

import json
import logging
from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict, Field

from app.core.logging import JsonFormatter
from app.services.llm import (
    BudgetGuard,
    FakeReply,
    LLMBusy,
    LLMUnavailable,
    Message,
    ModelPrice,
    strict_json_schema,
)
from app.services.llm import pricing
from app.services.llm.budget import InMemoryLedger, seconds_until_utc_midnight
from tests.llm_helpers import fake_client


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(max_length=20)
    count: int | None = Field(ge=0)


MESSAGES: list[Message] = [{"role": "user", "content": "secret-profile-text"}]
KW: dict[str, Any] = {"schema_name": "answer", "prompt_version": "test-v1"}


def llm_events(caplog: pytest.LogCaptureFixture) -> list[dict[str, Any]]:
    fmt = JsonFormatter()
    return [
        json.loads(fmt.format(r)) for r in caplog.records if r.name == "fitpilot.llm"
    ]


def test_parses_a_valid_reply_and_logs_the_call(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    client, fake, _ = fake_client(FakeReply.ok({"title": "secret-output", "count": 2}))
    result = client.generate_structured(Answer, MESSAGES, **KW)

    assert result.value == Answer(title="secret-output", count=2)
    assert result.issues == ()
    assert len(fake.calls) == 1
    (event,) = llm_events(caplog)
    assert event["event"] == "llm.call"
    assert {k: event[k] for k in ("provider", "model", "prompt_version", "schema", "outcome")} == {
        "provider": "fake",
        "model": "openai/gpt-oss-120b",
        "prompt_version": "test-v1",
        "schema": "answer",
        "outcome": "ok",
    }
    assert event["tokens_in"] > 0 and event["tokens_out"] > 0
    assert event["cost_usd"] == 0.0 and isinstance(event["latency_ms"], float)
    raw = caplog.text + json.dumps(event)
    assert "secret-profile-text" not in raw and "secret-output" not in raw


def test_sends_a_strict_schema_and_the_adr_0006_settings() -> None:
    client, fake, _ = fake_client(FakeReply.ok({"title": "x", "count": None}))
    client.generate_structured(Answer, MESSAGES, **KW)
    request = fake.calls[0]
    assert request.max_completion_tokens == 6000
    assert request.reasoning_effort == "low"
    assert request.json_schema["additionalProperties"] is False
    assert request.json_schema["required"] == ["title", "count"]


def test_strict_schema_keeps_property_names_and_drops_annotations() -> None:
    schema = strict_json_schema(Answer)
    assert "title" in schema["properties"]  # a property *named* title survives
    assert "title" not in schema  # the annotation doesn't
    assert "maxLength" not in schema["properties"]["title"]
    assert schema["properties"]["count"]["anyOf"][0]["minimum"] == 0


def test_provider_schema_rejection_is_a_repairable_failure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    client, _, _ = fake_client(
        FakeReply.json_validate_failed("jsonschema: /title expected string", '{"title": 3}')
    )
    result = client.generate_structured(Answer, MESSAGES, **KW)
    assert result.value is None
    assert [i.code for i in result.issues] == ["generation_failed"]
    assert result.raw_output == '{"title": 3}'
    assert result.provider_error == "jsonschema: /title expected string"
    (event,) = llm_events(caplog)
    assert event["outcome"] == "invalid_output" and event["http_status"] == 400
    assert "expected string" not in caplog.text  # provider error text is never logged


def test_truncated_reply_is_a_failed_generation() -> None:
    client, _, _ = fake_client(FakeReply.ok('{"title": "x"', finish_reason="length"))
    result = client.generate_structured(Answer, MESSAGES, **KW)
    assert result.value is None
    assert [i.code for i in result.issues] == ["generation_failed"]
    assert result.provider_error == "the output was cut off at the token limit"


def test_schema_violations_become_issues_without_echoing_input() -> None:
    client, _, _ = fake_client(FakeReply.ok({"title": "x" * 30, "count": -1, "extra": "leak"}))
    result = client.generate_structured(Answer, MESSAGES, **KW)
    assert result.value is None
    assert {i.code for i in result.issues} == {"schema"}
    text = " ".join(i.message for i in result.issues)
    assert "title:" in text and "count:" in text and "extra:" in text
    assert "leak" not in text and "xxxx" not in text


def test_short_429_is_waited_out_once() -> None:
    client, fake, sleeps = fake_client(
        FakeReply.rate_limited(3.0), FakeReply.ok({"title": "x", "count": 1})
    )
    result = client.generate_structured(Answer, MESSAGES, **KW)
    assert result.value is not None
    assert sleeps == [3.0] and len(fake.calls) == 2
    assert result.call.rate_limited_retries == 1


def test_long_429_is_busy_immediately_and_logged(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    client, fake, sleeps = fake_client(FakeReply.rate_limited(1715.0))
    with pytest.raises(LLMBusy) as e:
        client.generate_structured(Answer, MESSAGES, **KW)
    assert e.value.retry_after_s == 1715.0
    assert sleeps == [] and len(fake.calls) == 1
    (event,) = llm_events(caplog)
    assert event["outcome"] == "busy" and event["reason"] == "rate_limited"
    assert event["retry_after_s"] == 1715.0 and event["level"] == "warning"


def test_second_429_after_a_retry_is_busy() -> None:
    client, fake, sleeps = fake_client(FakeReply.rate_limited(1.0), FakeReply.rate_limited(1.0))
    with pytest.raises(LLMBusy):
        client.generate_structured(Answer, MESSAGES, **KW)
    assert sleeps == [1.0] and len(fake.calls) == 2


def test_provider_over_capacity_is_busy() -> None:
    client, _, _ = fake_client(FakeReply.busy(30.0))
    with pytest.raises(LLMBusy) as e:
        client.generate_structured(Answer, MESSAGES, **KW)
    assert e.value.reason == "provider_busy"


def test_provider_failure_is_unavailable() -> None:
    client, _, _ = fake_client(FakeReply.unavailable("auth"))
    with pytest.raises(LLMUnavailable) as e:
        client.generate_structured(Answer, MESSAGES, **KW)
    assert e.value.reason == "auth"


# --- budget guard (fail closed) ------------------------------------------------------------


@pytest.fixture
def billed_model(monkeypatch: pytest.MonkeyPatch) -> str:
    model = "test/paid-model"
    monkeypatch.setitem(pricing.GROQ_PRICES, model, ModelPrice(1000.0, 1000.0, billed=True))
    return model


class _GroqNamedFake:
    """The fake's replies under the groq name, so groq pricing applies."""

    name = "groq"

    def __init__(self, inner: Any) -> None:
        self.inner = inner

    def complete(self, request: Any) -> Any:
        return self.inner.complete(request)


def _groq_client(model: str, budget: float, *replies: Any) -> Any:
    from app.services.llm import FakeProvider

    inner = FakeProvider(replies)
    client, _, _ = fake_client(
        provider=_GroqNamedFake(inner), model=model, monthly_budget_usd=budget
    )
    return client, inner


def test_unpriced_model_is_refused_before_any_call(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    client, inner = _groq_client("groq/unknown-model", 100.0, FakeReply.ok({"title": "x"}))
    with pytest.raises(LLMUnavailable) as e:
        client.generate_structured(Answer, MESSAGES, **KW)
    assert e.value.reason == "unpriced_model" and inner.calls == []
    assert llm_events(caplog)[0]["outcome"] == "budget_refused"


def test_billed_model_with_zero_budget_is_refused(billed_model: str) -> None:
    client, inner = _groq_client(billed_model, 0.0, FakeReply.ok({"title": "x", "count": 1}))
    with pytest.raises(LLMUnavailable) as e:
        client.generate_structured(Answer, MESSAGES, **KW)
    assert e.value.reason == "budget_refused" and inner.calls == []


def test_billed_model_is_refused_when_the_worst_case_exceeds_the_budget(billed_model: str) -> None:
    # worst case: 6,000 completion tokens at $1000/Mtok = $6 > $5
    client, inner = _groq_client(billed_model, 5.0, FakeReply.ok({"title": "x", "count": 1}))
    with pytest.raises(LLMUnavailable):
        client.generate_structured(Answer, MESSAGES, **KW)
    assert inner.calls == []


def test_billed_spend_is_recorded_against_the_month(billed_model: str) -> None:
    client, _ = _groq_client(billed_model, 50.0, FakeReply.ok({"title": "x", "count": 1}))
    result = client.generate_structured(Answer, MESSAGES, **KW)
    assert result.call.cost_usd > 0
    spent = client.budget.ledger.month_to_date_usd(datetime.now(UTC))
    assert spent == pytest.approx(result.call.cost_usd)


def test_free_tier_records_list_cost_but_bills_nothing() -> None:
    client, _ = _groq_client("openai/gpt-oss-120b", 0.0, FakeReply.ok({"title": "x", "count": 1}))
    result = client.generate_structured(Answer, MESSAGES, **KW)
    assert result.call.cost_usd == 0.0 and result.call.list_cost_usd > 0


def test_daily_token_budget_makes_the_coach_busy_until_midnight() -> None:
    now = datetime(2026, 10, 29, 23, 0, tzinfo=UTC)
    ledger = InMemoryLedger()
    guard = BudgetGuard(monthly_budget_usd=0, daily_token_budget=100, ledger=ledger, clock=lambda: now)
    guard.check(pricing.FREE, 10, 10)
    ledger.add_tokens(100, now)
    with pytest.raises(LLMBusy) as e:
        guard.check(pricing.FREE, 10, 10)
    assert e.value.reason == "daily_token_budget"
    assert e.value.retry_after_s == seconds_until_utc_midnight(now) == 3600


def test_daily_budget_counts_real_calls() -> None:
    client, fake, _ = fake_client(
        FakeReply.ok({"title": "x", "count": 1}), daily_token_budget=1
    )
    client.generate_structured(Answer, MESSAGES, **KW)
    with pytest.raises(LLMBusy):
        client.generate_structured(Answer, MESSAGES, **KW)
    assert len(fake.calls) == 1
