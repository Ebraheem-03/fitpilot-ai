"""SQLAlchemy models. Importing this package registers every table on `Base.metadata` (Alembic)."""

from app.models.base import Base
from app.models.gym import Gym, GymMembership, MembershipStatus
from app.models.plan import PlannedExerciseRecord, PlanStatus, TrainingPlanRecord, Weekday
from app.models.profile import ExperienceLevel, Goal, MemberProfile
from app.models.session import (
    PerformanceRecord,
    SessionEventRow,
    SessionEventType,
    SessionStatus,
    WorkoutSession,
)
from app.models.user import User, UserRole, UserStatus

__all__ = [
    "Base",
    "ExperienceLevel",
    "Goal",
    "Gym",
    "GymMembership",
    "MemberProfile",
    "MembershipStatus",
    "PerformanceRecord",
    "PlanStatus",
    "PlannedExerciseRecord",
    "SessionEventRow",
    "SessionEventType",
    "SessionStatus",
    "TrainingPlanRecord",
    "User",
    "UserRole",
    "UserStatus",
    "Weekday",
    "WorkoutSession",
]
