import uuid
from enum import StrEnum

from sqlalchemy import ARRAY, CheckConstraint, ForeignKey, SmallInteger, String, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, str_enum


class Goal(StrEnum):
    general_fitness = "general_fitness"
    strength = "strength"
    muscle_gain = "muscle_gain"
    fat_loss = "fat_loss"
    mobility = "mobility"


class ExperienceLevel(StrEnum):
    beginner = "beginner"
    intermediate = "intermediate"
    advanced = "advanced"


class MemberProfile(Timestamps, Base):
    """Training profile (FR-01). Health constraints + consent are deliberately absent until M4."""

    __tablename__ = "member_profiles"
    __table_args__ = (
        CheckConstraint("days_per_week BETWEEN 1 AND 7", name="days_per_week_range"),
        CheckConstraint("session_minutes BETWEEN 10 AND 180", name="session_minutes_range"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    primary_goal: Mapped[Goal] = mapped_column(str_enum(Goal, "goal"))
    experience_level: Mapped[ExperienceLevel] = mapped_column(
        str_enum(ExperienceLevel, "experience_level"),
        default=ExperienceLevel.beginner,
        server_default="beginner",
    )
    days_per_week: Mapped[int | None] = mapped_column(SmallInteger)
    session_minutes: Mapped[int | None] = mapped_column(SmallInteger)
    equipment: Mapped[list[str]] = mapped_column(
        ARRAY(String(32)), default=list, server_default=text("'{}'")
    )
