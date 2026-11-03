"""Settings hold the Groq key as a SecretStr so repr, dumps and tracebacks can't leak it."""

import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import Settings
from app.services.llm import build_client
from app.services.llm.providers import OpenAICompatibleProvider

SECRET = "gsk_test_secret_value_123"  # noqa: S105


def test_the_groq_key_is_a_secret_in_repr_str_and_dumps() -> None:
    settings = Settings(groq_api_key=SecretStr(SECRET))
    assert isinstance(settings.groq_api_key, SecretStr)
    assert SECRET not in repr(settings)
    assert SECRET not in str(settings)
    assert SECRET not in str(settings.model_dump())
    assert SECRET not in settings.model_dump_json()
    assert settings.groq_api_key.get_secret_value() == SECRET


def test_a_plain_string_is_coerced_and_hidden_too() -> None:
    settings = Settings(groq_api_key=SECRET)  # type: ignore[arg-type]
    assert isinstance(settings.groq_api_key, SecretStr)
    assert SECRET not in repr(settings)


def test_an_unset_or_blank_key_is_falsy() -> None:
    assert Settings(groq_api_key=None).groq_api_key is None
    assert not Settings(groq_api_key=SecretStr("")).groq_api_key


def test_the_provider_sends_the_key_as_the_authorization_header() -> None:
    provider = OpenAICompatibleProvider(
        "groq",
        "https://example.invalid/v1",
        SecretStr(SECRET),
        timeout_s=1.0,
        groq_extensions=True,
    )
    assert provider._headers == {"Authorization": f"Bearer {SECRET}"}


# --- the fake provider is for local/test/ci only (M3 close-out review 5) ---------------------


@pytest.mark.parametrize("env", ["local", "test", "ci"])
def test_the_fake_provider_is_allowed_in_dev_test_and_ci(env: str) -> None:
    assert Settings(llm_provider="fake", fitpilot_env=env).llm_provider == "fake"


@pytest.mark.parametrize("env", ["production", "staging", "prod", "", "preview"])
def test_the_fake_provider_is_refused_elsewhere(env: str) -> None:
    with pytest.raises(ValidationError, match="LLM_PROVIDER=fake is only allowed"):
        Settings(llm_provider="fake", fitpilot_env=env)


def test_real_providers_work_in_production() -> None:
    assert Settings(llm_provider="groq", fitpilot_env="production").llm_provider == "groq"
    assert Settings(llm_provider="ollama", fitpilot_env="staging").llm_provider == "ollama"


def test_the_fake_provider_cannot_be_built_in_production() -> None:
    with pytest.raises(ValidationError):
        build_client(Settings(llm_provider="fake", fitpilot_env="production"))


def test_plan_generation_cap_setting() -> None:
    assert Settings().plan_generations_per_day == 5
    assert Settings(plan_generations_per_day=2).plan_generations_per_day == 2
    with pytest.raises(ValidationError):
        Settings(plan_generations_per_day=0)


def test_an_unset_environment_is_treated_as_production(monkeypatch: pytest.MonkeyPatch) -> None:
    # Fails closed: a deployed container that forgets FITPILOT_ENV must not accept the fake planner.
    monkeypatch.delenv("FITPILOT_ENV", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert Settings(_env_file=None).fitpilot_env == "production"  # type: ignore[call-arg]
    monkeypatch.setenv("LLM_PROVIDER", "fake")
    with pytest.raises(ValidationError, match="LLM_PROVIDER=fake is only allowed"):
        Settings(_env_file=None)  # type: ignore[call-arg]
