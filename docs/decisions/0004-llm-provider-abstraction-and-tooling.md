# ADR-0004: One orchestrated LLM workflow behind a provider abstraction, with narrow tools

- **Status:** accepted · default provider amended by ADR-0006 (proposed: Groq free tier, $0 budget)
- **Date:** 2026-10-27
- **Requirements:** FR-02, FR-08, FR-09, FR-13, blueprint §9–10

## Decision

- `services/api/app/services/llm/` exposes `generate_structured(schema, messages, tools)`; providers (Anthropic first) implement it. Model and provider come from env (`LLM_PROVIDER`, `LLM_MODEL`).
- Structured outputs only for anything that changes data; every result is parsed into Pydantic and validated against the exercise catalogue and coaching policy **before** it is saved or shown. Invalid → repair once → escalate (FR-02).
- The model gets narrow, authorized tools (`get_current_plan`, `generate_plan_draft`, `request_trainer_review`) — never SQL or unrestricted reads.
- The assistant may only say an action happened after the backend confirms it (FR-09).
- No multi-agent architecture until evals show a benefit (blueprint §9).
- Every call records latency, tokens, cost, outcome (FR-13); a monthly budget guard (`LLM_MONTHLY_BUDGET_USD`) fails closed.
- Eval suite in `services/api/app/services/evaluation` + fixtures in `data/evaluation-fixtures/ai`; run on every prompt/model change.

## Consequences

The Claude Pro subscription does not include API usage — the API key is a separate, pay-as-you-go cost. Keep fixtures small and cache plan drafts in dev.
