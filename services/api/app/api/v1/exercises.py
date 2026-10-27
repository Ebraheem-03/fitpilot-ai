from fastapi import APIRouter, HTTPException

from app.schemas.exercise import ExerciseContract
from app.services.catalog import load_catalog

router = APIRouter()


@router.get("", response_model=list[ExerciseContract])
def list_exercises() -> list[ExerciseContract]:
    """Approved exercise catalogue — the only exercises AI may select (principle 2, FR-02)."""
    return list(load_catalog().values())


@router.get("/{exercise_id}", response_model=ExerciseContract)
def get_exercise(exercise_id: str) -> ExerciseContract:
    catalog = load_catalog()
    if exercise_id not in catalog:
        raise HTTPException(status_code=404, detail="exercise not in approved catalogue")
    return catalog[exercise_id]
