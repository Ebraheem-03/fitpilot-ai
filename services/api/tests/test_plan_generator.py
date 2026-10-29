"""Plan generation without a DB (FR-02, ADR-0004): generate → validate → repair once → escalate.
Synthetic inputs only. Every LLM reply is scripted on the fake provider."""

import copy
import json
from typing import Any

import pytest

from app.schemas.plan import TrainingPlan
from app.services.catalog import load_catalog
from app.services.llm import FakeReply
from app.services.plans import fake_planner, prompts
from app.services.plans.generator import generate_plan
from app.services.plans.inputs import (
    DEFAULT_DAYS_PER_WEEK,
    DEFAULT_SESSION_MINUTES,
    PlanInputs,
)
from app.services.plans.validation import estimate_minutes, validate_plan
from tests.llm_helpers import PLANK, ROW, SQUAT, VALID_PLAN, fake_client, plan

CATALOGUE = load_catalog()
BEGINNER = PlanInputs("general_fitness", "beginner", 3, 30, ())
WITH_DUMBBELLS = PlanInputs("muscle_gain", "intermediate", 3, 30, ("dumbbells",))


def codes(draft: Any) -> set[str]:
    return {i.code for i in draft.issues}


def test_valid_first_try_is_active_after_one_call() -> None:
    client, fake, _ = fake_client(FakeReply.ok(VALID_PLAN))
    draft = generate_plan(BEGINNER, CATALOGUE, client)
    assert (draft.status, draft.result, draft.issues) == ("active", "valid_first_try", ())
    assert draft.plan == TrainingPlan.model_validate(VALID_PLAN)
    assert len(fake.calls) == 1 and draft.prompt_version == prompts.PROMPT_VERSION
    meta = draft.metadata()
    assert meta["result"] == "valid_first_try" and len(meta["attempts"]) == 1
    assert meta["prompt_sha256"] == prompts.prompt_sha256()


def test_provider_failure_then_valid_is_repaired_with_the_error_fed_back() -> None:
    client, fake, _ = fake_client(
        FakeReply.json_validate_failed("max completion tokens reached", '{"days": ['),
        FakeReply.ok(VALID_PLAN),
    )
    draft = generate_plan(BEGINNER, CATALOGUE, client)
    assert (draft.status, draft.result) == ("active", "repaired")
    assert draft.first_issue_codes == ("generation_failed",)

    repair = fake.calls[1].messages
    assert repair[:2] == fake.calls[0].messages  # original system + user
    assert repair[2] == {"role": "assistant", "content": '{"days": ['}
    assert repair[3]["role"] == "user"
    assert "max completion tokens reached" in repair[3]["content"]
    assert "rejected by validation" in repair[3]["content"]


def test_domain_violation_then_valid_is_repaired() -> None:
    bad = plan()
    bad["days"] = bad["days"][:2]
    client, fake, _ = fake_client(FakeReply.ok(bad), FakeReply.ok(VALID_PLAN))
    draft = generate_plan(BEGINNER, CATALOGUE, client)
    assert draft.result == "repaired" and draft.first_issue_codes == ("days_count",)
    assert (
        "the plan has 2 training days; days_per_week is 3" in fake.calls[1].messages[-1]["content"]
    )
    assert json.loads(fake.calls[1].messages[2]["content"]) == bad


def test_still_invalid_after_repair_escalates_to_needs_review() -> None:
    bad = plan()
    bad["days"][0]["exercises"][0] = {**SQUAT, "exercise_id": "dragon_flag"}
    client, fake, _ = fake_client(FakeReply.ok(bad), FakeReply.ok(bad))
    draft = generate_plan(BEGINNER, CATALOGUE, client)
    assert (draft.status, draft.result) == ("needs_review", "escalated")
    assert codes(draft) == {"catalogue"}
    assert [i.message for i in draft.issues] == [
        "monday: dragon_flag is not in the approved catalogue"
    ]
    assert draft.plan is not None  # kept for trainer review, never shown to the member
    assert len(fake.calls) == 2  # exactly one repair


def test_unparseable_twice_escalates_with_no_draft() -> None:
    client, _, _ = fake_client(FakeReply.json_validate_failed(), FakeReply.ok("not json"))
    draft = generate_plan(BEGINNER, CATALOGUE, client)
    assert draft.status == "needs_review" and draft.plan is None
    assert codes(draft) == {"schema"}


def _escalated(inputs: PlanInputs, bad: dict[str, Any]) -> Any:
    client, _, _ = fake_client(FakeReply.ok(bad), FakeReply.ok(bad))
    return generate_plan(inputs, CATALOGUE, client)


def test_equipment_violation_is_rejected() -> None:
    bad = plan()
    bad["days"][1]["exercises"][0] = ROW
    draft = _escalated(BEGINNER, bad)
    assert codes(draft) == {"equipment"}
    assert draft.issues[0].message == (
        "wednesday: dumbbell_row needs dumbbells, which the member doesn't have"
    )
    assert _escalated(WITH_DUMBBELLS, bad).status == "active"


