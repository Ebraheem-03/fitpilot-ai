import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.models import UserRole

router = APIRouter()


class MeOut(BaseModel):
    id: uuid.UUID
    role: UserRole


@router.get("/me", response_model=MeOut)
def read_me(user: CurrentUser) -> MeOut:
    """The caller's own id + app role (ADR-0007). The web shell uses it to choose navigation;
    every endpoint still enforces its own role check."""
    return MeOut(id=user.id, role=user.role)
