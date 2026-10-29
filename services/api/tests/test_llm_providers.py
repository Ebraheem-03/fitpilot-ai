"""OpenAI-compatible provider (Groq, Ollama) over a mocked HTTP transport, and the factory.
No request ever leaves the process."""

import json
from typing import Any

import httpx
import pytest

from app.core.config import Settings
from app.services.llm import CompletionRequest, FakeProvider, build_client, build_provider
from app.services.llm.providers import OpenAICompatibleProvider, UnconfiguredProvider

REQUEST = CompletionRequest(
    model="openai/gpt-oss-120b",
    messages=({"role": "user", "content": "hi"},),
    json_schema={"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    schema_name="training_plan",
    max_completion_tokens=6000,
    reasoning_effort="low",
    fixture_key="must-not-be-sent",
)


def provider(
    handler: Any, *, groq: bool = True, key: str | None = "test-key"
) -> tuple[OpenAICompatibleProvider, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        result: httpx.Response = handler(request)
        return result

    p = OpenAICompatibleProvider(
        "groq" if groq else "ollama",
        "https://llm.test/openai/v1/",
        key,
        timeout_s=5,
        groq_extensions=groq,
        transport=httpx.MockTransport(record),
    )
    return p, seen


def ok(content: str = '{"a": 1}', finish: str = "stop") -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "choices": [{"message": {"content": content}, "finish_reason": finish}],
            "usage": {"prompt_tokens": 900, "completion_tokens": 1500},
        },
    )


def test_groq_request_matches_adr_0006() -> None:
    p, seen = provider(lambda r: ok())
    response = p.complete(REQUEST)
    assert response.outcome == "ok" and response.content == '{"a": 1}'
    assert (response.usage.prompt_tokens, response.usage.completion_tokens) == (900, 1500)

    (req,) = seen
    assert str(req.url) == "https://llm.test/openai/v1/chat/completions"
    assert req.headers["authorization"] == "Bearer test-key"
    body = json.loads(req.content)
    assert body["reasoning_effort"] == "low"
    assert body["include_reasoning"] is False
    assert body["max_completion_tokens"] == 6000
    assert body["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "training_plan", "strict": True, "schema": REQUEST.json_schema},
    }
    assert "must-not-be-sent" not in req.content.decode()


def test_ollama_uses_max_tokens_and_no_auth() -> None:
    p, seen = provider(lambda r: ok(), groq=False, key=None)
    p.complete(REQUEST)
    body = json.loads(seen[0].content)
    assert "authorization" not in seen[0].headers
    assert body["max_tokens"] == 6000
    assert "include_reasoning" not in body and "max_completion_tokens" not in body


def test_json_validate_failed_is_invalid_output_with_failed_generation() -> None:
    error = {
        "error": {
            "message": "max completion tokens reached before generating a valid document",
            "type": "invalid_request_error",
            "code": "json_validate_failed",
            "failed_generation": '{"days": [',
        }
    }
    p, _ = provider(lambda r: httpx.Response(400, json=error))
    response = p.complete(REQUEST)
    assert response.outcome == "invalid_output"
    assert response.failed_generation == '{"days": ['
    assert response.error is not None and "max completion tokens" in response.error


def test_other_400_is_unavailable() -> None:
    p, _ = provider(lambda r: httpx.Response(400, json={"error": {"code": "model_not_found"}}))
    response = p.complete(REQUEST)
    assert (response.outcome, response.reason) == ("unavailable", "http_400")


def test_429_reads_retry_after() -> None:
    p, _ = provider(lambda r: httpx.Response(429, headers={"retry-after": "274"}))
    response = p.complete(REQUEST)
    assert (response.outcome, response.retry_after_s) == ("rate_limited", 274.0)


@pytest.mark.parametrize(("status", "outcome"), [(503, "busy"), (502, "busy"), (500, "unavailable")])
def test_server_errors(status: int, outcome: str) -> None:
    p, _ = provider(lambda r: httpx.Response(status))
    assert p.complete(REQUEST).outcome == outcome


def test_auth_failure_and_transport_errors_are_unavailable() -> None:
    p, _ = provider(lambda r: httpx.Response(401, json={"error": {"message": "bad key"}}))
    assert p.complete(REQUEST).reason == "auth"

    def timeout(r: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=r)

    p, _ = provider(timeout)
    assert p.complete(REQUEST).reason == "timeout"

    def refused(r: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=r)

    p, _ = provider(refused)
    assert p.complete(REQUEST).reason == "transport"


def test_malformed_200_is_unavailable() -> None:
    p, _ = provider(lambda r: httpx.Response(200, json={"choices": []}))
    assert p.complete(REQUEST).reason == "malformed_response"


def test_truncation_is_reported_via_finish_reason() -> None:
    p, _ = provider(lambda r: ok('{"days": [', finish="length"))
    assert p.complete(REQUEST).finish_reason == "length"


# --- factory ---------------------------------------------------------------------------------


def test_factory_picks_the_configured_provider() -> None:
    assert isinstance(build_provider(Settings(llm_provider="fake")), FakeProvider)
    groq = build_provider(Settings(llm_provider="groq", groq_api_key="k"))
    assert isinstance(groq, OpenAICompatibleProvider) and groq.name == "groq"
    ollama = build_provider(Settings(llm_provider="ollama"))
    assert isinstance(ollama, OpenAICompatibleProvider) and ollama.name == "ollama"


def test_groq_without_a_key_and_unknown_providers_are_unconfigured() -> None:
    missing = build_provider(Settings(llm_provider="groq", groq_api_key=None))
    assert isinstance(missing, UnconfiguredProvider)
    assert missing.complete(REQUEST).reason == "not_configured"
    unknown = build_provider(Settings(llm_provider="anthropic"))
    assert unknown.complete(REQUEST).reason == "unknown_provider"


def test_client_settings_come_from_env() -> None:
    client = build_client(
        Settings(llm_provider="fake", llm_max_completion_tokens=4000, llm_reasoning_effort="medium")
    )
    assert (client.max_completion_tokens, client.reasoning_effort) == (4000, "medium")
    assert client.budget.monthly_budget_usd == 0.0


def test_the_suite_runs_with_the_fake_provider() -> None:
    """tests/conftest.py forces LLM_PROVIDER=fake and blanks GROQ_API_KEY: no live calls."""
    settings = Settings()
    assert settings.llm_provider == "fake"
    assert not settings.groq_api_key
