"""Member profiles (FR-01). Every operation is scoped to the authenticated user — there is no
way to address another member's profile, by id or otherwise."""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import MemberProfile, User
from app.repositories import profiles
from app.schemas.profile import ProfileCreate, ProfileUpdate


class ProfileExists(Exception):
    pass


class ProfileNotFound(Exception):
    pass


def get_own(db: Session, user: User) -> MemberProfile:
    profile = profiles.get(db, user.id)
    if profile is None:
        raise ProfileNotFound
    return profile


def create_own(db: Session, user: User, data: ProfileCreate) -> MemberProfile:
    if profiles.get(db, user.id) is not None:
        raise ProfileExists
    try:
        profile = profiles.add(db, user.id, data.model_dump(mode="json"))
        db.commit()
    except IntegrityError as e:  # concurrent first POST lost the race on the primary key
        db.rollback()
        raise ProfileExists from e
    db.refresh(profile)
    return profile


def update_own(db: Session, user: User, data: ProfileUpdate) -> MemberProfile:
    profile = get_own(db, user)
    profiles.update(db, profile, data.model_dump(mode="json", exclude_unset=True))
    db.commit()
    db.refresh(profile)
    return profile
