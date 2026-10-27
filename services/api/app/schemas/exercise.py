from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Mirror of packages/exercise-contracts/src/exercise.ts. The TS zod schema is the source of truth;
# data/exercise-catalog/_schema/exercise.schema.json is exported from it. Keep these in sync —
# tests/test_contract_parity.py fails if the field sets drift.

CameraView = Literal["side", "front", "front_45"]
Capability = Literal["pose_tracking", "rep_counting", "phase_detection", "rule_based_feedback"]


class ExerciseContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[a-z0-9_]+$")
    name: str = Field(min_length=1)
    version: int = Field(gt=0)
    equipment: list[str]
    target_muscles: list[str] = []
    camera_views: list[CameraView] = Field(min_length=1)
    animation_asset: str = Field(pattern=r"\.glb$")
    supported_capabilities: list[Capability] = Field(min_length=1)
    required_landmarks: list[str] = Field(min_length=1)
    ruleset_version: int = Field(gt=0)
    phases: list[str] = Field(min_length=2)
    instructions: list[str] = Field(min_length=1)
    technique_considerations: list[str] = []
