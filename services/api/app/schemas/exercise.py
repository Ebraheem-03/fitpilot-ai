from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Mirror of packages/exercise-contracts/src/exercise.ts. The TS zod schema is the source of truth;
# data/exercise-catalog/_schema/exercise.schema.json is exported from it. Keep these in sync —
# tests/test_contract_parity.py fails if the field sets drift, and tests/test_exercise_contract.py
# mirrors the TS timeline rules.

CameraView = Literal["side", "front", "front_45"]
Capability = Literal["pose_tracking", "rep_counting", "phase_detection", "rule_based_feedback"]

# Timeline boundaries match when they are within this many seconds (float JSON round-trips).
TIME_EPSILON = 1e-6


def _near(a: float, b: float) -> bool:
    return abs(a - b) <= TIME_EPSILON


class AnimationPhase(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    phase: str = Field(min_length=1)
    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)
    instruction_indices: list[int]


class ExerciseAnimation(BaseModel):
    """The 3D demonstration (ADR-0009). `asset` is served from `/exercises/<id>/<asset>`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    asset: str = Field(pattern=r"^[a-z0-9_-]+\.glb$")
    clip: str = Field(min_length=1)
    duration_s: float = Field(gt=0)
    phases: list[AnimationPhase] = Field(min_length=1)


class ExerciseContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[a-z0-9_]+$")
    name: str = Field(min_length=1)
    version: int = Field(gt=0)
    equipment: list[str]
    target_muscles: list[str] = []
    camera_views: list[CameraView] = Field(min_length=1)
    animation: ExerciseAnimation
    supported_capabilities: list[Capability] = Field(min_length=1)
    required_landmarks: list[str] = Field(min_length=1)
    ruleset_version: int = Field(gt=0)
    phases: list[str] = Field(min_length=2)
    instructions: list[str] = Field(min_length=1)
    technique_considerations: list[str] = []

    @model_validator(mode="after")
    def _timeline_tiles_the_clip(self) -> Self:
        errors: list[str] = []
        timeline = self.animation.phases
        if not _near(timeline[0].start_s, 0):
            errors.append("animation.phases must start at 0")
        for i, span in enumerate(timeline):
            if span.end_s <= span.start_s:
                errors.append(f"animation.phases[{i}] must have end_s > start_s")
            if i > 0 and not _near(span.start_s, timeline[i - 1].end_s):
                errors.append(f"animation.phases[{i}] must start where phases[{i - 1}] ends")
            if span.phase not in self.phases:
                errors.append(f'animation.phases[{i}].phase "{span.phase}" is not in phases')
            for j, index in enumerate(span.instruction_indices):
                if not 0 <= index < len(self.instructions):
                    errors.append(f"animation.phases[{i}].instruction_indices[{j}] is out of range")
        if not _near(timeline[-1].end_s, self.animation.duration_s):
            errors.append("animation.phases must end at duration_s")
        for phase in self.phases:
            if not any(span.phase == phase for span in timeline):
                errors.append(f'phase "{phase}" never appears in animation.phases')
        if errors:
            raise ValueError("; ".join(errors))
        return self
