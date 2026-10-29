# ADR-0004: One orchestrated LLM workflow behind a provider abstraction, with narrow tools

- **Status:** accepted · default provider amended by ADR-0006 (accepted 2026-10-28: Groq free tier, `openai/gpt-oss-120b`, $0 budget)
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

## Amendment 2026-10-29: training-plan lifecycle (M3 S4, FR-02)

A generated plan is a **version**, never an edit. Each `POST /training-plans/generate` creates one row in `training_plans`, numbered `version` 1, 2, 3… per member. Plans that need review get a number too. A version has one of three statuses:

- **`active`**: the plan passed schema and domain validation, first try or after the one repair. A member has at most one active plan (a partial unique index enforces it). Saving a new active plan moves the previous one to `superseded` in the same transaction.
- **`superseded`**: an earlier active plan, still readable (`GET /training-plans`, `GET /training-plans/{id}`). Sessions can still reference it.
- **`needs_review`**: still invalid after one repair. It is saved with its `validation_issues` (code + validator message, never model text) and the last draft that parsed, for trainer review. It **does not** supersede the active plan. The member API returns it with `plan: null`, so a rejected draft is never shown (principle 2). Trainer review and approval are M5. Until then the status is terminal.

What else is stored with each version: `prompt_version` (`plan-v1`), provider, model, and `generation_metadata`. That holds the effective inputs, the defaults applied, per-attempt outcome, tokens, latency, list and billed cost, and the prompt file hash. It never holds prompt or model text.

Generation is single-flight per member (a transaction-scoped advisory lock; a concurrent request gets 409 `generation_in_progress`). It is also idempotent per `Idempotency-Key`: the same key returns the stored version without calling the model. A busy or unavailable provider saves nothing and returns 503 (`coach_busy` with `Retry-After`, or `ai_unavailable`).

Plans are only deleted together with their member. `workout_sessions.training_plan_id` references them with ON DELETE NO ACTION (migration 0004).
