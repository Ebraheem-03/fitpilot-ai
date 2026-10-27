"""The web's hand-written enum mirrors must match the API's (ADR-0008) — drift fails CI."""

import re
from enum import StrEnum
from pathlib import Path

import pytest

from app.models import ExperienceLevel, Goal, UserRole
from app.schemas.profile import Equipment

WEB_TYPES = Path(__file__).resolve().parents[3] / "apps" / "web" / "src" / "lib" / "api-types.ts"


def ts_const(name: str) -> list[str]:
    match = re.search(rf"export const {name} = \[(.*?)\] as const", WEB_TYPES.read_text(), re.S)
    assert match, f"{name} not found in {WEB_TYPES}"
    return re.findall(r'"([^"]+)"', match.group(1))


def ts_union(name: str) -> list[str]:
    match = re.search(rf"export type {name} = ([^;]+);", WEB_TYPES.read_text())
    assert match, f"type {name} not found in {WEB_TYPES}"
    return re.findall(r'"([^"]+)"', match.group(1))


@pytest.mark.parametrize(
    ("ts_name", "enum"),
    [("GOALS", Goal), ("EXPERIENCE", ExperienceLevel), ("EQUIPMENT", Equipment)],
)
def test_const_lists_match(ts_name: str, enum: type[StrEnum]) -> None:
    assert ts_const(ts_name) == [m.value for m in enum]


def test_role_union_matches() -> None:
    assert sorted(ts_union("Role")) == sorted(m.value for m in UserRole)
