"""Plan-generation eval runner + CLI (FR-02, FR-13, blueprint §10, ADR-0004, ADR-0006).

    # offline: fake provider + scripted replies, deterministic, no network (also run by pytest)
    uv run python -m app.services.evaluation.plans --mode offline
    # live: Groq, paced from the rate-limit headers; `make eval-ai` from the repo root
    # writes docs/evaluation/plans-<PROMPT_VERSION>.{md,json} unless --out says otherwise
    uv run python -m app.services.evaluation.plans --mode live --effort low --runs 2 \
        --env-file ../../.env

Every plan goes through the real `generate_plan` (generate → validate → repair once → escalate)
and is scored by plan_suite.py. Live mode:
- sleeps until the per-minute token window resets when fewer than `min_tokens_free` remain
  (`x-ratelimit-remaining-tokens` / `x-ratelimit-reset-tokens`);
- waits out a short 429 and retries the plan (at most `MAX_BUSY_RETRIES` times);
- stops cleanly, keeping what it has, on a daily cap (429 with a long `retry-after`), on the run's
  `--token-budget`, on an auth/config failure, or on Ctrl-C. The report says so.
Never runs in CI (refuses when `CI` is set; tests force the fake provider).
"""

import argparse
import json
import logging
import os
import sys
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from app.core.config import Settings
from app.schemas.exercise import ExerciseContract
from app.services.catalog import load_catalog
from app.services.evaluation import plan_suite as ps
from app.services.evaluation import report as rep
from app.services.llm import (
    BudgetGuard,
    CompletionRequest,
    FakeProvider,
    FakeReply,
    LLMBusy,
    LLMClient,
    LLMUnavailable,
    ProviderResponse,
    build_client,
)
from app.services.llm.providers import OpenAICompatibleProvider, Provider
from app.services.plans import fake_planner, prompts
from app.services.plans.generator import generate_plan

# A 429 whose retry-after exceeds this is a daily cap (Groq TPD/RPD): stop, don't wait.
DAILY_CAP_RETRY_AFTER_S = 120.0
MAX_BUSY_RETRIES = 3
DEFAULT_TOKEN_BUDGET = 150_000
# Assumed tokens for the next plan before any has been measured (ADR-0006: ~2.4K at low effort).
INITIAL_PLAN_TOKENS_ESTIMATE = 3_000
# Stop when the minute window holds fewer free tokens than this: a plan plus its repair ~5K.
MIN_TOKENS_FREE = 5_000
# Unrecoverable for this run: retrying can't help.
FATAL_UNAVAILABLE = frozenset({"auth", "not_configured", "unpriced_model", "budget_refused"})
OFFLINE_MODEL = "offline-scripted"
DOCS_DIR = ps.REPO_ROOT / "docs" / "evaluation"


def default_report_path(prompt_version: str = prompts.PROMPT_VERSION) -> Path:
    return DOCS_DIR / f"plans-{prompt_version}.md"


# --- Providers.


class CountingProvider:
    """Wraps any provider; counts 429s and every token the provider reported, including calls
    whose plan was later abandoned (a repair that hit a 429), so budgets see real usage."""

    def __init__(self, inner: Provider) -> None:
        self.inner = inner
        self.name = inner.name
        self.rate_limited = 0
        self.tokens = 0

    def complete(self, request: CompletionRequest) -> ProviderResponse:
        response = self.inner.complete(request)
        if response.outcome == "rate_limited":
            self.rate_limited += 1
        self.tokens += response.usage.prompt_tokens + response.usage.completion_tokens
        return response


def _mutate(plan: dict[str, Any], how: str) -> dict[str, Any]:
    first = plan["days"][0]["exercises"][0]
    if how == "drop_day":
        plan["days"] = plan["days"][:-1]
    elif how == "unknown_exercise":
        first["exercise_id"] = "dragon_flag"
    elif how == "add_dumbbells":
        first.update(exercise_id="dumbbell_row", reps=10, duration_s=None)
    elif how == "overlong":
        for day in plan["days"]:
            for ex in day["exercises"]:
                ex.update(sets=6, rest_s=240)
    return plan


def scripted_reply(spec: ps.ReplySpec, request: CompletionRequest) -> ProviderResponse:
    if spec.kind == "json_validate_failed":
        return FakeReply.json_validate_failed()
    if spec.kind == "rate_limited":
        return FakeReply.rate_limited(spec.retry_after_s)
    if spec.kind == "busy":
        return FakeReply.busy(spec.retry_after_s)
    if spec.kind == "unavailable":
        return FakeReply.unavailable()
    reply = fake_planner.respond(request)
    if spec.mutate is None or reply.content is None:
        return reply
    result: ProviderResponse = FakeReply.ok(_mutate(json.loads(reply.content), spec.mutate))
    return result


