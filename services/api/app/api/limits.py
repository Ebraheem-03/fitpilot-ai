"""Request-body size caps enforced before the body is parsed.

`limited_route(n)` is an `APIRoute` class: the declared Content-Length is checked up front and the
byte stream is counted as it is read, so a chunked upload cannot get past the cap either.
"""

from collections.abc import AsyncGenerator, Callable, Coroutine
from typing import Any

from fastapi import HTTPException, Request, Response, status
from fastapi.routing import APIRoute


def payload_too_large(max_bytes: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail={
            "code": "payload_too_large",
            "message": f"request body is larger than {max_bytes} bytes",
        },
    )


class _CappedRequest(Request):
    max_bytes = 0

    async def stream(self) -> AsyncGenerator[bytes, None]:
        total = 0
        async for chunk in super().stream():
            total += len(chunk)
            if total > self.max_bytes:
                raise payload_too_large(self.max_bytes)
            yield chunk


def limited_route(max_bytes: int) -> type[APIRoute]:
    class LimitedRoute(APIRoute):
        def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
            original = super().get_route_handler()

            async def handler(request: Request) -> Response:
                declared = request.headers.get("content-length")
                if declared is not None and declared.isdigit() and int(declared) > max_bytes:
                    raise payload_too_large(max_bytes)
                capped = _CappedRequest(request.scope, request.receive)
                capped.max_bytes = max_bytes
                return await original(capped)

            return handler

    return LimitedRoute
