"""Security L4: model-written text (rationale, focus, progression) must not make medical claims.
A hit is a `medical_claim` issue, so the existing repair -> needs_review flow handles it."""

import json
import re
from typing import Any

import pytest

from app.schemas.plan import TrainingPlan
from app.services.catalog import load_catalog
from app.services.llm import FakeReply
from app.services.plans.generator import generate_plan
from app.services.plans.inputs import PlanInputs
from app.services.plans.validation import MEDICAL_TERMS, validate_plan
from tests.llm_helpers import VALID_PLAN, fake_client, plan

CATALOGUE = load_catalog()
BEGINNER = PlanInputs("general_fitness", "beginner", 3, 30, ())


def with_text(field: str, text: str) -> dict[str, Any]:
    data = json.loads(json.dumps(plan()))  # VALID_PLAN's days share exercise dicts: unshare
    if field == "rationale":
        data["rationale"] = text
    elif field == "focus":
        data["days"][1]["focus"] = text
    else:
        data["days"][2]["exercises"][1]["progression"] = text
    return data


def issues(data: dict[str, Any]) -> list[Any]:
    return validate_plan(TrainingPlan.model_validate(data), BEGINNER, CATALOGUE)


def test_a_clean_plan_has_no_medical_claim() -> None:
    assert issues(VALID_PLAN) == []


@pytest.mark.parametrize("field", ["rationale", "focus", "progression"])
@pytest.mark.parametrize("term", sorted(MEDICAL_TERMS))
def test_each_term_is_caught_in_each_field_case_insensitively(field: str, term: str) -> None:
    found = issues(with_text(field, f"A gentle block for {term.upper()} and strength."))
    assert [i.code for i in found] == ["medical_claim"]
    assert field in found[0].message and term in found[0].message


def test_the_required_terms_are_listed() -> None:
    required = {
        "diagnose",
        "diagnosis",
        "injury",
        "injured",
        "pain",
        "rehab",
        "rehabilitation",
        "cure",
        "medication",
        "physiotherapy",
    }
    assert required <= MEDICAL_TERMS
    assert all(re.fullmatch(r"[a-z]+", t) for t in MEDICAL_TERMS)


@pytest.mark.parametrize(
    "text",
    [
        "Painting the walls is not training.",
        "Build a routine that is curated and secure.",
        "A prerehabbed, unmedicated plan.",
        "Gain strength steadily.",
    ],
)
def test_matching_is_by_whole_word(text: str) -> None:
    assert issues(with_text("rationale", text)) == []


def test_punctuation_is_a_word_boundary() -> None:
    assert [i.code for i in issues(with_text("rationale", "No pain, no gain."))] == [
        "medical_claim"
    ]
    assert [i.code for i in issues(with_text("rationale", "Good for (rehab)."))] == [
        "medical_claim"
    ]


def test_one_issue_per_field_not_per_term() -> None:
    found = issues(with_text("rationale", "Rehab after an injury, and no pain."))
    assert [i.code for i in found] == ["medical_claim"]


def test_each_offending_field_is_reported() -> None:
    data = with_text("rationale", "Good for rehab.")
    data["days"][1]["focus"] = "Pain relief"
    found = issues(data)
    assert [i.code for i in found] == ["medical_claim", "medical_claim"]
    assert "rationale" in found[0].message and "focus" in found[1].message


def test_the_message_is_ours_and_does_not_echo_surrounding_model_text() -> None:
    found = issues(with_text("rationale", "SECRET-PHRASE helps your rehab a lot."))
    assert "SECRET-PHRASE" not in found[0].message


def test_a_medical_claim_is_repaired_when_the_second_reply_is_clean() -> None:
    client, fake, _ = fake_client(
        FakeReply.ok(with_text("rationale", "Great for rehab.")), FakeReply.ok(VALID_PLAN)
    )
    draft = generate_plan(BEGINNER, CATALOGUE, client)
    assert (draft.status, draft.result) == ("active", "repaired")
    assert draft.first_issue_codes == ("medical_claim",)
    assert "rationale" in fake.calls[1].messages[-1]["content"]


def test_a_medical_claim_that_survives_the_repair_escalates() -> None:
    bad = with_text("focus", "Injury recovery")
    client, _, _ = fake_client(FakeReply.ok(bad), FakeReply.ok(bad))
    draft = generate_plan(BEGINNER, CATALOGUE, client)
    assert (draft.status, draft.result) == ("needs_review", "escalated")
    assert {i.code for i in draft.issues} == {"medical_claim"}
