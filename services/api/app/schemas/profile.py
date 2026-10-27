from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.models import ExperienceLevel, Goal


class Equipment(StrEnum):
    dumbbells = "dumbbells"
    kettlebell = "kettlebell"
    resistance_band = "resistance_band"
    pull_up_bar = "pull_up_bar"
    bench = "bench"
    barbell = "barbell"
    mat = "mat"


def _unique(items: list[Equipment]) -> list[Equipment]:
    if len(set(items)) != len(items):
        raise ValueError("equipment items must be unique")
    return items


EquipmentList = Annotated[
    list[Equipment], Field(max_length=len(Equipment)), AfterValidator(_unique)
]
DaysPerWeek = Annotated[int, Field(ge=1, le=7)]
SessionMinutes = Annotated[int, Field(ge=10, le=180)]


class ProfileCreate(BaseModel):
    # extra="forbid": a body can never carry user_id/role/status (mass assignment, FR-01).
    model_config = ConfigDict(extra="forbid")

    primary_goal: Goal
    experience_level: ExperienceLevel = ExperienceLevel.beginner
    days_per_week: DaysPerWeek | None = None
    session_minutes: SessionMinutes | None = None
    equipment: EquipmentList = []


class ProfileUpdate(BaseModel):
    """Partial update: only fields present in the body change."""

    model_config = ConfigDict(extra="forbid")

    primary_goal: Goal | None = None
    experience_level: ExperienceLevel | None = None
    days_per_week: DaysPerWeek | None = None
    session_minutes: SessionMinutes | None = None
    equipment: EquipmentList | None = None

    @model_validator(mode="after")
    def _required_fields_not_cleared(self) -> "ProfileUpdate":
        for name in ("primary_goal", "experience_level", "equipment"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    primary_goal: Goal
    experience_level: ExperienceLevel
    days_per_week: int | None
    session_minutes: int | None
    equipment: list[Equipment]
    created_at: datetime
    updated_at: datetime
