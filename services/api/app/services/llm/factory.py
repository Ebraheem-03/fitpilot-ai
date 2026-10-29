"""Build the process-wide LLMClient from settings (`LLM_PROVIDER`, `LLM_MODEL`, ADR-0006).

One client per process, so the budget guard's ledgers see every call. Tests override
`get_llm_client` (FastAPI dependency) with a client around a FakeProvider; `tests/conftest.py`
also forces `LLM_PROVIDER=fake` so nothing in the suite can reach a live model.
"""

from functools import lru_cache

from app.core.config import Settings, get_settings
from app.services.llm.budget import BudgetGuard
from app.services.llm.client import LLMClient
from app.services.llm.fake import FakeProvider
from app.services.llm.providers import OpenAICompatibleProvider, Provider, UnconfiguredProvider

PROVIDERS = ("groq", "fake", "ollama")


def build_provider(settings: Settings) -> Provider:
    name = settings.llm_provider
    if name == "fake":
        return FakeProvider()
    if name == "groq":
        if not settings.groq_api_key:
            return UnconfiguredProvider("groq", "not_configured")
        return OpenAICompatibleProvider(
            "groq",
            settings.groq_base_url,
            settings.groq_api_key,
            timeout_s=settings.llm_timeout_s,
            groq_extensions=True,
        )
    if name == "ollama":
        return OpenAICompatibleProvider(
            "ollama",
            settings.ollama_base_url,
            None,
            timeout_s=settings.llm_timeout_s,
            groq_extensions=False,
        )
    return UnconfiguredProvider(name, "unknown_provider")


def build_client(settings: Settings, provider: Provider | None = None) -> LLMClient:
    return LLMClient(
        provider or build_provider(settings),
        model=settings.llm_model,
        budget=BudgetGuard(
            monthly_budget_usd=settings.llm_monthly_budget_usd,
            daily_token_budget=settings.llm_daily_token_budget,
        ),
        reasoning_effort=settings.llm_reasoning_effort,
        max_completion_tokens=settings.llm_max_completion_tokens,
        max_retry_wait_s=settings.llm_max_retry_wait_s,
    )


@lru_cache
def get_llm_client() -> LLMClient:
    return build_client(get_settings())
