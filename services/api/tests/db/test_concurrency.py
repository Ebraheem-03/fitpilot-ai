"""Real concurrency (blueprint §7: retries and double-clicks must be safe): threads, separate
database sessions, committed data. FR-02 plan generation, FR-07 session start / events / complete.

Each test races N identical requests released at the same moment and asserts the outcome the
idempotency contract promises, and what the database ended up holding.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from sqlalchemy import text

from app.services.llm import FakeProvider, FakeReply
from tests.db.concurrency_helpers import TIMEOUT_S, LiveApi, gate, run_together
from tests.db.plan_helpers import GENERATE, llm, sub_of
from tests.db.session_helpers import SESSIONS, rep, set_completed, shown
from tests.llm_helpers import VALID_PLAN

N = 6


def json_of(responses: list[Any]) -> list[Any]:
    return [r.json() for r in responses]


# --- sessions: start ------------------------------------------------------------------------


def test_concurrent_starts_with_one_idempotency_key_make_one_session(live: LiveApi) -> None:
    h = live.member()
    key = {"Idempotency-Key": "start-key-concurrent-1"}

    def start(_: int) -> Any:
        return live.client().post(SESSIONS, json={}, headers={**h, **key})

    responses = run_together(N, start)

    assert sorted(r.status_code for r in responses) == [200] * (N - 1) + [201]
    assert len({r.json()["id"] for r in responses}) == 1
    assert live.scalar("SELECT count(*) FROM workout_sessions") == 1


# --- sessions: events -----------------------------------------------------------------------


def start_session(live: LiveApi, h: dict[str, str]) -> str:
    r = live.client().post(SESSIONS, json={}, headers=h)
    assert r.status_code == 201
    return str(r.json()["id"])


def test_concurrent_duplicate_event_batches_are_stored_once_without_a_500(live: LiveApi) -> None:
    h = live.member()
    sid = start_session(live, h)
    batch = [rep(sid, 0, i) for i in range(5)] + [shown(sid), set_completed(sid, 0, 5)]

    def send(_: int) -> Any:
        return live.client().post(f"{SESSIONS}/{sid}/events", json={"events": batch}, headers=h)

    responses = run_together(N, send)

    assert [r.status_code for r in responses] == [200] * N
    accepted = sum(r.json()["accepted"] for r in responses)
    duplicates = sum(r.json()["duplicates"] for r in responses)
    assert accepted == len(batch)
    assert duplicates == len(batch) * (N - 1)
    assert sum(r.json()["conflicting_duplicates"] for r in responses) == 0
    assert live.scalar("SELECT count(*) FROM session_events WHERE session_id = :s", s=sid) == len(
        batch
    )


def test_concurrent_overlapping_batches_store_each_event_once(live: LiveApi) -> None:
    h = live.member()
    sid = start_session(live, h)
    shared = [rep(sid, 0, i) for i in range(4)]
    batches = [[*shared, rep(sid, 0, 10 + i)] for i in range(N)]  # each adds one event of its own

    def send(i: int) -> Any:
        return live.client().post(
            f"{SESSIONS}/{sid}/events", json={"events": batches[i]}, headers=h
        )

    responses = run_together(N, send)

    assert [r.status_code for r in responses] == [200] * N
    assert sum(r.json()["accepted"] for r in responses) == len(shared) + N
    assert live.scalar("SELECT count(*) FROM session_events WHERE session_id = :s", s=sid) == (
        len(shared) + N
    )


# --- sessions: complete ---------------------------------------------------------------------


def test_concurrent_completes_give_one_summary_and_the_same_response(live: LiveApi) -> None:
    h = live.member()
    sid = start_session(live, h)
    sent = live.client().post(
        f"{SESSIONS}/{sid}/events",
        json={"events": [rep(sid, 0, 0), rep(sid, 0, 1), set_completed(sid, 0, 2)]},
        headers=h,
    )
    assert sent.status_code == 200

    def complete(_: int) -> Any:
        return live.client().post(f"{SESSIONS}/{sid}/complete", json=None, headers=h)

    responses = run_together(N, complete)

    assert [r.status_code for r in responses] == [200] * N
    first = responses[0].json()
    assert all(body == first for body in json_of(responses))
    assert first["exercises"][0]["total_reps"] == 2
    # one performance record per exercise: the losers replayed instead of recomputing
    assert live.scalar("SELECT count(*) FROM performance_records WHERE session_id = :s", s=sid) == 1
    assert live.scalar("SELECT status FROM workout_sessions WHERE id = :s", s=sid) == "completed"


def test_events_racing_a_completion_either_land_before_it_or_are_refused(live: LiveApi) -> None:
    """The row lock serialises them: an accepted event is in the summary, a late one is a 409."""
    h = live.member()
    sid = start_session(live, h)
    events = [rep(sid, 0, i) for i in range(4)]

    def work(i: int) -> Any:
        client = live.client()
        if i == 0:
            return client.post(f"{SESSIONS}/{sid}/complete", json=None, headers=h)
        return client.post(f"{SESSIONS}/{sid}/events", json={"events": [events[i]]}, headers=h)

    responses = run_together(4, work)

    assert responses[0].status_code == 200
    assert {r.status_code for r in responses[1:]} <= {200, 409}
    stored = live.scalar("SELECT count(*) FROM session_events WHERE session_id = :s", s=sid)
    accepted = sum(1 for r in responses[1:] if r.status_code == 200)
    assert stored == accepted
    total_reps = sum(e["total_reps"] for e in responses[0].json()["exercises"])
    assert total_reps == stored  # nothing landed after the summary was computed


# --- plans: generate ------------------------------------------------------------------------


class GatedProvider:
    """Blocks its first call until released, so the other requests meet an in-flight generation."""

    name = "fake"

    def __init__(self, entered: threading.Event, release: threading.Event, reply: Any) -> None:
        self.entered, self.release = entered, release
        self.inner = FakeProvider([reply])
        self.calls = 0
        self._lock = threading.Lock()

    def complete(self, request: Any) -> Any:
        with self._lock:
            self.calls += 1
        self.entered.set()
        assert self.release.wait(TIMEOUT_S), "test never released the provider"
        return self.inner.complete(request)


def race_generates(live: LiveApi, h: dict[str, str], keys: list[str]) -> tuple[list[Any], Any]:
    """Fire one generate per key at once, keep the winner's provider call open until every other
    request has answered, then release it. Returns (responses in key order, the provider)."""
    entered = threading.Event()
    barrier = threading.Barrier(len(keys))

    def post(key: str) -> Any:
        barrier.wait(TIMEOUT_S)
        return live.client().post(GENERATE, headers={**h, "Idempotency-Key": key})

    with gate() as release:
        provider = GatedProvider(entered, release, FakeReply.ok(VALID_PLAN))
        with llm(provider=provider), ThreadPoolExecutor(len(keys)) as pool:
            futures = [pool.submit(post, k) for k in keys]
            assert entered.wait(TIMEOUT_S), "no request reached the provider"
            deadline = time.monotonic() + TIMEOUT_S
            while sum(f.done() for f in futures) < len(keys) - 1 and time.monotonic() < deadline:
                time.sleep(0.02)
            # the losers have answered while the winner is still inside the provider call
            assert sum(f.done() for f in futures) == len(keys) - 1
            release.set()
            return [f.result(TIMEOUT_S) for f in futures], provider


def test_concurrent_generates_with_one_key_make_one_plan_and_one_llm_call(live: LiveApi) -> None:
    h = live.member()
    key = "plan-key-concurrent-1"
    responses, provider = race_generates(live, h, [key] * N)

    assert sorted(r.status_code for r in responses) == [201] + [409] * (N - 1)
    assert {r.json()["detail"]["code"] for r in responses if r.status_code == 409} == {
        "generation_in_progress"
    }
    assert provider.calls == 1
    assert live.scalar("SELECT count(*) FROM training_plans") == 1
    assert live.scalar("SELECT count(*) FROM plan_generation_claims") == 0

    # the client's retry after the 409 gets the stored plan, with no second call
    winner = next(r for r in responses if r.status_code == 201).json()
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        again = live.client().post(GENERATE, headers={**h, "Idempotency-Key": key})
    assert again.status_code == 200 and again.json() == winner
    assert fake.calls == [] and provider.calls == 1
    assert live.scalar("SELECT count(*) FROM training_plans") == 1


def test_concurrent_generates_with_different_keys_still_make_one_plan(live: LiveApi) -> None:
    h = live.member()
    responses, provider = race_generates(live, h, [f"plan-key-distinct-{i}" for i in range(N)])

    assert sorted(r.status_code for r in responses) == [201] + [409] * (N - 1)
    assert provider.calls == 1
    assert live.scalar("SELECT count(*) FROM training_plans WHERE status = 'active'") == 1
    assert live.scalar("SELECT count(*) FROM training_plans") == 1


def test_no_pooled_connection_is_checked_out_while_the_provider_runs(live: LiveApi) -> None:
    h = live.member()
    checked_out: list[int] = []

    class Probe:
        name = "fake"
        inner = FakeProvider([FakeReply.ok(VALID_PLAN)])

        def complete(self, request: Any) -> Any:
            checked_out.append(live.engine.pool.checkedout())  # type: ignore[attr-defined]
            return self.inner.complete(request)

    with llm(provider=Probe()):
        r = live.client().post(GENERATE, headers={**h, "Idempotency-Key": "plan-key-pool-0001"})
    assert r.status_code == 201
    assert checked_out == [0]


def test_a_claim_left_by_a_crashed_worker_expires_and_generation_recovers(live: LiveApi) -> None:
    h = live.member()
    with live.engine.begin() as conn:  # a worker that died after claiming, four minutes ago
        conn.execute(
            text(
                "INSERT INTO plan_generation_claims (user_id, idempotency_key, claimed_at) "
                "SELECT id, 'dead-worker-key-1', clock_timestamp() - interval '4 minutes' "
                "FROM users WHERE id = :u"
            ),
            {"u": sub_of(h)},
        )
    with llm(FakeReply.ok(VALID_PLAN)) as (_, fake):
        r = live.client().post(GENERATE, headers={**h, "Idempotency-Key": "plan-key-recover-1"})
    assert r.status_code == 201 and len(fake.calls) == 1
    assert live.scalar("SELECT count(*) FROM plan_generation_claims") == 0
