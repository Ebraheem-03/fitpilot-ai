from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All config comes from env (12-factor). Secrets never have real defaults."""

    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    fitpilot_env: str = "local"
    database_url: str = "postgresql+psycopg://fitpilot:fitpilot@localhost:5432/fitpilot"
    cors_origins: str = "http://localhost:3000"
    supabase_jwt_secret: str | None = None
    # Issuer base; falls back to the web's public URL so one .env serves both apps.
    supabase_url: str | None = Field(
        default=None, validation_alias=AliasChoices("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
    )

    # ADR-0006: zero-cost default. Tests/CI use the "fake" provider; budget 0 blocks paid calls.
    llm_provider: str = "groq"
    llm_model: str = "openai/gpt-oss-120b"
    llm_monthly_budget_usd: float = 0.0
    groq_api_key: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
