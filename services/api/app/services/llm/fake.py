"""Deterministic provider for tests, CI and the offline eval runner (ADR-0006 §5). Never calls out.

A reply is picked, in order, from:
1. `by_key[request.fixture_key]`: canned replies per fixture (e.g. a profile hash), consumed in
   order with the last one repeating. `load_fake_replies(dir)` builds this from `<key>.json` files.
2. `script`: one queue for every request, consumed in order (e.g. invalid, then valid, to test
   repair). Once it runs out, later requests fall through.
3. `responder(request)`, or the responder registered for `request.schema_name` with
   `register_responder` (the plans service registers a rule-based planner, so `LLM_PROVIDER=fake`
   produces valid plans for local dev and e2e).
4. Otherwise `unavailable` ("no canned reply").

`calls` records every request, so tests can assert how many LLM calls a flow made.
"""

import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app.services.llm.types import CompletionRequest, ProviderResponse, Usage

Responder = Callable[[CompletionRequest], ProviderResponse]
_RESPONDERS: dict[str, Responder] = {}


def register_responder(schema_name: str, responder: Responder) -> None:
    _RESPONDERS[schema_name] = responder


def _tokens(text: str) -> int:
    return max(1, len(text) // 4)  # deterministic stand-in for a tokenizer


class FakeReply:
    """Constructors for the replies a real provider can give."""

    @staticmethod
    def ok(content: str | BaseModel | Mapping[str, Any], *, finish_reason: str = "stop") -> Any:
        if isinstance(content, BaseModel):
            text = content.model_dump_json()
        elif isinstance(content, str):
            text = content
        else:
            text = json.dumps(content)
        return ProviderResponse(
            "ok", content=text, finish_reason=finish_reason, usage=Usage(0, _tokens(text))
        )

    @staticmethod
    def json_validate_failed(
        message: str = "Failed to generate JSON", failed_generation: str | None = None
    ) -> ProviderResponse:
        return ProviderResponse(
            "invalid_output", error=message, failed_generation=failed_generation, http_status=400
        )

    @staticmethod
    def rate_limited(retry_after_s: float | None) -> ProviderResponse:
        return ProviderResponse("rate_limited", retry_after_s=retry_after_s, http_status=429)

    @staticmethod
    def busy(retry_after_s: float | None = None) -> ProviderResponse:
        return ProviderResponse("busy", retry_after_s=retry_after_s, http_status=503)

    @staticmethod
    def unavailable(reason: str = "http_500") -> ProviderResponse:
        return ProviderResponse("unavailable", reason=reason, http_status=500)


def _reply_from_json(item: Mapping[str, Any]) -> ProviderResponse:
    kind = item.get("kind", "ok")
    if kind == "ok":
        reply: ProviderResponse = FakeReply.ok(item["content"])
        return reply
    if kind == "json_validate_failed":
        return FakeReply.json_validate_failed(
            item.get("message", "Failed to generate JSON"), item.get("failed_generation")
        )
    if kind == "rate_limited":
        return FakeReply.rate_limited(item.get("retry_after_s"))
    raise ValueError(f"unknown fake reply kind {kind!r}")


def load_fake_replies(directory: Path) -> dict[str, list[ProviderResponse]]:
    """`<key>.json` holds one reply object or a list of them: {"kind": "ok", "content": {...}}."""
    replies: dict[str, list[ProviderResponse]] = {}
    for path in sorted(directory.glob("*.json")):
        data = json.loads(path.read_text())
        items = data if isinstance(data, list) else [data]
        replies[path.stem] = [_reply_from_json(item) for item in items]
    return replies


class FakeProvider:
    name = "fake"

    def __init__(
        self,
        script: Sequence[ProviderResponse] = (),
        *,
        by_key: Mapping[str, Sequence[ProviderResponse]] | None = None,
        responder: Responder | None = None,
    ) -> None:
        self._script = list(script)
        self._by_key = {k: list(v) for k, v in (by_key or {}).items()}
        self._responder = responder
        self.calls: list[CompletionRequest] = []

    def complete(self, request: CompletionRequest) -> ProviderResponse:
        self.calls.append(request)
        reply = self._pick(request)
        prompt = sum(_tokens(m["content"]) for m in request.messages)
        if reply.outcome == "ok":
            return ProviderResponse(
                "ok",
                content=reply.content,
                finish_reason=reply.finish_reason,
                usage=Usage(prompt, reply.usage.completion_tokens),
                http_status=200,
            )
        return reply

    def _pick(self, request: CompletionRequest) -> ProviderResponse:
        key = request.fixture_key
        if key is not None and key in self._by_key:
            queue = self._by_key[key]
            return queue.pop(0) if len(queue) > 1 else queue[0]
        if self._script:
            return self._script.pop(0)
        responder = self._responder or _RESPONDERS.get(request.schema_name)
        if responder is not None:
            return responder(request)
        return ProviderResponse("unavailable", reason="no_fake_reply")
