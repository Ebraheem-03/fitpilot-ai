"""The plan-generation eval suite (FR-02, FR-13, blueprint §10). Offline only: every reply comes
from the fake provider, so the metrics on the scripted outcomes are known exactly and the scorer
itself is what's under test. The last test is the CI guard tying prompt files to a live report."""

import json
from pathlib import Path
from typing import Any

import pytest

from app.models import ExperienceLevel, Goal
from app.schemas.plan import TrainingPlan
from app.services.catalog import load_catalog
from app.services.evaluation import plan_suite as ps
from app.services.evaluation import plans as runner
from app.services.evaluation import report as rep
from app.services.llm import BudgetGuard, FakeProvider, FakeReply, LLMClient
from app.services.plans import fake_planner, prompts
from app.services.plans.validation import eligible_exercises

CATALOGUE = load_catalog()
SUITE = ps.load_suite()


def stable(run: dict[str, Any]) -> dict[str, Any]:
    """The aggregate without wall-clock latency."""
    agg = dict(run["aggregate"])
    agg.pop("latency_s")
    return agg


@pytest.fixture(scope="module")
def offline() -> dict[str, Any]:
    return runner.run_offline(SUITE)


# --- Fixtures.


def test_suite_covers_the_required_space() -> None:
    profiles = SUITE.profiles
    inputs = [p.inputs for p in profiles]
    assert 18 <= len(profiles) <= 25
    assert {(i.primary_goal, i.experience_level) for i in inputs} == {
        (g, e) for g in Goal for e in ExperienceLevel
    }
    assert {i.days_per_week for i in inputs} == set(range(1, 8))
    minutes = {i.session_minutes for i in inputs}
    assert {10, 180} <= minutes
    kinds = {
        "none" if not i.equipment else "dumbbells" if "dumbbells" in i.equipment else "other"
        for i in inputs
    }
    assert kinds == {"none", "dumbbells", "other"}
    by_id = {p.id[:3]: p for p in profiles}
    assert by_id["p12"].inputs.days_per_week == 7 and by_id["p12"].inputs.session_minutes == 10
    assert by_id["p12"].expect.outcome == "either"
    assert [p.id for p in profiles if p.expect.outcome == "needs_review"] == [
        "p20_infeasible_five_minutes"
    ]


def test_fixtures_hold_only_the_five_generator_fields() -> None:
    raw = json.loads(ps.SUITE_PATH.read_text())
    for profile in raw["profiles"]:
        assert set(profile) == {"id", "description", "inputs", "expect"}
        assert set(profile["inputs"]) == {
            "primary_goal",
            "experience_level",
            "days_per_week",
            "session_minutes",
            "equipment",
        }


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda s: s["profiles"].append(dict(s["profiles"][0])), "duplicate profile ids"),
        (lambda s: s["profiles"][0]["inputs"].update(session_minutes=5), "below the API floor"),
        (
            lambda s: s["profiles"][0]["expect"].update(uses_equipment=["barbell"]),
            "doesn't own",
        ),
        (lambda s: s["profiles"][0]["inputs"].update(name="Jane"), "Extra inputs"),
        (lambda s: s["profiles"].pop(), "escalation-expected"),
    ],
)
def test_a_malformed_suite_fails_loudly(tmp_path: Path, change: Any, message: str) -> None:
    raw = json.loads(ps.SUITE_PATH.read_text())
    change(raw)
    path = tmp_path / "suite.json"
    path.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match=message):
        ps.load_suite(path)


def test_offline_replies_must_name_known_profiles(tmp_path: Path) -> None:
    path = tmp_path / "replies.json"
    path.write_text(json.dumps({"description": "x", "replies": {"p99_ghost": []}}))
    with pytest.raises(ValueError, match="unknown profiles"):
        ps.load_offline_replies(SUITE, path)


# --- Independent constraint checks.


def planner_plan(fixture_id: str = "p01") -> tuple[dict[str, Any], ps.PlanFixture]:
    fixture = next(p for p in SUITE.profiles if p.id.startswith(fixture_id))
    inputs = fixture.inputs.plan_inputs()
    ids = list(eligible_exercises(CATALOGUE, inputs.equipment))
    plan = fake_planner.build_plan(ids, inputs.days_per_week, inputs.session_minutes)
    return plan.model_dump(), fixture


@pytest.mark.parametrize(
    ("mutation", "broken"),
    [
        ("drop_day", "days"),
        ("unknown_exercise", "catalogue"),
        ("add_dumbbells", "equipment"),
        ("overlong", "session_length"),
    ],
)
def test_constraint_checker_catches_each_violation(mutation: str, broken: str) -> None:
    data, fixture = planner_plan()
    inputs = fixture.inputs.plan_inputs()
    assert all(ps.check_constraints(TrainingPlan.model_validate(data), inputs, CATALOGUE).values())
    result = ps.check_constraints(
        TrainingPlan.model_validate(runner._mutate(data, mutation)), inputs, CATALOGUE
    )
    assert [c for c, ok in result.items() if not ok] == [broken]


