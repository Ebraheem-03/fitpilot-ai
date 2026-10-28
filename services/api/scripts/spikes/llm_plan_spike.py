"""M3 S0 throwaway spike: can Groq's free gpt-oss models produce valid TrainingPlans?

NOT production code (that is M3 S4, `app/services/llm` + `app/services/plans`). Not part of the
test suite. Synthetic profiles only, no PII. Calls the live Groq API, so run it by hand:

    cd services/api
    uv run python scripts/spikes/llm_plan_spike.py --env-file /path/to/repo/.env --out /tmp/spike

It writes one JSON line per (model, profile, run) to `<out>/calls.jsonl` (including the raw
plan JSON, which is synthetic; keep it out of git) and an aggregate
markdown report to `<out>/report.md`. The API key is read through `app.core.config.Settings`
and is never printed or written.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

API_ROOT = Path(__file__).resolve().parents[2]
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
PROMPT_VERSION = "plan-spike-v1"
MODELS = ("openai/gpt-oss-120b", "openai/gpt-oss-20b")

# --- Hypothetical S1 catalogue (owner decision 2026-10-28). Only id + equipment + prescription
# type matter for the spike; the real entries land in data/exercise-catalog in S1.

Prescription = Literal["reps", "duration"]


@dataclass(frozen=True)
class CatalogueEntry:
    id: str
    name: str
    equipment: tuple[str, ...]
    prescription: Prescription
    pattern: str


CATALOGUE: tuple[CatalogueEntry, ...] = (
    CatalogueEntry("bodyweight_squat", "Bodyweight Squat", (), "reps", "lower body, knee"),
    CatalogueEntry(
        "dumbbell_biceps_curl", "Dumbbell Biceps Curl", ("dumbbells",), "reps", "upper body, pull"
    ),
    CatalogueEntry("push_up", "Push-up", (), "reps", "upper body, push"),
    CatalogueEntry("glute_bridge", "Glute Bridge", (), "reps", "lower body, hip"),
    CatalogueEntry("plank", "Plank", (), "duration", "core, anti-extension"),
    CatalogueEntry("reverse_lunge", "Reverse Lunge", (), "reps", "lower body, single leg"),
    CatalogueEntry("dumbbell_row", "Dumbbell Row", ("dumbbells",), "reps", "upper body, pull"),
)
CATALOGUE_BY_ID = {e.id: e for e in CATALOGUE}

# --- Draft TrainingPlan schema (the shape S1 turns into a zod contract).


class DayOfWeek(StrEnum):
    monday = "monday"
    tuesday = "tuesday"
    wednesday = "wednesday"
    thursday = "thursday"
    friday = "friday"
    saturday = "saturday"
    sunday = "sunday"


ExerciseId = StrEnum("ExerciseId", {e.id: e.id for e in CATALOGUE})  # type: ignore[misc]


class PlannedExercise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exercise_id: ExerciseId  # type: ignore[valid-type]
    sets: int = Field(ge=1, le=6)
    reps: int | None = Field(ge=1, le=30)
    duration_s: int | None = Field(ge=10, le=180)
    rest_s: int = Field(ge=15, le=240)
    progression: str = Field(min_length=1, max_length=200)


class TrainingDay(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day_of_week: DayOfWeek
    focus: str = Field(min_length=1, max_length=80)
    exercises: list[PlannedExercise] = Field(min_length=1, max_length=8)


class TrainingPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    days: list[TrainingDay] = Field(min_length=1, max_length=7)
    rationale: str = Field(min_length=1, max_length=600)


# Groq strict mode: every property required, additionalProperties false on every object, a
# documented JSON-schema subset. Keep min/max (shown in Groq's examples); strip the rest, which
# Pydantic still enforces after the call.
_STRIP = {"title", "default", "minLength", "maxLength", "minItems", "maxItems"}


def _to_wire(node: Any) -> Any:
    if isinstance(node, dict):
        out = {k: _to_wire(v) for k, v in node.items() if k not in _STRIP}
        if out.get("type") == "object" and "properties" in out:
            out["additionalProperties"] = False
            out["required"] = list(out["properties"].keys())
        return out
    if isinstance(node, list):
        return [_to_wire(v) for v in node]
    return node


WIRE_SCHEMA: dict[str, Any] = _to_wire(TrainingPlan.model_json_schema())

# --- Synthetic profiles (no PII). Fields are exactly the authorized ProfileOut inputs.


@dataclass(frozen=True)
class Profile:
    key: str
    primary_goal: str
    experience_level: str
    days_per_week: int | None
    session_minutes: int | None
    equipment: tuple[str, ...]
    note: str


PROFILES: tuple[Profile, ...] = (
    Profile("p01", "general_fitness", "beginner", 3, 30, (), "baseline beginner"),
    Profile("p02", "fat_loss", "beginner", 4, 45, ("dumbbells",), "dumbbells"),
    Profile("p03", "muscle_gain", "intermediate", 5, 60, ("dumbbells",), "5-day hypertrophy"),
    Profile("p04", "strength", "advanced", 6, 75, ("dumbbells",), "6 days, max frequency"),
    Profile("p05", "mobility", "beginner", 2, 20, (), "short mobility"),
    Profile("p06", "strength", "intermediate", 1, 90, (), "edge: 1 day/week, long session"),
    Profile("p07", "general_fitness", "beginner", 6, 10, (), "edge: 10-min minimum, 6 days"),
    Profile(
        "p08", "muscle_gain", "advanced", 4, 180, ("dumbbells", "bench", "mat"), "edge: 180-min max"
    ),
    Profile(
        "p09",
        "fat_loss",
        "intermediate",
        3,
        40,
        ("kettlebell", "resistance_band"),
        "edge: equipment the catalogue doesn't use => bodyweight only",
    ),
    Profile(
        "p10", "muscle_gain", "beginner", 5, 25, (), "edge: muscle gain with no equipment, short"
    ),
    Profile("p11", "general_fitness", "beginner", None, None, ("mat",), "edge: unset days/minutes"),
    Profile("p12", "general_fitness", "intermediate", 6, 15, ("dumbbells",), "edge: 6 x 15 min"),
)

# Deterministic backend defaults when the member left the schedule unset (S4 should own these).
DEFAULT_DAYS, DEFAULT_MINUTES = 3, 45


def effective(p: Profile) -> tuple[int, int]:
    return (p.days_per_week or DEFAULT_DAYS, p.session_minutes or DEFAULT_MINUTES)


# --- Duration estimate (deterministic, also given to the model).
WARMUP_MIN = 5
SECONDS_PER_REP = 3


def estimate_minutes(day: TrainingDay) -> float:
    total_s = 0
    for ex in day.exercises:
        work_s = (ex.reps or 0) * SECONDS_PER_REP if ex.reps is not None else ex.duration_s or 0
        total_s += ex.sets * (work_s + ex.rest_s)
    return WARMUP_MIN + total_s / 60


# --- Prompt (S4 moves this into services/plans/prompts/<version>.md).


def system_prompt() -> str:
    rows = "\n".join(
        f"| {e.id} | {e.name} | {', '.join(e.equipment) or 'none'} "
        f"| {e.prescription} | {e.pattern} |"
        for e in CATALOGUE
    )
    return f"""You generate weekly workout plans for FitPilot. Reply with one TrainingPlan JSON \
