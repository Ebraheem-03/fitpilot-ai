"""Request-scoped dependencies: who is calling, and are they allowed (FR-01, ADR-0007)."""

import logging
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db import get_db
from app.core.logging import bind_user, log_event
from app.core.security import InvalidToken, verify_access_token
from app.models import User, UserRole, UserStatus
from app.repositories import users

DbSession = Annotated[Session, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False)
logger = logging.getLogger("fitpilot.auth")


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None:
        log_event(logger, "auth.rejected", logging.WARNING, reason="missing")
        raise _unauthorized()
    try:
        token = verify_access_token(credentials.credentials, settings)
    except InvalidToken as e:
        log_event(logger, "auth.rejected", logging.WARNING, reason=str(e))
        raise _unauthorized() from e

    user = users.get_or_create(db, token.sub)
    db.commit()
    bind_user(str(user.id))
    if user.status is not UserStatus.active:
        log_event(logger, "auth.forbidden", logging.WARNING, reason="suspended")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account suspended")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*roles: UserRole) -> Callable[[User], User]:
    """Endpoint guard: `Depends(require_role(UserRole.trainer))`. Role comes from our DB only."""

    def guard(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return user

    return guard