def test_constraint_checker_catches_wrong_prescription() -> None:
    data, fixture = planner_plan()
    plank = next(
        ex for day in data["days"] for ex in day["exercises"] if ex["exercise_id"] == "plank"
    )
    plank.update(reps=10, duration_s=None)
    result = ps.check_constraints(
        TrainingPlan.model_validate(data), fixture.inputs.plan_inputs(), CATALOGUE
    )
    assert [c for c, ok in result.items() if not ok] == ["prescription"]


def test_properties_fill_and_equipment() -> None:
    data, fixture = planner_plan("p02")  # dumbbells owned and expected in use
    plan = TrainingPlan.model_validate(data)
    inputs = fixture.inputs.plan_inputs()
    assert ps.check_properties(plan, inputs, fixture.expect, CATALOGUE) == {
        "min_fill": True,
        "uses_equipment": True,
    }
    bodyweight_only = ps.Expectation(outcome="active", min_fill=1.0, uses_equipment=["dumbbells"])
    data["days"] = [
        {**d, "exercises": [ex for ex in d["exercises"] if "dumbbell" not in ex["exercise_id"]]}
        for d in data["days"]
    ]
    plan = TrainingPlan.model_validate(data)
    assert ps.check_properties(plan, inputs, bodyweight_only, CATALOGUE) == {
        "min_fill": False,
        "uses_equipment": False,
    }


# --- The offline run: scripted outcomes with known metrics.


def test_offline_run_scores_the_scripted_outcomes_exactly(offline: dict[str, Any]) -> None:
    a = offline["aggregate"]
    assert (a["attempted"], a["scored"], a["errors"]) == (20, 20, {})
    v = a["validity"]
    assert v["feasible_plans"] == 18  # 20 minus p12 (either) and p20 (needs_review)
    # p03 json_validate_failed→repaired, p06 drop_day→repaired, p07 add_dumbbells twice→escalated
    assert v["valid_first_try"] == {"n": 15, "of": 18, "rate": round(15 / 18, 4)}
    assert v["valid_after_repair"] == {"n": 17, "of": 18, "rate": round(17 / 18, 4)}
    assert v["schema_valid_first_try"]["n"] == 17  # only p03's first call didn't parse
    assert v["schema_valid_after_repair"]["n"] == 18
    assert v["repaired"]["n"] == 2
    assert v["first_issue_codes"] == {
        "days_count": 1,
        "equipment": 1,
        "generation_failed": 1,
        "session_length": 1,  # p20, every time
    }
    e = a["escalation"]
    assert e["expected_escalations"] == {"n": 1, "of": 1, "rate": 1.0}
    assert e["false_escalations"] == {"n": 1, "of": 18, "rate": round(1 / 18, 4)}
    assert e["either_outcomes"] == {"active": 1, "needs_review": 0}
    # 17 feasible + p12 accepted; the generator never accepts a broken plan
    assert a["constraints"]["all"] == {"n": 18, "of": 18, "rate": 1.0}
    assert a["rate_limited_429"] == 1  # p10's scripted 429, recovered in-request
    assert a["tokens"]["calls"] == 20 + 4  # p03, p06, p07, p20 each made a repair call
    assert a["per_fixture"]["p07_strength_beginner_no_equipment"] == {
        "valid_first_try": 0,
        "repaired": 0,
        "escalated": 1,
        "error": 0,
    }
    assert [f["fixture_id"][:3] for f in a["failures"]] == ["p07", "p03", "p06"]
    assert a["failures"][0]["final_issues"] == [
        "equipment: monday: dumbbell_row needs dumbbells, which the member doesn't have"
    ]
    assert offline["gate_failures"] == [
        "valid after repair 17/18 < 95%",
        "false escalations 1/18 > 5%",
    ]


def test_offline_run_is_deterministic(offline: dict[str, Any]) -> None:
    assert stable(runner.run_offline(SUITE)) == stable(offline)


def test_planner_without_scripts_passes_the_gate() -> None:
    client, scripted = runner.offline_client({})
    result = runner.run_suite(
        SUITE.profiles, client, CATALOGUE, start_fixture=scripted.start, sleep=lambda _s: None
    )
    agg = ps.aggregate(result.plans)
    assert agg["validity"]["valid_after_repair"]["rate"] == 1.0
    assert agg["escalation"]["expected_escalations"]["rate"] == 1.0
    assert ps.gate_failures(agg, SUITE.gate) == []


