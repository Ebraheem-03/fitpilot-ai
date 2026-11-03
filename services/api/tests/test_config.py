"""Settings hold the Groq key as a SecretStr so repr, dumps and tracebacks can't leak it."""

from pydantic import SecretStr

from app.core.config import Settings
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
