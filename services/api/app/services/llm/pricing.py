"""Cost per model (FR-13: measure AI cost). The budget guard prices every call from this table and
refuses a model it can't price (fail closed, ADR-0004)."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelPrice:
    input_usd_per_mtok: float
    output_usd_per_mtok: float
    # False on a free tier: list cost is recorded for evals, but nothing is billed.
    billed: bool

    def list_cost(self, tokens_in: int, tokens_out: int) -> float:
        return (
            tokens_in * self.input_usd_per_mtok + tokens_out * self.output_usd_per_mtok
        ) / 1_000_000

    def billed_cost(self, tokens_in: int, tokens_out: int) -> float:
        return self.list_cost(tokens_in, tokens_out) if self.billed else 0.0


FREE = ModelPrice(0.0, 0.0, billed=False)

# Groq list prices, checked 2026-10-29 at https://console.groq.com/docs/models. The project runs on
# the free tier (ADR-0006), so `billed=False`; flip it only with a paid org and a durable ledger.
GROQ_PRICES: dict[str, ModelPrice] = {
    "openai/gpt-oss-120b": ModelPrice(0.15, 0.60, billed=False),
    "openai/gpt-oss-20b": ModelPrice(0.075, 0.30, billed=False),
}


def price_for(provider: str, model: str) -> ModelPrice | None:
    """None means "unknown, refuse". Local and fake providers are free for any model."""
    if provider in ("fake", "ollama"):
        return FREE
    if provider == "groq":
        return GROQ_PRICES.get(model)
    return None
