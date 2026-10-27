import uuid
from enum import StrEnum

from sqlalchemy import Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, str_enum


class UserRole(StrEnum):
    member = "member"
    trainer = "trainer"
    gym_admin = "gym_admin"
    platform_admin = "platform_admin"


class UserStatus(StrEnum):
    active = "active"
    suspended = "suspended"


class User(Timestamps, Base):
    """App identity. `id` is the Supabase Auth `sub`; no email/name stored here (ADR-0007)."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    role: Mapped[UserRole] = mapped_column(
        str_enum(UserRole, "user_role"), default=UserRole.member, server_default="member"
    )
    status: Mapped[UserStatus] = mapped_column(
        str_enum(UserStatus, "user_status"), default=UserStatus.active, server_default="active"
    )
