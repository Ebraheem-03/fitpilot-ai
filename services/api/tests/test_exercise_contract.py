"""Animation timeline rules mirror packages/exercise-contracts/test/exercise.test.ts (FR-03)."""

from collections.abc import Callable
from typing import Any

import pytest
from pydantic import ValidationError

from app.schemas.exercise import ExerciseContract


def _valid() -> dict[str, Any]:
    return {
        "id": "demo_squat",
        "name": "Demo Squat",
        "version": 1,
        "equipment": [],
        "prescription": "reps",
        "camera_views": ["side"],
        "animation": {
            "asset": "squat.glb",
            "clip": "squat",
            "duration_s": 4,
            "phases": [
                {"phase": "standing", "start_s": 0, "end_s": 0.5, "instruction_indices": [0]},
                {"phase": "descending", "start_s": 0.5, "end_s": 2, "instruction_indices": [1]},
                {"phase": "bottom", "start_s": 2, "end_s": 2.4, "instruction_indices": []},
                {"phase": "ascending", "start_s": 2.4, "end_s": 3.6, "instruction_indices": [1]},
                {"phase": "standing", "start_s": 3.6, "end_s": 4, "instruction_indices": [0]},
            ],
        },
        "supported_capabilities": ["demo_3d", "rep_counting"],
        "required_landmarks": ["left_hip"],
        "ruleset_version": 1,
        "phases": ["standing", "descending", "bottom", "ascending"],
        "instructions": ["Stand tall.", "Sit back."],
    }


def _phase(e: dict[str, Any], i: int) -> dict[str, Any]:
    phase: dict[str, Any] = e["animation"]["phases"][i]
    return phase


def test_accepts_contiguous_timeline() -> None:
    ExerciseContract.model_validate(_valid())


def _set_start(i: int, value: float) -> Callable[[dict[str, Any]], None]:
    return lambda e: _phase(e, i).update(start_s=value)


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (_set_start(0, 0.1), "animation.phases must start at 0"),
        (_set_start(1, 0.6), "animation.phases[1] must start where phases[0] ends"),
        (_set_start(1, 0.4), "animation.phases[1] must start where phases[0] ends"),
        (
            lambda e: e["animation"].update(duration_s=5),
            "animation.phases must end at duration_s",
        ),
        (
            lambda e: (_phase(e, 2).update(end_s=2), _phase(e, 3).update(start_s=2)),
            "animation.phases[2] must have end_s > start_s",
        ),
        (
            lambda e: _phase(e, 2).update(phase="hold"),
            'animation.phases[2].phase "hold" is not in phases',
        ),
        (
            lambda e: e["phases"].append("lockout"),
            'phase "lockout" never appears in animation.phases',
        ),
        (
            lambda e: _phase(e, 2).update(instruction_indices=[2]),
            "animation.phases[2].instruction_indices[0] is out of range",
        ),
    ],
)
def test_rejects_invalid_timeline(mutate: Callable[[dict[str, Any]], object], message: str) -> None:
    e = _valid()
    mutate(e)
    with pytest.raises(ValidationError, match=message.replace("[", r"\[").replace("]", r"\]")):
        ExerciseContract.model_validate(e)


@pytest.mark.parametrize("asset", ["../secret.glb", "a/b.glb", "squat.gltf", "https://x.io/s.glb"])
def test_asset_must_be_bare_glb_file_name(asset: str) -> None:
    e = _valid()
    e["animation"]["asset"] = asset
    with pytest.raises(ValidationError):
        ExerciseContract.model_validate(e)


def _untracked(e: dict[str, Any]) -> None:
    for field in ("animation", "ruleset_version", "camera_views", "required_landmarks"):
        e.pop(field)
    e["supported_capabilities"] = []


def test_accepts_untracked_exercise_without_demo() -> None:
    e = _valid()
    _untracked(e)
    parsed = ExerciseContract.model_validate(e)
    assert parsed.animation is None
    assert parsed.ruleset_version is None


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda e: e.pop("animation"), "animation is required when demo_3d is supported"),
        (
            lambda e: e.update(supported_capabilities=["rep_counting"]),
            "animation requires the demo_3d capability",
        ),
        (lambda e: e.update(camera_views=[]), "camera_views is required for a tracked exercise"),
        (
            lambda e: e.update(required_landmarks=[]),
            "required_landmarks is required for a tracked exercise",
        ),
        (
            lambda e: e.pop("ruleset_version"),
            "ruleset_version is required for a tracked exercise",
        ),
    ],
)
def test_demo_and_tracking_requirements(
    mutate: Callable[[dict[str, Any]], object], message: str
) -> None:
    e = _valid()
    mutate(e)
    with pytest.raises(ValidationError, match=message):
        ExerciseContract.model_validate(e)


def test_demo_only_exercise_needs_no_tracking_fields() -> None:
    e = _valid()
    e["supported_capabilities"] = ["demo_3d"]
    for field in ("ruleset_version", "camera_views", "required_landmarks"):
        e.pop(field)
    ExerciseContract.model_validate(e)


def test_equipment_must_be_one_the_profile_can_express() -> None:
    e = _valid()
    e["equipment"] = ["dumbbells", "mat"]
    ExerciseContract.model_validate(e)
    e["equipment"] = ["rowing_machine"]
    with pytest.raises(ValidationError):
        ExerciseContract.model_validate(e)


@pytest.mark.parametrize("prescription", ["sets", None])
def test_prescription_is_reps_or_duration(prescription: str | None) -> None:
    e = _valid()
    e["prescription"] = prescription
    with pytest.raises(ValidationError):
        ExerciseContract.model_validate(e)
    e["prescription"] = "duration"
    ExerciseContract.model_validate(e)