class ScriptedProvider:
    """Offline provider: per profile, the scripted replies for one generate_plan call, then the
    rule-based planner. `start(fixture_id)` loads the script before each plan."""

    name = "fake"

    def __init__(self, replies: Mapping[str, Sequence[ps.ReplySpec]]) -> None:
        self._replies = replies
        self._queue: list[ps.ReplySpec] = []
        self._fake = FakeProvider(responder=self._respond)

    def start(self, fixture_id: str) -> None:
        self._queue = list(self._replies.get(fixture_id, ()))

    def complete(self, request: CompletionRequest) -> ProviderResponse:
        return self._fake.complete(request)

    def _respond(self, request: CompletionRequest) -> ProviderResponse:
        spec = self._queue.pop(0) if self._queue else ps.ReplySpec(kind="planner")
        return scripted_reply(spec, request)


class HeaderRecorder(httpx.BaseTransport):
    """Keeps the last response's rate-limit headers (never the body or the request)."""

    def __init__(self, inner: httpx.BaseTransport) -> None:
        self.inner = inner
        self.headers: dict[str, str] = {}

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        response = self.inner.handle_request(request)
        self.headers = {
            k: v for k, v in response.headers.items() if k.lower().startswith("x-ratelimit-")
        }
        return response

    def close(self) -> None:
        self.inner.close()


def parse_duration(value: str) -> float:
    """Groq reset headers look like '7.66s', '2m59.56s' or '120ms'."""
    total, num, i = 0.0, "", 0
    while i < len(value):
        c = value[i]
        if c.isdigit() or c == ".":
            num += c
        elif value.startswith("ms", i):
            total += float(num or 0) / 1000
            num, i = "", i + 1
        elif c in "hms":
            total += float(num or 0) * {"h": 3600, "m": 60, "s": 1}[c]
            num = ""
        i += 1
    return total + (float(num) if num else 0.0)


@dataclass
class Pacer:
    """Before each plan: wait for the minute token window, stop on the daily request cap."""

    recorder: HeaderRecorder
    sleep: Callable[[float], None] = time.sleep
    min_tokens_free: int = MIN_TOKENS_FREE
    waited_s: float = 0.0
    limits_seen: dict[str, str] = field(default_factory=dict)

    def __call__(self) -> str | None:
        h = self.recorder.headers
        for k in ("x-ratelimit-limit-requests", "x-ratelimit-limit-tokens"):
            if k in h:
                self.limits_seen[k] = h[k]
        requests_left = h.get("x-ratelimit-remaining-requests")
        if requests_left is not None and int(requests_left) < 2:
            return "daily request cap (x-ratelimit-remaining-requests)"
        remaining, reset = h.get("x-ratelimit-remaining-tokens"), h.get("x-ratelimit-reset-tokens")
        if remaining is not None and reset is not None and int(remaining) < self.min_tokens_free:
            wait = parse_duration(reset) + 0.5
            self.waited_s += wait
            self.sleep(wait)
        return None


def offline_client(replies: Mapping[str, Sequence[ps.ReplySpec]]) -> tuple[LLMClient, Any]:
    scripted = ScriptedProvider(replies)
    counted = CountingProvider(scripted)
    client = LLMClient(
        counted,
        model=OFFLINE_MODEL,
        budget=BudgetGuard(monthly_budget_usd=0.0, daily_token_budget=0),
        sleep=lambda _s: None,
    )
    return client, scripted


def live_client(env_file: Path | None, model: str, effort: str) -> tuple[LLMClient, HeaderRecorder]:
    overrides: dict[str, Any] = {
        "llm_provider": "groq",
        "llm_model": model,
        "llm_reasoning_effort": effort,
        "llm_daily_token_budget": 0,  # the runner's --token-budget applies instead
    }
    settings = Settings(_env_file=env_file, **overrides) if env_file else Settings(**overrides)
    if not settings.groq_api_key:
        raise SystemExit("GROQ_API_KEY is not set (pass --env-file with the root .env)")
    recorder = HeaderRecorder(httpx.HTTPTransport())
    provider = OpenAICompatibleProvider(
        "groq",
        settings.groq_base_url,
        settings.groq_api_key,
        timeout_s=settings.llm_timeout_s,
        groq_extensions=True,
        transport=recorder,
    )
    return build_client(settings, provider=CountingProvider(provider)), recorder


# --- Running the suite.