object and nothing else.

Approved exercise catalogue (the ONLY exercises you may use):

| exercise_id | name | required equipment | prescription | pattern |
|---|---|---|---|---|
{rows}

Hard rules (a plan that breaks any of them is rejected):
1. Use only exercise_id values from the catalogue.
2. Use an exercise only if every item in its "required equipment" is in the member's equipment \
list. "none" means bodyweight, always allowed. Equipment the catalogue doesn't use gives no \
extra exercises.
3. `days` has exactly days_per_week entries, each with a different day_of_week. Spread them \
across the week.
4. prescription "reps": set reps (1-30) and duration_s null. prescription "duration": set \
duration_s (10-180) and reps null.
5. sets 1-6, rest_s 15-240. Each day has 1-8 exercises and uses an exercise at most once.
6. Session length. For each day: estimated_minutes = {WARMUP_MIN} + sum over exercises of \
sets * (work_s + rest_s) / 60, where work_s = {SECONDS_PER_REP} * reps, or duration_s. \
estimated_minutes MUST be <= session_minutes. Aim for 60-100% of session_minutes. Do the \
arithmetic before answering.
7. `progression`: one short sentence on how to progress this exercise week to week.
8. `rationale`: at most 3 sentences on how the plan fits the goal, experience and schedule. No \
medical claims, no diagnosis, no injury advice.
"""


def user_prompt(p: Profile) -> str:
    days, minutes = effective(p)
    profile = {
        "primary_goal": p.primary_goal,
        "experience_level": p.experience_level,
        "days_per_week": days,
        "session_minutes": minutes,
        "equipment": list(p.equipment),
    }
    return "Member profile:\n" + json.dumps(profile, indent=2)


# --- Validation (schema -> domain). Returns a list of human-readable errors (empty == valid).


def validate(raw: str, p: Profile) -> tuple[list[str], list[str], dict[str, Any]]:
    """Return (errors, categories, stats)."""
    errors: list[str] = []
    cats: list[str] = []
    stats: dict[str, Any] = {}
    try:
        plan = TrainingPlan.model_validate_json(raw)
    except ValidationError as exc:
        for err in exc.errors():
            loc = ".".join(str(x) for x in err["loc"])
            errors.append(f"schema: {loc}: {err['msg']}")
        return errors, ["schema"], stats

    days, minutes = effective(p)
    owned = set(p.equipment)
    if len(plan.days) != days:
        errors.append(f"days: plan has {len(plan.days)} training days, days_per_week is {days}")
        cats.append("days_count")
    seen_days = [d.day_of_week for d in plan.days]
    if len(set(seen_days)) != len(seen_days):
        errors.append("days: day_of_week values must be distinct")
        cats.append("days_distinct")
    estimates: list[float] = []
    for d in plan.days:
        dn = d.day_of_week.value
        ids = [ex.exercise_id.value for ex in d.exercises]
        if len(set(ids)) != len(ids):
            errors.append(f"{dn}: an exercise appears more than once")
            cats.append("duplicate_exercise")
        for ex in d.exercises:
            entry = CATALOGUE_BY_ID.get(ex.exercise_id.value)
            if entry is None:  # unreachable with the enum, kept as defence in depth
                errors.append(f"{dn}: {ex.exercise_id} is not in the catalogue")
                cats.append("catalogue")
                continue
            missing = [e for e in entry.equipment if e not in owned]
            if missing:
                errors.append(
                    f"{dn}: {entry.id} needs {', '.join(missing)}, which the member doesn't have"
                )
                cats.append("equipment")
            if entry.prescription == "reps" and (ex.reps is None or ex.duration_s is not None):
                errors.append(f"{dn}: {entry.id} is reps-based: set reps, duration_s null")
                cats.append("prescription")
            if entry.prescription == "duration" and (ex.duration_s is None or ex.reps is not None):
                errors.append(f"{dn}: {entry.id} is duration-based: set duration_s, reps null")
                cats.append("prescription")
        est = estimate_minutes(d)
        estimates.append(est)
        if est > minutes:
            errors.append(
                f"{dn}: estimated {est:.1f} min exceeds session_minutes {minutes} "
                f"(5 + sum of sets*(work_s+rest_s)/60)"
            )
            cats.append("duration")
    stats["fill_ratio_min"] = min(estimates) / minutes if estimates else None
    stats["underfilled"] = any(e < 0.5 * minutes for e in estimates)
    stats["exercises_per_day"] = [len(d.exercises) for d in plan.days]
    return errors, sorted(set(cats)), stats


# --- Groq client with pacing + 429 backoff (one thread per model; limits are per model).


@dataclass
class CallResult:
    ok: bool
    content: str | None
    latency_s: float
    usage: dict[str, Any]
    finish_reason: str | None
    http_status: int
    error: str | None
    rate_limited: int  # 429s hit before this result


@dataclass
class Pacer:
    min_tokens_free: int
    limits_seen: dict[str, str] = field(default_factory=dict)

    def after(self, headers: httpx.Headers) -> None:
        for k in (
            "x-ratelimit-limit-requests",
            "x-ratelimit-limit-tokens",
        ):
            if k in headers:
                self.limits_seen[k] = headers[k]
        remaining = headers.get("x-ratelimit-remaining-tokens")
        reset = headers.get("x-ratelimit-reset-tokens")
        if remaining is not None and reset is not None and int(remaining) < self.min_tokens_free:
            time.sleep(_parse_duration(reset) + 0.5)


def _parse_duration(value: str) -> float:
    """Groq reset headers look like '7.66s', '2m59.56s' or '120ms'."""
    total, num = 0.0, ""
    i = 0
    while i < len(value):
        c = value[i]
        if c.isdigit() or c == ".":
            num += c
        elif value.startswith("ms", i):
            total += float(num) / 1000
            num = ""
            i += 1
        elif c in "hms":
            total += float(num) * {"h": 3600, "m": 60, "s": 1}[c]
            num = ""
        i += 1
    return total + (float(num) if num else 0.0)


def call_groq(
    client: httpx.Client,
    key: str,
    model: str,
    messages: list[dict[str, str]],
    pacer: Pacer,
    reasoning_effort: str,
    max_tokens: int,
) -> CallResult:
    body = {
        "model": model,
        "messages": messages,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "training_plan", "strict": True, "schema": WIRE_SCHEMA},
        },
        "reasoning_effort": reasoning_effort,
        "include_reasoning": False,
        "max_completion_tokens": max_tokens,
    }
    rate_limited = 0
    for attempt in range(8):
        t0 = time.perf_counter()
        resp = client.post(GROQ_URL, json=body, headers={"Authorization": f"Bearer {key}"})
        latency = time.perf_counter() - t0
        if resp.status_code == 429:
            rate_limited += 1
            wait = float(resp.headers.get("retry-after", 2 ** min(attempt + 1, 6)))
            if wait > 120:  # daily cap (RPD/TPD): don't hang, record it
                msg = f"429 with retry-after {wait:.0f}s (daily limit)"
                return CallResult(False, None, latency, {}, None, 429, msg, rate_limited)
            time.sleep(wait + 0.5)
            continue
        pacer.after(resp.headers)
        if resp.status_code != 200:
            try:
                err = resp.json().get("error", {})
                msg = f"{err.get('code') or err.get('type')}: {err.get('message', '')[:300]}"
            except ValueError:
                msg = resp.text[:300]
            return CallResult(False, None, latency, {}, None, resp.status_code, msg, rate_limited)
        data = resp.json()
        choice = data["choices"][0]
        return CallResult(
            True,
            choice["message"].get("content"),
            latency,
            data.get("usage", {}),
            choice.get("finish_reason"),
            200,
            None,
            rate_limited,
        )
    return CallResult(False, None, 0.0, {}, None, 429, "gave up after 8 x 429", rate_limited)


def repair_message(errors: list[str]) -> str:
    joined = "\n".join(f"- {e}" for e in errors[:20])
    return (
        "The plan was rejected by validation:\n"
        f"{joined}\n"
        "Return a corrected, complete TrainingPlan that fixes every error and still follows all "
        "the hard rules."
    )


def run_one(
    client: httpx.Client,
    key: str,
    model: str,
    p: Profile,
    run: int,
    pacer: Pacer,
    effort: str,
    max_tokens: int,
) -> dict[str, Any]:
    messages = [
        {"role": "system", "content": system_prompt()},
        {"role": "user", "content": user_prompt(p)},
    ]
    first = call_groq(client, key, model, messages, pacer, effort, max_tokens)
    if first.ok and first.content is not None:
        errors, cats, stats = validate(first.content, p)
    else:
        errors, cats, stats = [f"api: {first.error}"], ["api_error"], {}
    rec: dict[str, Any] = {
        "model": model,
        "profile": p.key,
        "run": run,
        "prompt_version": PROMPT_VERSION,
        "first": {**asdict(first), "errors": errors, "categories": cats},
        "first_valid": not errors,
        "stats": stats,
        "repair": None,
        "final_valid": not errors,
    }
    if errors:
        # One repair attempt. If the first call produced content, feed it back with the errors;
        # an API-level failure (e.g. 400 schema) is retried once with the error as feedback.
        repair_msgs = list(messages)
        if first.content:
            repair_msgs.append({"role": "assistant", "content": first.content})
        repair_msgs.append({"role": "user", "content": repair_message(errors)})
        second = call_groq(client, key, model, repair_msgs, pacer, effort, max_tokens)
        if second.ok and second.content is not None:
            r_errors, r_cats, r_stats = validate(second.content, p)
        else:
            r_errors, r_cats, r_stats = [f"api: {second.error}"], ["api_error"], {}
        rec["repair"] = {
            **asdict(second),
            "errors": r_errors,
            "categories": r_cats,
        }
        rec["final_valid"] = not r_errors
        if not r_errors:
            rec["stats"] = r_stats
    return rec


def worker(
    model: str,
    key: str,
    runs: int,
    out: Path,
    lock: threading.Lock,
    effort: str,
    max_tokens: int,
    min_free: int,
    profiles: tuple[Profile, ...],
) -> None:
    pacer = Pacer(min_tokens_free=min_free)
    with httpx.Client(timeout=httpx.Timeout(180.0)) as client:
        for run in range(1, runs + 1):
            for p in profiles:
                rec = run_one(client, key, model, p, run, pacer, effort, max_tokens)
                rec["limits_seen"] = dict(pacer.limits_seen)
                with lock, (out / "calls.jsonl").open("a") as fh:
                    fh.write(json.dumps(rec) + "\n")
                status = (
                    "ok" if rec["first_valid"] else ("repaired" if rec["final_valid"] else "FAIL")
                )
                print(
                    f"{model} run{run} {p.key}: {status} {rec['first']['categories']}", flush=True
                )


# --- Aggregation.


def pct(values: list[float], q: float) -> float:
    if not values:
        return float("nan")
    s = sorted(values)
    idx = min(len(s) - 1, max(0, round(q * (len(s) - 1))))
    return s[idx]


def aggregate(records: list[dict[str, Any]]) -> str:
    lines = [
        "| model | runs | valid first try | valid after 1 repair | escalated | "
        "first-call latency p50 / p95 (s) | end-to-end p50 / p95 (s) | "
        "avg tokens per call (prompt / completion) | avg tokens per plan | 429s |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    detail: list[str] = []
    for model in MODELS:
        rs = [r for r in records if r["model"] == model]
        if not rs:
            continue
        n = len(rs)
        first_ok = sum(r["first_valid"] for r in rs)
        final_ok = sum(r["final_valid"] for r in rs)
        calls = [r["first"] for r in rs] + [r["repair"] for r in rs if r["repair"]]
        lat_first = [r["first"]["latency_s"] for r in rs if r["first"]["http_status"] == 200]
        e2e = [
            r["first"]["latency_s"] + (r["repair"]["latency_s"] if r["repair"] else 0) for r in rs
        ]
        pt = [c["usage"].get("prompt_tokens", 0) for c in calls if c["usage"]]
        ct = [c["usage"].get("completion_tokens", 0) for c in calls if c["usage"]]
        per_plan = [
            r["first"]["usage"].get("total_tokens", 0)
            + (r["repair"]["usage"].get("total_tokens", 0) if r["repair"] else 0)
            for r in rs
        ]
        r429 = sum(c["rate_limited"] for c in calls)
        lines.append(
            f"| `{model}` | {n} | {first_ok}/{n} ({first_ok / n:.0%}) | "
            f"{final_ok}/{n} ({final_ok / n:.0%}) | {n - final_ok} | "
            f"{pct(lat_first, 0.5):.1f} / {pct(lat_first, 0.95):.1f} | "
            f"{pct(e2e, 0.5):.1f} / {pct(e2e, 0.95):.1f} | "
            f"{statistics.mean(pt):.0f} / {statistics.mean(ct):.0f} | "
            f"{statistics.mean(per_plan):.0f} | {r429} |"
        )
        cat_first: dict[str, int] = {}
        for r in rs:
            for c in r["first"]["categories"]:
                cat_first[c] = cat_first.get(c, 0) + 1
        cat_final: dict[str, int] = {}
        for r in rs:
            if not r["final_valid"] and r["repair"]:
                for c in r["repair"]["categories"]:
                    cat_final[c] = cat_final.get(c, 0) + 1
        per_profile = []
        for p in PROFILES:
            pr = [r for r in rs if r["profile"] == p.key]
            if pr:
                per_profile.append(
                    f"{p.key} {sum(r['first_valid'] for r in pr)}/{len(pr)}"
                    f"→{sum(r['final_valid'] for r in pr)}/{len(pr)}"
                )
        under = sum(1 for r in rs if r["final_valid"] and r["stats"].get("underfilled"))
        fills = [
            r["stats"]["fill_ratio_min"]
            for r in rs
            if r["final_valid"] and r["stats"].get("fill_ratio_min") is not None
        ]
        reasons = sorted({c["finish_reason"] for c in calls if c["finish_reason"]})
        detail += [
            f"### `{model}`",
            "",
            f"- First-try failure categories (runs affected): {cat_first or 'none'}",
            f"- Still failing after repair: {cat_final or 'none'}",
            f"- Per profile, valid first → after repair: {', '.join(per_profile)}",
            f"- Valid plans with a day under 50% of session_minutes: {under}; "
            f"median shortest-day fill {statistics.median(fills):.0%}"
            if fills
            else "- No valid plans",
            f"- Finish reasons: {reasons}",
            f"- Rate-limit headers seen: {rs[-1].get('limits_seen')}",
            "",
        ]
    return "\n".join(lines) + "\n\n" + "\n".join(detail)


def representative_failures(records: list[dict[str, Any]], limit: int = 8) -> str:
    out = []
    for r in records:
        if not r["first_valid"]:
            errs = "; ".join(r["first"]["errors"][:3])
            fixed = (
                "repaired"
                if r["final_valid"]
                else "escalated: " + "; ".join((r["repair"] or {}).get("errors", [])[:2])
            )
            out.append(f"- `{r['model']}` {r['profile']} run {r['run']}: {errs} → {fixed}")
        if len(out) >= limit * 2:
            break
    return "\n".join(out) or "- none"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--env-file", default=str(API_ROOT.parents[1] / ".env"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--models", nargs="+", default=list(MODELS))
    ap.add_argument("--profiles", nargs="*", help="profile keys (default: all)")
    ap.add_argument("--reasoning-effort", default="medium", choices=["low", "medium", "high"])
    ap.add_argument("--max-tokens", type=int, default=6000)
    ap.add_argument("--min-free-tokens", type=int, default=4000, help="pace below this TPM left")
    ap.add_argument("--report-only", action="store_true", help="re-aggregate calls.jsonl")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if not args.report_only:
        sys.path.insert(0, str(API_ROOT))
        from app.core.config import Settings

        key = Settings(_env_file=args.env_file).groq_api_key  # type: ignore[call-arg]
        if not key:
            print("GROQ_API_KEY not found (env or --env-file)", file=sys.stderr)
            return 2
        profiles = tuple(p for p in PROFILES if not args.profiles or p.key in args.profiles)
        lock = threading.Lock()
        threads = [
            threading.Thread(
                target=worker,
                args=(
                    m,
                    key,
                    args.runs,
                    out,
                    lock,
                    args.reasoning_effort,
                    args.max_tokens,
                    args.min_free_tokens,
                    profiles,
                ),
            )
            for m in args.models
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

    records = [json.loads(line) for line in (out / "calls.jsonl").read_text().splitlines() if line]
    report = (
        f"# LLM plan spike ({PROMPT_VERSION})\n\n"
        + aggregate(records)
        + "\n## Representative first-try failures\n\n"
        + representative_failures(records)
        + "\n"
    )
    (out / "report.md").write_text(report)
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
