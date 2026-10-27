import logging
import time
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging import (
    configure_logging,
    current_request_id,
    end_request,
    log_event,
    request_id_from,
    route_template,
    start_request,
)

logger = logging.getLogger("fitpilot.http")


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging()
    app = FastAPI(title="FitPilot AI API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,  # bearer tokens, not cookies
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        ctx_token = start_request(request_id_from(request.headers.get("x-request-id")))
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = current_request_id() or ""
            return response
        finally:
            log_event(
                logger,
                "http.request",
                method=request.method,
                # Unmatched paths are attacker/bug controlled and may carry PII: never log them.
                route=(
                    route_template(request.url.path, request.path_params)
                    if request.scope.get("route") is not None
                    else "unmatched"
                ),
                status=status,
                duration_ms=round((time.perf_counter() - start) * 1000, 2),
            )
            end_request(ctx_token)

    @app.get("/health", tags=["ops"])
    def health() -> dict[str, str]:
        return {"status": "ok", "env": settings.fitpilot_env}

    app.include_router(api_router, prefix="/api/v1")
    return app


app = create_app()
