from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All config comes from env (12-factor). Secrets never have real defaults."""

    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    fitpilot_env: str = "local"
    database_url: str = "postgresql+psycopg://fitpilot:fitpilot@localhost:5432/fitpilot"
    cors_origins: str = "http://localhost:3000"
    supabase_jwt_secret: str | None = None

    llm_provider: str = "anthropic"
    llm_model: str = "claude-sonnet-5-5"
    llm_monthly_budget_usd: float = 5.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
