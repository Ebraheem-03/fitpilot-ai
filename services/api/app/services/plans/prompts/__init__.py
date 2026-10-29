"""Versioned plan-generation prompts (FR-13: prompts are versioned; ADR-0004).

`PROMPT_VERSION` names the files `<version>.{system,user,repair}.md` in this folder and is stored
on every plan row and every `llm.call` event. Any edit to these files is a new version: copy them
to the next version, bump `PROMPT_VERSION`, and rerun the eval suite (M3 S5).
`PROMPT_SHA256` (stored in generation metadata) makes an unversioned edit detectable.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from functools import cache
from pathlib import Path
from string import Template

from app.schemas import plan as limits
from app.schemas.exercise import ExerciseContract
from app.services.plans.inputs import PlanInputs
from app.services.plans.validation import SECONDS_PER_REP, WARMUP_MIN

PROMPT_VERSION = "plan-v1"
PROMPT_DIR = Path(__file__).resolve().parent
PARTS = ("system", "user", "repair")


@cache
def _template(version: str, part: str) -> Template:
    return Template((PROMPT_DIR / f"{version}.{part}.md").read_text())


def prompt_sha256(version: str = PROMPT_VERSION) -> str:
    digest = hashlib.sha256()
    for part in PARTS:
        digest.update((PROMPT_DIR / f"{version}.{part}.md").read_bytes())
    return digest.hexdigest()


def system_prompt(exercises: Mapping[str, ExerciseContract], version: str = PROMPT_VERSION) -> str:
    rows = "\n".join(
        f"| {e.id} | {e.name} | {', '.join(e.equipment) or 'none'} | {e.prescription} "
        f"| {', '.join(e.target_muscles) or '-'} |"
        for e in exercises.values()
    )
    return _template(version, "system").substitute(
        catalogue_rows=rows,
        reps_min=limits.REPS[0],
        reps_max=limits.REPS[1],
        duration_min=limits.DURATION_S[0],
        duration_max=limits.DURATION_S[1],
        sets_min=limits.SETS[0],
        sets_max=limits.SETS[1],
        rest_min=limits.REST_S[0],
        rest_max=limits.REST_S[1],
        per_day_min=limits.EXERCISES_PER_DAY[0],
        per_day_max=limits.EXERCISES_PER_DAY[1],
        warmup_min=WARMUP_MIN,
        seconds_per_rep=SECONDS_PER_REP,
    )


def user_prompt(inputs: PlanInputs, version: str = PROMPT_VERSION) -> str:
    return _template(version, "user").substitute(
        profile_json=json.dumps(inputs.prompt_fields(), indent=2)
    )


def repair_prompt(issues: Sequence[str], version: str = PROMPT_VERSION) -> str:
    return _template(version, "repair").substitute(
        issues="\n".join(f"- {issue}" for issue in issues[:20])
    )
