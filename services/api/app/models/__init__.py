"""SQLAlchemy models. Importing this package registers every table on `Base.metadata` (Alembic)."""

from app.models.base import Base
from app.models.gym import Gym, GymMembership, MembershipStatus
from app.models.profile import ExperienceLevel, Goal, MemberProfile
from app.models.user import User, UserRole, UserStatus

__all__ = [
    "Base",
    "ExperienceLevel",
    "Goal",
    "Gym",
    "GymMembership",
    "MemberProfile",
    "MembershipStatus",
    "User",
    "UserRole",
    "UserStatus",
]
