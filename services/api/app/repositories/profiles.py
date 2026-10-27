import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models import MemberProfile


def get(db: Session, user_id: uuid.UUID) -> MemberProfile | None:
    return db.get(MemberProfile, user_id)


def add(db: Session, user_id: uuid.UUID, fields: dict[str, Any]) -> MemberProfile:
    profile = MemberProfile(user_id=user_id, **fields)
    db.add(profile)
    db.flush()
    return profile


def update(db: Session, profile: MemberProfile, fields: dict[str, Any]) -> MemberProfile:
    for name, value in fields.items():
        setattr(profile, name, value)
    db.flush()
    return profile
