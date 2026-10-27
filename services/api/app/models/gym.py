import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, str_enum


class MembershipStatus(StrEnum):
    active = "active"
    paused = "paused"
    cancelled = "cancelled"


class Gym(Timestamps, Base):
    """Tenant (blueprint §6). Every gym-owned record is scoped by `gym_id`."""

    __tablename__ = "gyms"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String(120))


class GymMembership(Base):
    __tablename__ = "gym_memberships"
    __table_args__ = (UniqueConstraint("gym_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    gym_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("gyms.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[MembershipStatus] = mapped_column(
        str_enum(MembershipStatus, "membership_status"),
        default=MembershipStatus.active,
        server_default="active",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