def test_gate_cannot_pass_vacuously() -> None:
    assert ps.gate_failures(ps.aggregate([]), SUITE.gate) == [
        "only 0 plans scored; the gate needs 20",
        "valid after repair 0/0 < 95%",
        "no escalation-expected plan was scored",
    ]


def test_an_accepted_plan_that_breaks_a_constraint_fails_the_gate_and_leads_the_failures() -> None:
    client, scripted = runner.offline_client({})
    runs = runner.run_suite(
        SUITE.profiles, client, CATALOGUE, start_fixture=scripted.start, sleep=lambda _s: None
    ).plans
    broken = ps.PlanRun(
        fixture_id="p01_general_beginner_home",
        expected="active",
        result="valid_first_try",
        constraints={**dict.fromkeys(ps.CONSTRAINTS, True), "equipment": False},
    )
    agg = ps.aggregate([*runs, broken])
    assert "accepted plans broke equipment: 19/20 adhered" in ps.gate_failures(agg, SUITE.gate)
    assert agg["failures"][0]["violated_constraints"] == ["equipment"]


def test_representative_failures_prefer_distinct_kinds() -> None:
    def repaired(n: int, code: str) -> ps.PlanRun:
        return ps.PlanRun(
            fixture_id=f"p{n:02d}_x",
            expected="active",
            result="repaired",
            first_issue_codes=(code,),
            constraints=dict.fromkeys(ps.CONSTRAINTS, True),
        )

    runs = [repaired(1, "generation_failed"), repaired(2, "generation_failed")]
    runs += [repaired(3, "generation_failed"), repaired(4, "duplicate_exercise")]
    assert [f["fixture_id"] for f in ps.representative_failures(runs)] == [
        "p01_x",
        "p04_x",
        "p02_x",
    ]


# --- Live-mode control flow, driven by a fake provider (no network).


def counted_client(
    *script: Any, responder: Any = None
) -> tuple[LLMClient, runner.CountingProvider]:
    counted = runner.CountingProvider(FakeProvider(script, responder=responder))
    client = LLMClient(
        counted,
        model="openai/gpt-oss-120b",
        budget=BudgetGuard(monthly_budget_usd=0.0, daily_token_budget=0),
        sleep=lambda _s: None,
    )
    return client, counted


FEASIBLE = [p for p in SUITE.profiles if p.expect.outcome == "active"][:3]


def test_daily_cap_stops_cleanly_with_partial_results() -> None:
    # plan 1 from the planner, then Groq's daily-cap 429 (long retry-after)
    replies = iter([fake_planner.respond])

    def respond(request: Any) -> Any:
        return next(replies, lambda _r: FakeReply.rate_limited(1800))(request)

    client, _ = counted_client(responder=respond)
    sleeps: list[float] = []
    result = runner.run_suite(FEASIBLE, client, CATALOGUE, sleep=sleeps.append)
    assert len(result.plans) == 1 and result.planned == 3
    assert result.stopped == "daily cap (rate_limited, retry-after 1800 s)"
    assert sleeps == []  # never waited on a daily cap


def test_short_429_is_waited_out_and_the_plan_retried() -> None:
    # 30 s > the client's 10 s in-request limit, so the runner waits and retries the plan
    client, _ = counted_client(FakeReply.rate_limited(30))
    sleeps: list[float] = []
    result = runner.run_suite(FEASIBLE[:1], client, CATALOGUE, sleep=sleeps.append)
    assert sleeps == [30.5]
    assert result.stopped is None
    assert result.plans[0].result == "valid_first_try" and result.plans[0].rate_limited == 1


def test_persistent_busy_becomes_an_error_not_a_plan() -> None:
    client, _ = counted_client(*[FakeReply.busy(5)] * (runner.MAX_BUSY_RETRIES + 1))
    result = runner.run_suite(FEASIBLE[:1], client, CATALOGUE, sleep=lambda _s: None)
    run = result.plans[0]
    assert (run.result, run.error) == ("error", "provider_busy")
    agg = ps.aggregate(result.plans)
    assert agg["scored"] == 0 and agg["errors"] == {"provider_busy": 1}


def test_auth_failure_stops_the_run() -> None:
    client, _ = counted_client(FakeReply.unavailable("auth"))
    result = runner.run_suite(FEASIBLE, client, CATALOGUE, sleep=lambda _s: None)
    assert result.stopped == "provider unavailable (auth)" and len(result.plans) == 1


def test_token_budget_stops_before_overspending() -> None:
    client, counted = counted_client()
    result = runner.run_suite(FEASIBLE, client, CATALOGUE, token_budget=1, sleep=lambda _s: None)
    assert result.plans == [] and result.stopped is not None
    assert "token budget" in result.stopped and counted.tokens == 0


