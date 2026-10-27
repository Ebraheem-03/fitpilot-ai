"""S2 (#8): database-level invariants for identity, profiles and gym membership."""

import uuid

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Gym, GymMembership, MemberProfile, User, UserRole, UserStatus


def make_user(db: Session) -> User:
    user = User(id=uuid.uuid4())
    db.add(user)
    db.flush()
    return user


def test_user_defaults_to_active_member(db: Session) -> None:
    user = make_user(db)
    db.refresh(user)
    assert user.role is UserRole.member
    assert user.status is UserStatus.active
    assert user.created_at is not None


def test_profile_is_one_per_user(db: Session) -> None:
    user = make_user(db)
    db.add(MemberProfile(user_id=user.id, primary_goal="general_fitness"))
    db.flush()
    db.add(MemberProfile(user_id=user.id, primary_goal="strength"))
    with pytest.raises(IntegrityError):
        db.flush()


@pytest.mark.parametrize("days", [0, 8])
def test_profile_days_per_week_bounded(db: Session, days: int) -> None:
    user = make_user(db)
    db.add(MemberProfile(user_id=user.id, primary_goal="strength", days_per_week=days))
    with pytest.raises(IntegrityError):
        db.flush()


def test_deleting_user_cascades_to_profile_and_memberships(db: Session) -> None:
    user = make_user(db)
    gym = Gym(name="Test Gym")
    db.add_all([gym, MemberProfile(user_id=user.id, primary_goal="strength")])
    db.flush()
    db.add(GymMembership(gym_id=gym.id, user_id=user.id))
    db.flush()

    db.delete(user)
    db.flush()
    db.expire_all()
    assert db.get(MemberProfile, user.id) is None
    assert db.query(GymMembership).filter_by(user_id=user.id).count() == 0


def test_membership_unique_per_gym_and_user(db: Session) -> None:
    user = make_user(db)
    gym = Gym(name="Test Gym")
    db.add(gym)
    db.flush()
    db.add(GymMembership(gym_id=gym.id, user_id=user.id))
    db.flush()
    db.add(GymMembership(gym_id=gym.id, user_id=user.id))
    with pytest.raises(IntegrityError):
        db.flush()
