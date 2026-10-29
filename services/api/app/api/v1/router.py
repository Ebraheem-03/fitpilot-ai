from fastapi import APIRouter

from app.api.v1 import exercises, profiles, users, workout_sessions

api_router = APIRouter()
api_router.include_router(exercises.router, prefix="/exercises", tags=["exercises"])
api_router.include_router(profiles.router, prefix="/profiles", tags=["profiles"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(
    workout_sessions.router, prefix="/workout-sessions", tags=["workout-sessions"]
)

# Blueprint §7 — add routers here as milestones land:
#   training-plans (FR-02, M3)
#   progress (FR-10, M4) · nutrition-plans (FR-08, M4) · coach (FR-09, M4)
#   trainer / admin (FR-11, M5)