def test_pacer_waits_for_the_minute_window_and_stops_on_the_request_cap() -> None:
    import httpx

    sleeps: list[float] = []
    recorder = runner.HeaderRecorder(httpx.MockTransport(lambda _r: httpx.Response(200)))
    pacer = runner.Pacer(recorder, sleep=sleeps.append)
    recorder.headers = {"x-ratelimit-remaining-tokens": "1200", "x-ratelimit-reset-tokens": "7.5s"}
    assert pacer() is None and sleeps == [8.0]
    recorder.headers = {"x-ratelimit-remaining-tokens": "7000", "x-ratelimit-reset-tokens": "1s"}
    assert pacer() is None and sleeps == [8.0]
    recorder.headers = {"x-ratelimit-remaining-requests": "1"}
    assert pacer() == "daily request cap (x-ratelimit-remaining-requests)"


@pytest.mark.parametrize(
    ("value", "seconds"), [("7.66s", 7.66), ("2m59.5s", 179.5), ("120ms", 0.12), ("1h", 3600)]
)
def test_parse_duration(value: str, seconds: float) -> None:
    assert runner.parse_duration(value) == pytest.approx(seconds)


def test_header_recorder_keeps_only_rate_limit_headers() -> None:
    import httpx

    transport = runner.HeaderRecorder(
        httpx.MockTransport(
            lambda _r: httpx.Response(
                200, headers={"x-ratelimit-remaining-tokens": "10", "set-cookie": "s=1"}
            )
        )
    )
    httpx.Client(transport=transport).get("https://example.test/")
    assert transport.headers == {"x-ratelimit-remaining-tokens": "10"}


def test_live_mode_refuses_to_run_in_ci(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CI", "true")
    assert runner.main(["--mode", "live"]) == 2


# --- Report files.


def test_report_merges_runs_keeps_notes_and_drops_stale_hashes(
    tmp_path: Path, offline: dict[str, Any]
) -> None:
    md = tmp_path / "plans-plan-v1.md"
    kwargs: dict[str, Any] = {
        "prompt_version": "plan-v1",
        "prompt_sha256": "a" * 64,
        "suite_version": 1,
        "suite_profiles": 20,
        "gate": SUITE.gate.model_dump(),
    }
    live_low = {**offline, "mode": "live", "model": "m", "reasoning_effort": "low"}
    live_med = {**live_low, "reasoning_effort": "medium"}
    rep.write_report(md, live_low, **kwargs)
    md.write_text(
        md.read_text().replace(rep.NOTES_BEGIN + "\n", rep.NOTES_BEGIN + "\nLow effort wins.\n")
    )
    rep.write_report(md, live_med, **kwargs)
    report = rep.write_report(md, live_low, **kwargs)  # rerun replaces, doesn't duplicate
    assert [r["reasoning_effort"] for r in report["runs"]] == ["low", "medium"]
    text = md.read_text()
    assert "Low effort wins." in text and f"- prompt_sha256: `{'a' * 64}`" in text

    report = rep.write_report(md, live_med, **{**kwargs, "prompt_sha256": "b" * 64})
    assert [r["reasoning_effort"] for r in report["runs"]] == ["medium"]


def test_offline_cli_writes_a_report(tmp_path: Path) -> None:
    out = tmp_path / "offline.md"
    assert runner.main(["--mode", "offline", "--out", str(out)]) == 1  # scripted gate failures
    data = json.loads(out.with_suffix(".json").read_text())
    assert data["prompt_sha256"] == prompts.prompt_sha256()
    assert data["runs"][0]["mode"] == "offline"
    assert "| offline (fake provider, scripted) | 20/20 |" in out.read_text()


# --- CI guard: prompt files ⇒ a live report recording their hash.


def test_prompt_files_have_a_live_eval_report_recording_their_hash() -> None:
    """Edit a prompt file and this fails until the eval is rerun for it. The fix is to copy the
    files to a new version, bump PROMPT_VERSION, and run `make eval-ai` (commits
    docs/evaluation/plans-<version>.{md,json})."""
    version, sha = prompts.PROMPT_VERSION, prompts.prompt_sha256()
    md = runner.default_report_path(version)
    hint = (
        f"prompt {version} (sha256 {sha[:12]}…) has no matching live eval report at "
        f"{md.relative_to(ps.REPO_ROOT)}: bump PROMPT_VERSION for any prompt edit and run "
        "`make eval-ai`"
    )
    assert md.exists() and md.with_suffix(".json").exists(), hint
    report = json.loads(md.with_suffix(".json").read_text())
    assert report["prompt_version"] == version, hint
    assert report["prompt_sha256"] == sha, hint
    assert f"- prompt_sha256: `{sha}`" in md.read_text(), hint
    live = [r for r in report["runs"] if r["mode"] == "live" and r["prompt_sha256"] == sha]
    assert live, hint
