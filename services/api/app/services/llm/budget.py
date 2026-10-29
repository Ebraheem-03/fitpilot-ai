"""Fail-closed spend and capacity guards, checked before every provider call (ADR-0004, ADR-0006).

- Monthly USD budget (`LLM_MONTHLY_BUDGET_USD`). A model that can't be priced is refused. A billed
  model is refused when the budget is 0, or when month-to-date spend plus the call's worst case
  (estimated prompt + `max_completion_tokens`) would exceed it. Free-tier and local models cost 0
  and pass.
- Daily token budget (`LLM_DAILY_TOKEN_BUDGET`, 0 = off). Keeps this process under the Groq free
  tier's tokens-per-day cap, so members get "coach is busy, try again tomorrow" from us instead of
  a run of daily-cap 429s.

Both ledgers are in-process: they reset on restart and aren't shared between workers. That is
enough while every configured model is free (the monthly guard then never has anything to add up).
A durable ledger is a prerequisite for ever setting `billed=True` in pricing.py.
"""

import math
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Protocol

from app.services.llm.pricing import ModelPrice
from app.services.llm.types import LLMBusy, LLMUnavailable

Clock = Callable[[], datetime]


def utc_now() -> datetime:
    return datetime.now(UTC)


class SpendLedger(Protocol):
    def month_to_date_usd(self, now: datetime) -> float: ...
    def add_usd(self, amount: float, now: datetime) -> None: ...


@dataclass
class InMemoryLedger:
    """Spend per calendar month and tokens per UTC day, for one process."""

    _usd: dict[tuple[int, int], float] = field(default_factory=dict)
    _tokens: dict[str, int] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def month_to_date_usd(self, now: datetime) -> float:
        with self._lock:
            return self._usd.get((now.year, now.month), 0.0)

    def add_usd(self, amount: float, now: datetime) -> None:
        with self._lock:
            key = (now.year, now.month)
            self._usd[key] = self._usd.get(key, 0.0) + amount

    def tokens_today(self, now: datetime) -> int:
        with self._lock:
            return self._tokens.get(now.date().isoformat(), 0)

    def add_tokens(self, tokens: int, now: datetime) -> None:
        with self._lock:
            key = now.date().isoformat()
            self._tokens[key] = self._tokens.get(key, 0) + tokens


def seconds_until_utc_midnight(now: datetime) -> float:
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return math.ceil((tomorrow - now).total_seconds())


class BudgetGuard:
    def __init__(
        self,
        *,
        monthly_budget_usd: float,
        daily_token_budget: int,
        ledger: InMemoryLedger | None = None,
        clock: Clock = utc_now,
    ) -> None:
        self.monthly_budget_usd = monthly_budget_usd
        self.daily_token_budget = daily_token_budget
        self.ledger = ledger or InMemoryLedger()
        self._clock = clock

    def check(self, price: ModelPrice | None, est_tokens_in: int, max_tokens_out: int) -> None:
        """Raise before the call if it must not happen."""
        if price is None:
            raise LLMUnavailable("unpriced_model")
        now = self._clock()
        if price.billed:
            if self.monthly_budget_usd <= 0:
                raise LLMUnavailable("budget_refused")
            worst = price.billed_cost(est_tokens_in, max_tokens_out)
            if self.ledger.month_to_date_usd(now) + worst > self.monthly_budget_usd:
                raise LLMUnavailable("budget_refused")
        if self.daily_token_budget > 0 and self.ledger.tokens_today(now) >= self.daily_token_budget:
            raise LLMBusy("daily_token_budget", seconds_until_utc_midnight(now))

    def record(self, price: ModelPrice, tokens_in: int, tokens_out: int) -> None:
        now = self._clock()
        self.ledger.add_tokens(tokens_in + tokens_out, now)
        cost = price.billed_cost(tokens_in, tokens_out)
        if cost:
            self.ledger.add_usd(cost, now)
