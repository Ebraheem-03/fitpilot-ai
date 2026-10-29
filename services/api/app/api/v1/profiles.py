from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.profile import ProfileCreate, ProfileOut, ProfileUpdate, TrackingConsentGrant
from app.services import profiles
from app.services.profiles import ProfileExists, ProfileNotFound

router = APIRouter()

NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")


@router.post("", response_model=ProfileOut, status_code=status.HTTP_201_CREATED)
def create_profile(body: ProfileCreate, user: CurrentUser, db: DbSession) -> ProfileOut:
    """Initialise the caller's profile (blueprint §7). A second call is 409; use PATCH /me."""
    try:
        return ProfileOut.model_validate(profiles.create_own(db, user, body))
    except ProfileExists as e:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Profile already exists") from e


@router.get("/me", response_model=ProfileOut)
def read_my_profile(user: CurrentUser, db: DbSession) -> ProfileOut:
    try:
        return ProfileOut.model_validate(profiles.get_own(db, user))
    except ProfileNotFound as e:
        raise NOT_FOUND from e


@router.patch("/me", response_model=ProfileOut)
def update_my_profile(body: ProfileUpdate, user: CurrentUser, db: DbSession) -> ProfileOut:
    try:
        return ProfileOut.model_validate(profiles.update_own(db, user, body))
    except ProfileNotFound as e:
        raise NOT_FOUND from e


@router.put("/me/tracking-consent", response_model=ProfileOut)
def grant_tracking_consent(
    body: TrackingConsentGrant, user: CurrentUser, db: DbSession
) -> ProfileOut:
    """Agree to saving derived camera metrics (ADR-0011 §4). The server sets the timestamp."""
    try:
        return ProfileOut.model_validate(profiles.grant_tracking_consent(db, user, body.version))
    except ProfileNotFound as e:
        raise NOT_FOUND from e


@router.delete("/me/tracking-consent", response_model=ProfileOut)
def withdraw_tracking_consent(user: CurrentUser, db: DbSession) -> ProfileOut:
    """Withdraw consent: tracked events are refused from now on; saved sessions are kept."""
    try:
        return ProfileOut.model_validate(profiles.withdraw_tracking_consent(db, user))
    except ProfileNotFound as e:
        raise NOT_FOUND from e
