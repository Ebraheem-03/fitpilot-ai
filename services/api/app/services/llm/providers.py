"""LLM providers. Each turns a CompletionRequest into a classified ProviderResponse and never
raises for HTTP/transport problems; retry, budget and telemetry policy live in LLMClient.

- `OpenAICompatibleProvider`: Groq (ADR-0006) and Ollama, over `POST {base_url}/chat/completions`
  with httpx. No SDK: one endpoint, and the classification below is the part that matters.
- `FakeProvider` (fake.py): deterministic replies for tests, CI and offline evals.
- `UnconfiguredProvider`: stands in when the provider is unknown or has no key, so the failure
  shows up as an `ai_unavailable` call with telemetry instead of a crash at import time.
"""

from typing import Any, Protocol

import httpx

from app.services.llm.types import CompletionRequest, ProviderResponse, Usage

# Enough of a provider's error text to diagnose a repair; never logged (it can echo model output).
_ERROR_CHARS = 600


class Provider(Protocol):
    name: str

    def complete(self, request: CompletionRequest) -> ProviderResponse: ...


def _retry_after(headers: httpx.Headers) -> float | None:
    value = headers.get("retry-after")
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None  # an HTTP date; Groq sends seconds


class OpenAICompatibleProvider:
    def __init__(
        self,
        name: str,
        base_url: str,
        api_key: str | None,
        *,
        timeout_s: float,
        groq_extensions: bool,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.name = name
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._groq = groq_extensions
        self._http = httpx.Client(timeout=httpx.Timeout(timeout_s), transport=transport)

    def body(self, request: CompletionRequest) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": request.model,
            "messages": list(request.messages),
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": request.schema_name,
                    "strict": True,
                    "schema": request.json_schema,
                },
            },
            "reasoning_effort": request.reasoning_effort,
        }
        if self._groq:
            # ADR-0006 §3: hidden reasoning stays out of the reply; the cap covers reasoning + JSON.
            body["include_reasoning"] = False
            body["max_completion_tokens"] = request.max_completion_tokens
        else:
            body["max_tokens"] = request.max_completion_tokens
        return body

    def complete(self, request: CompletionRequest) -> ProviderResponse:
        try:
            resp = self._http.post(self._url, json=self.body(request), headers=self._headers)
        except httpx.TimeoutException:
            return ProviderResponse("unavailable", reason="timeout")
        except httpx.HTTPError:
            return ProviderResponse("unavailable", reason="transport")
        status = resp.status_code
        if status == 200:
            return self._ok(resp)
        if status == 429:
            return ProviderResponse(
                "rate_limited", retry_after_s=_retry_after(resp.headers), http_status=status
            )
        if status in (502, 503):  # over capacity: busy, not broken
            return ProviderResponse(
                "busy", retry_after_s=_retry_after(resp.headers), http_status=status
            )
        error = self._error_body(resp)
        if status == 400 and error.get("code") == "json_validate_failed":
            # ADR-0006 §4: strict mode isn't trusted; this is a failed generation, repairable.
            failed = error.get("failed_generation")
            return ProviderResponse(
                "invalid_output",
                error=str(error.get("message", "json_validate_failed"))[:_ERROR_CHARS],
                failed_generation=failed if isinstance(failed, str) else None,
                http_status=status,
            )
        reason = "auth" if status in (401, 403) else f"http_{status}"
        return ProviderResponse("unavailable", reason=reason, http_status=status)

    @staticmethod
    def _error_body(resp: httpx.Response) -> dict[str, Any]:
        try:
            data = resp.json()
        except ValueError:
            return {}
        error = data.get("error") if isinstance(data, dict) else None
        return error if isinstance(error, dict) else {}

    @staticmethod
    def _ok(resp: httpx.Response) -> ProviderResponse:
        try:
            data = resp.json()
            choice = data["choices"][0]
            content = choice["message"].get("content")
            usage = data.get("usage") or {}
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            return ProviderResponse("unavailable", reason="malformed_response", http_status=200)
        return ProviderResponse(
            "ok",
            content=content if isinstance(content, str) else None,
            usage=Usage(
                int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)
            ),
            finish_reason=choice.get("finish_reason"),
            http_status=200,
        )


class UnconfiguredProvider:
    def __init__(self, name: str, reason: str) -> None:
        self.name = name
        self._reason = reason

    def complete(self, request: CompletionRequest) -> ProviderResponse:
        return ProviderResponse("unavailable", reason=self._reason)