def test_session_length_overrun_is_rejected() -> None:
    long_day = plan()
    long_day["days"][2]["exercises"] = [{**SQUAT, "sets": 6, "rest_s": 240}]  # 5 + 6*270/60 = 32
    draft = _escalated(BEGINNER, long_day)
    assert codes(draft) == {"session_length"}
    assert "friday: estimated 32.0 min exceeds session_minutes 30" in draft.issues[0].message


def test_prescription_mismatch_is_rejected() -> None:
    bad = plan()
    bad["days"][0]["exercises"][2] = {**PLANK, "reps": 30, "duration_s": None}
    assert codes(_escalated(BEGINNER, bad)) == {"prescription"}


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda p: p["days"][0]["exercises"].append(copy.deepcopy(SQUAT)), "duplicate_exercise"),
        (lambda p: p["days"][1].update(day_of_week="monday"), "days_distinct"),
        (
            lambda p: p["days"][0]["exercises"][0].update(duration_s=30),
            "reps_or_duration",
        ),
        (lambda p: p["days"][0]["exercises"][0].update(sets=9), "schema"),
    ],
)
def test_contract_violations_keep_their_own_code(mutate: Any, code: str) -> None:
    bad = plan()
    mutate(bad)
    assert codes(_escalated(BEGINNER, bad)) == {code}


def test_wire_schema_enum_is_the_catalogue_filtered_by_equipment() -> None:
    client, fake, _ = fake_client(FakeReply.ok(VALID_PLAN))
    generate_plan(BEGINNER, CATALOGUE, client)
    exercise_id = fake.calls[0].json_schema["$defs"]["PlannedExercise"]["properties"]["exercise_id"]
    assert set(exercise_id["enum"]) == {
        "bodyweight_squat",
        "push_up",
        "glute_bridge",
        "plank",
        "reverse_lunge",
    }

    client, fake, _ = fake_client(FakeReply.ok(VALID_PLAN))
    generate_plan(WITH_DUMBBELLS, CATALOGUE, client)
    enum = fake.calls[0].json_schema["$defs"]["PlannedExercise"]["properties"]["exercise_id"]
    assert {"dumbbell_row", "dumbbell_biceps_curl"} <= set(enum["enum"])


def test_prompt_carries_only_the_authorized_profile_fields() -> None:
    client, fake, _ = fake_client(FakeReply.ok(VALID_PLAN))
    generate_plan(BEGINNER, CATALOGUE, client)
    system, user = fake.calls[0].messages
    profile = json.loads(user["content"].split("Member profile:", 1)[1])
    assert profile == {
        "primary_goal": "general_fitness",
        "experience_level": "beginner",
        "days_per_week": 3,
        "session_minutes": 30,
        "equipment": [],
    }
    assert "| plank | Plank | none | duration |" in system["content"]
    assert "dumbbell_row" not in system["content"]  # not eligible, not offered
    assert "${" not in system["content"]


def test_unset_schedule_gets_the_documented_defaults() -> None:
    class Profile:
        primary_goal = "mobility"
        experience_level = "beginner"
        days_per_week = None
        session_minutes = None
        equipment = ("mat",)

    inputs = PlanInputs.from_profile(Profile())
    assert (
        (inputs.days_per_week, inputs.session_minutes)
        == (
            DEFAULT_DAYS_PER_WEEK,
            DEFAULT_SESSION_MINUTES,
        )
        == (3, 45)
    )
    assert inputs.defaults_applied == ("days_per_week", "session_minutes")
    assert inputs.as_metadata()["defaults_applied"] == ["days_per_week", "session_minutes"]


def test_fixture_key_is_stable_and_selects_canned_replies() -> None:
    key = BEGINNER.fixture_key()
    assert key == PlanInputs("general_fitness", "beginner", 3, 30, ()).fixture_key()
    assert key != WITH_DUMBBELLS.fixture_key()
    client, _, _ = fake_client(by_key={key: [FakeReply.ok(VALID_PLAN)]})
    assert generate_plan(BEGINNER, CATALOGUE, client).status == "active"


def test_estimate_formula_matches_the_spike() -> None:
    day = TrainingPlan.model_validate(VALID_PLAN).days[0]
    # 5 + 3 exercises x 3 sets x (30 s work + 60 s rest) / 60
    assert estimate_minutes(day) == pytest.approx(5 + 3 * 270 / 60) == 18.5


@pytest.mark.parametrize("days", range(1, 8))
@pytest.mark.parametrize("minutes", [10, 15, 45, 180])
@pytest.mark.parametrize("equipment", [(), ("dumbbells",), ("kettlebell", "resistance_band")])
def test_fake_planner_always_produces_a_valid_plan(
    days: int, minutes: int, equipment: tuple[str, ...]
) -> None:
    inputs = PlanInputs("strength", "intermediate", days, minutes, equipment)
    client, fake, _ = fake_client(responder=fake_planner.respond)
    draft = generate_plan(inputs, CATALOGUE, client)
    assert draft.status == "active", draft.issues
    assert draft.plan is not None and validate_plan(draft.plan, inputs, CATALOGUE) == []
    assert len(fake.calls) == 1
