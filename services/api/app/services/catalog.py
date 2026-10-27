import json
from functools import lru_cache
from pathlib import Path

from app.schemas.exercise import ExerciseContract

CATALOG_DIR = Path(__file__).resolve().parents[4] / "data" / "exercise-catalog"


@lru_cache
def load_catalog(directory: Path = CATALOG_DIR) -> dict[str, ExerciseContract]:
    """Load and validate every approved exercise. Invalid files fail loudly at startup."""
    exercises: dict[str, ExerciseContract] = {}
    for path in sorted(directory.glob("*.json")):
        ex = ExerciseContract.model_validate(json.loads(path.read_text()))
        exercises[ex.id] = ex
    return exercises
