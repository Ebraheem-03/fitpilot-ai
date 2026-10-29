"""The LLM layer (ADR-0004, ADR-0006). Every model call in the app goes through
`LLMClient.generate_structured`; feature code (services/plans, later coaching and nutrition)
never talks to a provider directly.

    client = get_llm_client()   # or build_client(settings, provider=FakeProvider(...))
    result = client.generate_structured(Schema, messages, schema_name=..., prompt_version=...)
    outcome = generate_with_repair(client, Schema, messages, validate=..., repair_instruction=...)
"""

from app.services.llm.budget import BudgetGuard, InMemoryLedger
from app.services.llm.client import LLMClient, issues_from_validation_error
from app.services.llm.factory import build_client, build_provider, get_llm_client
from app.services.llm.fake import FakeProvider, FakeReply, load_fake_replies, register_responder
from app.services.llm.pricing import ModelPrice, price_for
from app.services.llm.repair import RepairOutcome, generate_with_repair
from app.services.llm.schema import strict_json_schema
from app.services.llm.types import (
    CallRecord,
    CompletionRequest,
    LLMBusy,
    LLMError,
    LLMUnavailable,
    Message,
    ProviderResponse,
    StructuredResult,
    Usage,
    ValidationIssue,
)

__all__ = [
    "BudgetGuard",
    "CallRecord",
    "CompletionRequest",
    "FakeProvider",
    "FakeReply",
    "InMemoryLedger",
    "LLMBusy",
    "LLMClient",
    "LLMError",
    "LLMUnavailable",
    "Message",
    "ModelPrice",
    "ProviderResponse",
    "RepairOutcome",
    "StructuredResult",
    "Usage",
    "ValidationIssue",
    "build_client",
    "build_provider",
    "generate_with_repair",
    "get_llm_client",
    "issues_from_validation_error",
    "load_fake_replies",
    "price_for",
    "register_responder",
    "strict_json_schema",
]