@dataclass
class SuiteRun:
    plans: list[ps.PlanRun]
    planned: int
    stopped: str | None


def run_suite(
    fixtures: Sequence[ps.PlanFixture],
    client: LLMClient,
    catalogue: Mapping[str, ExerciseContract],
    *,
    runs: int = 1,
    before_plan: Callable[[], str | None] = lambda: None,
    start_fixture: Callable[[str], None] = lambda _id: None,
    sleep: Callable[[float], None] = time.sleep,
    token_budget: int = 0,
    progress: Callable[[int, int, ps.PlanRun], None] = lambda _i, _n, _r: None,
) -> SuiteRun:
    """Round-robin over the fixtures `runs` times, so a run cut short still covers every profile
    it can. `client.provider` must be a CountingProvider."""
    counter = client.provider
    assert isinstance(counter, CountingProvider)
    order = [f for _ in range(runs) for f in fixtures]
    plans: list[ps.PlanRun] = []
    stopped: str | None = None
    try:
        for fixture in order:
            if token_budget:
                measured = [p.tokens_in + p.tokens_out for p in plans if p.result != "error"]
                estimate = (
                    max(measured) if measured else INITIAL_PLAN_TOKENS_ESTIMATE
                )  # worst plan so far: a repair costs double
                if counter.tokens + estimate > token_budget:
                    stopped = f"run token budget {token_budget} reached ({counter.tokens} used)"
                    break
            stopped = before_plan()
            if stopped:
                break
            run, stopped = _one_plan(fixture, client, catalogue, counter, start_fixture, sleep)
            if run is not None:
                plans.append(run)
                progress(len(plans), len(order), run)
            if stopped:
                break
    except KeyboardInterrupt:
        stopped = "interrupted"
    return SuiteRun(plans, len(order), stopped)


def _one_plan(
    fixture: ps.PlanFixture,
    client: LLMClient,
    catalogue: Mapping[str, ExerciseContract],
    counter: CountingProvider,
    start_fixture: Callable[[str], None],
    sleep: Callable[[float], None],
) -> tuple[ps.PlanRun | None, str | None]:
    """(scored run or None, stop reason or None)."""
    before = counter.rate_limited
    for attempt in range(MAX_BUSY_RETRIES + 1):
        start_fixture(fixture.id)
        try:
            draft = generate_plan(fixture.inputs.plan_inputs(), catalogue, client)
        except LLMBusy as e:
            wait = e.retry_after_s
            if e.reason == "daily_token_budget" or (
                wait is not None and wait > DAILY_CAP_RETRY_AFTER_S
            ):
                # not this profile's fault: leave it unscored rather than call it an error
                return None, f"daily cap ({e.reason}, retry-after {wait:.0f} s)" if wait else (
                    f"daily cap ({e.reason})"
                )
            if attempt == MAX_BUSY_RETRIES:
                return ps.failed_run(
                    fixture, e.reason, rate_limited=counter.rate_limited - before
                ), None
            sleep((wait if wait is not None else 5.0) + 0.5)
            continue
        except LLMUnavailable as e:
            run = ps.failed_run(fixture, e.reason, rate_limited=counter.rate_limited - before)
            return run, (
                f"provider unavailable ({e.reason})" if e.reason in FATAL_UNAVAILABLE else None
            )
        return ps.score_draft(
            fixture, draft, catalogue, rate_limited=counter.rate_limited - before
        ), None
    raise AssertionError("unreachable")


