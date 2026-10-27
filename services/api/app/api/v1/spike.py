"""SPIKE (S0, #6): throwaway endpoint proving web → API token handoff. Not for merge."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException

from app.core.config import Settings, get_settings
from app.core.security import InvalidToken, verify_access_token

router = APIRouter()


@router.get("/whoami")
def whoami(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    try:
        claims = verify_access_token(authorization[7:], settings)
    except InvalidToken as e:
        raise HTTPException(status_code=401, detail="invalid token") from e
    return {"sub": claims.sub, "alg": claims.alg, "session_role": claims.session_role}
