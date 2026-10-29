"""Which coaching rules may produce a cue, and the measurement keys each may report.

The declaration lives in packages/exercise-contracts/src/cue-rules.ts (`CUE_RULES`) and is exported
to data/exercise-catalog/_schema/cue-rules.json by `export:jsonschema`; a TS test fails when the
committed JSON is stale and tests/test_session_contract_parity.py pins this module to it. A
`feedback_shown` event is rejected unless its rule, exercise, ruleset version and measurement keys
are declared (FR-06 traceability; ADR-0011 §1: no landmark or per-frame data in a free-form record).
"""

import json
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import TypedDict

CUE_RULES_PATH = (
    Path(__file__).resolve().parents[4] / "data" / "exercise-catalog" / "_schema" / "cue-rules.json"
)


class CueRuleDeclaration(TypedDict):
    exercise_id: str
    # the exercise's catalogue ruleset_version; a cue must report the same one
    ruleset_version: int
    measurements: list[str]


def load_cue_rules(path: Path = CUE_RULES_PATH) -> Mapping[str, CueRuleDeclaration]:
    rules: dict[str, CueRuleDeclaration] = json.loads(path.read_text())
    return rules


CUE_RULES: Mapping[str, CueRuleDeclaration] = load_cue_rules()


def cue_rule_violation(
    rule_id: str,
    exercise_id: str,
    measurement_keys: Iterable[str],
    ruleset_version: int,
    rules: Mapping[str, CueRuleDeclaration] = CUE_RULES,
) -> str | None:
    """Why this (rule, exercise, ruleset version, measurement keys) is invalid; None when valid."""
    rule = rules.get(rule_id)
    if rule is None:
        return f'unknown rule_id "{rule_id}"'
    if rule["exercise_id"] != exercise_id:
        return f'rule_id "{rule_id}" does not belong to exercise "{exercise_id}"'
    if rule["ruleset_version"] != ruleset_version:
        return (
            f'rule_id "{rule_id}" belongs to ruleset_version {rule["ruleset_version"]}, '
            f"not {ruleset_version}"
        )
    undeclared = [key for key in measurement_keys if key not in rule["measurements"]]
    if undeclared:
        return f'measurements not declared by "{rule_id}": {", ".join(undeclared)}'
    return None