def summarise(
    suite_run: SuiteRun,
    fixtures: Sequence[ps.PlanFixture],
    gate: ps.Gate,
    *,
    mode: str,
    provider: str,
    model: str,
    effort: str,
    runs: int,
    started_at: str,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    agg = ps.aggregate(suite_run.plans)
    return {
        "mode": mode,
        "provider": provider,
        "model": model,
        "reasoning_effort": effort,
        "prompt_sha256": prompts.prompt_sha256(),
        "started_at": started_at,
        "finished_at": _now(),
        "runs_per_fixture": runs,
        "planned": suite_run.planned,
        "stopped": suite_run.stopped,
        "expected": {f.id: f.expect.outcome for f in fixtures},
        "aggregate": agg,
        "gate_failures": ps.gate_failures(agg, gate),
        **(extra or {}),
    }


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def select(fixtures: Iterable[ps.PlanFixture], only: str | None) -> list[ps.PlanFixture]:
    if not only:
        return list(fixtures)
    prefixes = [p.strip() for p in only.split(",") if p.strip()]
    chosen = [f for f in fixtures if any(f.id.startswith(p) for p in prefixes)]
    if not chosen:
        raise SystemExit(f"--only {only!r} matches no profile")
    return chosen


def run_offline(suite: ps.Suite, *, runs: int = 1, only: str | None = None) -> dict[str, Any]:
    """The deterministic offline run (pytest calls this)."""
    fixtures = select(suite.profiles, only)
    replies = ps.load_offline_replies(suite).replies
    client, scripted = offline_client(replies)
    started = _now()
    suite_run = run_suite(
        fixtures,
        client,
        load_catalog(),
        runs=runs,
        start_fixture=scripted.start,
        sleep=lambda _s: None,
    )
    return summarise(
        suite_run,
        fixtures,
        suite.gate,
        mode="offline",
        provider="fake",
        model=OFFLINE_MODEL,
        effort="n/a",
        runs=runs,
        started_at=started,
    )


def _print_progress(i: int, n: int, run: ps.PlanRun) -> None:
    detail = run.error or ",".join(run.first_issue_codes) or "-"
    print(
        f"[{i}/{n}] {run.fixture_id}: {run.result} ({detail}) {run.latency_ms / 1000:.1f}s "
        f"{run.tokens_in + run.tokens_out} tok 429s={run.rate_limited}",
        flush=True,
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.services.evaluation.plans")
    parser.add_argument("--mode", choices=("offline", "live"), required=True)
    parser.add_argument("--model", default="openai/gpt-oss-120b")
    parser.add_argument("--effort", choices=("low", "medium", "high"), default="low")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--only", help="comma-separated profile id prefixes, e.g. p01,p06")
    parser.add_argument("--out", type=Path, help="report .md (a .json beside it holds aggregates)")
    parser.add_argument("--fresh", action="store_true", help="discard runs already in the report")
    parser.add_argument("--env-file", type=Path, help="live: env file holding GROQ_API_KEY")
    parser.add_argument("--token-budget", type=int, default=DEFAULT_TOKEN_BUDGET)
    parser.add_argument("--suite", type=Path, default=ps.SUITE_PATH)
    args = parser.parse_args(argv)
    if args.runs < 1:
        parser.error("--runs must be at least 1")

    suite = ps.load_suite(args.suite)
    if args.mode == "offline":
        run = run_offline(suite, runs=args.runs, only=args.only)
    else:
        if os.environ.get("CI"):
            print("refusing live mode in CI (ADR-0006 §5): CI never calls a live model")
            return 2
        fixtures = select(suite.profiles, args.only)
        client, recorder = live_client(args.env_file, args.model, args.effort)
        pacer = Pacer(recorder)
        started = _now()
        suite_run = run_suite(
            fixtures,
            client,
            load_catalog(),
            runs=args.runs,
            before_plan=pacer,
            token_budget=args.token_budget,
            progress=_print_progress,
        )
        assert isinstance(client.provider, CountingProvider)
        run = summarise(
            suite_run,
            fixtures,
            suite.gate,
            mode="live",
            provider=client.provider_name,
            model=args.model,
            effort=args.effort,
            runs=args.runs,
            started_at=started,
            extra={
                "tokens_used_incl_abandoned": client.provider.tokens,
                "pacer_waited_s": round(pacer.waited_s, 1),
                "rate_limits_seen": pacer.limits_seen,
            },
        )

    out: Path | None = args.out
    if out is None and args.mode == "live":
        out = default_report_path()  # a live run is always recorded (the CI guard reads it)
    if out:
        rep.write_report(
            out,
            run,
            prompt_version=prompts.PROMPT_VERSION,
            prompt_sha256=prompts.prompt_sha256(),
            suite_version=suite.suite_version,
            suite_profiles=len(suite.profiles),
            gate=suite.gate.model_dump(),
            fresh=args.fresh,
        )
        print(f"wrote {out} and {out.with_suffix('.json').name}")
    agg = run["aggregate"]
    print(
        f"{rep.run_label(run)}: scored {agg['scored']}/{run['planned']}, valid first try "
        f"{agg['validity']['valid_first_try']['rate']}, after repair "
        f"{agg['validity']['valid_after_repair']['rate']}, 429s {agg['rate_limited_429']}"
    )
    if run["stopped"]:
        print(f"stopped early: {run['stopped']} (partial results)")
    for failure in run["gate_failures"]:
        print(f"gate: {failure}")
    return 1 if run["gate_failures"] or run["stopped"] else 0


if __name__ == "__main__":
    # the per-plan progress line replaces the llm.call events on the console
    logging.getLogger("fitpilot.llm").setLevel(logging.ERROR)
    sys.exit(main())
