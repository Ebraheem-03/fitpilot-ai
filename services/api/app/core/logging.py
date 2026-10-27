"""Structured JSON events (FR-13): event name + ids + timings, never personal data or tokens.

Log with `log_event(logger, "domain.action", key=value)`. Only explicitly passed fields are
emitted, so request bodies, headers and exception payloads never reach the log by accident.
"""

import json
import logging
import re
import uuid
from contextvars import ContextVar, Token
from datetime import UTC, datetime
from typing import Any

# One mutable dict per request. Sync dependencies run in a threadpool with a *copy* of the
# context, so rebinding a ContextVar there would be invisible to the middleware; mutating the
# shared dict is not.
RequestContext = dict[str, str | None]
_request_ctx: ContextVar[RequestContext | None] = ContextVar("request_ctx", default=None)


def start_request(request_id: str) -> Token[RequestContext | None]:
    return _request_ctx.set({"request_id": request_id, "user_id": None})


def end_request(token: Token[RequestContext | None]) -> None:
    _request_ctx.reset(token)


def bind_user(user_id: str) -> None:
    ctx = _request_ctx.get()
    if ctx is not None:
        ctx["user_id"] = user_id


def current_request_id() -> str | None:
    ctx = _request_ctx.get()
    return ctx["request_id"] if ctx else None


_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def request_id_from(header: str | None) -> str:
    """Reuse a caller's X-Request-ID only if it can't inject anything into logs."""
    if header and _SAFE_REQUEST_ID.fullmatch(header):
        return header
    return str(uuid.uuid4())


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "event": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
            "user_id": getattr(record, "user_id", None),
        }
        payload.update(getattr(record, "fields", {}))
        if record.exc_info and record.exc_info[0] is not None:
            # Type only: exception messages can echo user input.
            payload["error_type"] = record.exc_info[0].__name__
        return json.dumps(payload, default=str)


def log_event(logger: logging.Logger, event: str, level: int = logging.INFO, **fields: Any) -> None:
    # Context is captured at emit time: handlers may format later, after the request ended.
    ctx = _request_ctx.get() or {}
    context = {"request_id": ctx.get("request_id"), "user_id": ctx.get("user_id")}
    logger.log(level, event, extra={"fields": fields, **context})


def route_template(path: str, path_params: dict[str, Any]) -> str:
    """`/api/v1/things/123` → `/api/v1/things/{thing_id}`: no ids or query strings in logs."""
    for name, value in path_params.items():
        path = path.replace(f"/{value}", f"/{{{name}}}", 1)
    return path


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    app_logger = logging.getLogger("fitpilot")
    app_logger.handlers[:] = [handler]
    app_logger.setLevel(level)
    app_logger.propagate = True  # lets pytest's caplog see events; root has no handler in prod
    # Uvicorn's access log prints raw paths + query strings; our http.request event replaces it.
    logging.getLogger("uvicorn.access").disabled = True
