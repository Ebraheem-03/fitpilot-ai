"""Member profiles (FR-01). Every operation is scoped to the authenticated user — there is no
way to address another member's profile, by id or otherwise."""

import logging
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.logging import log_event
from app.models import MemberProfile, User
from app.repositories import profiles
from app.schemas.profile import MIN_TRACKING_CONSENT_VERSION, ProfileCreate, ProfileUpdate

logger = logging.getLogger("fitpilot.consent")


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


def has_tracking_consent(db: Session, user: User) -> bool:
    """Has the member agreed (and not withdrawn) to saving derived camera metrics? (ADR-0011 §4)"""
    profile = profiles.get(db, user.id)
    return (
        profile is not None
        and profile.tracking_data_consent_at is not None
        and (profile.tracking_data_consent_version or 0) >= MIN_TRACKING_CONSENT_VERSION
    )


def grant_tracking_consent(db: Session, user: User, version: int) -> MemberProfile:
    """Record agreement to `version` of the copy. Repeating the same version keeps the original
    timestamp: the audit trail says when the member first agreed."""
    profile = get_own(db, user)
    if profile.tracking_data_consent_at is None or profile.tracking_data_consent_version != version:
        profiles.update(
            db,
            profile,
            {
                "tracking_data_consent_at": datetime.now(UTC),
                "tracking_data_consent_version": version,
            },
        )
        db.commit()
        db.refresh(profile)
    log_event(logger, "consent.granted", version=version)
    return profile


def withdraw_tracking_consent(db: Session, user: User) -> MemberProfile:
    """Stops future uploads of tracked events. Already saved sessions stay until deleted."""
    profile = get_own(db, user)
    if profile.tracking_data_consent_at is not None:
        profiles.update(
            db,
            profile,
            {"tracking_data_consent_at": None, "tracking_data_consent_version": None},
        )
        db.commit()
        db.refresh(profile)
    log_event(logger, "consent.withdrawn")
    return profile
