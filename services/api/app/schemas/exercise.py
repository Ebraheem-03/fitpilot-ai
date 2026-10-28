from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.profile import Equipment

# Mirror of packages/exercise-contracts/src/exercise.ts. The TS zod schema is the source of truth;
# data/exercise-catalog/_schema/exercise.schema.json is exported from it. Keep these in sync —
# tests/test_contract_parity.py fails if the field sets drift, and tests/test_exercise_contract.py
# mirrors the TS timeline rules.

CameraView = Literal["side", "front", "front_45"]
Capability = Literal[
    "pose_tracking", "rep_counting", "phase_detection", "rule_based_feedback", "demo_3d"
]
Prescription = Literal["reps", "duration"]
# The MediaPipe landmarks the vision engine uses (packages/exercise-contracts/src/landmarks.ts).
LandmarkName = Literal[
    "nose",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
    "left_heel",
    "right_heel",
    "left_foot_index",
    "right_foot_index",
]
# Capabilities that need the camera analysis (vision) pipeline; `demo_3d` is the 3D demonstration.
TRACKED_CAPABILITIES: frozenset[str] = frozenset(
    {"pose_tracking", "rep_counting", "phase_detection", "rule_based_feedback"}
)

# Timeline boundaries match when they are within this many seconds (float JSON round-trips).
TIME_EPSILON = 1e-6


def _near(a: float, b: float) -> bool:
    return abs(a - b) <= TIME_EPSILON


class AnimationPhase(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    phase: str = Field(min_length=1)
    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)
    instruction_indices: list[Annotated[int, Field(ge=0)]]


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
    equipment: list[Equipment]
    target_muscles: list[str] = []
    prescription: Prescription
    # required iff the exercise has a tracked capability
    camera_views: list[CameraView] = []
    # required iff `supported_capabilities` includes demo_3d (and only then)
    animation: ExerciseAnimation | None = None
    supported_capabilities: list[Capability] = []
    required_landmarks: list[LandmarkName] = []
    ruleset_version: int | None = Field(default=None, gt=0)
    phases: list[str] = Field(min_length=2)
    instructions: list[str] = Field(min_length=1)
    technique_considerations: list[str] = []

    @model_validator(mode="after")
    def _demo_tracking_and_timeline_rules(self) -> Self:
        errors: list[str] = []
        demo = "demo_3d" in self.supported_capabilities
        if demo and self.animation is None:
            errors.append("animation is required when demo_3d is supported")
        if not demo and self.animation is not None:
            errors.append("animation requires the demo_3d capability")
        if TRACKED_CAPABILITIES.intersection(self.supported_capabilities):
            why = "is required for a tracked exercise"
            if not self.camera_views:
                errors.append(f"camera_views {why}")
            if not self.required_landmarks:
                errors.append(f"required_landmarks {why}")
            if self.ruleset_version is None:
                errors.append(f"ruleset_version {why}")
        if self.animation is not None:
            errors.extend(self._timeline_errors(self.animation))
        if errors:
            raise ValueError("; ".join(errors))
        return self

    def _timeline_errors(self, animation: ExerciseAnimation) -> list[str]:
        errors: list[str] = []
        timeline = animation.phases
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
        if not _near(timeline[-1].end_s, animation.duration_s):
            errors.append("animation.phases must end at duration_s")
        for phase in self.phases:
            if not any(span.phase == phase for span in timeline):
                errors.append(f'phase "{phase}" never appears in animation.phases')
        return errors
