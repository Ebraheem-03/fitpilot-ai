import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import User


def get_or_create(db: Session, user_id: uuid.UUID) -> User:
    """Just-in-time provisioning (ADR-0007). Safe under concurrent first requests."""
    db.execute(insert(User).values(id=user_id).on_conflict_do_nothing(index_elements=[User.id]))
    return db.execute(select(User).where(User.id == user_id)).scalar_one()
