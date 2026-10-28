# ADR-0006: Zero-cost hosted LLM provider (Groq free tier) behind the ADR-0004 abstraction

- **Status:** accepted 2026-10-28, after the M3 S0 provider spike ([results](../evaluation/llm-spike-2026-10-28.md)). Proposed 2026-10-27.
- **Date:** 2026-10-27 (proposed) · 2026-10-28 (accepted)
- **Requirements:** FR-02, FR-08, FR-09, FR-13, NFR-Privacy, blueprint §9–10
- **Amends:** ADR-0004 ("providers (Anthropic first)"). The abstraction, validation and budget rules of ADR-0004 are unchanged.

## Context

The project is a portfolio build with a hard **$0 running-cost** constraint. ADR-0004 defaulted to the Anthropic API, which has no free tier (pay-as-you-go, separate from a Claude subscription). The deployed demo runs on free hosts (ADR-0005) that cannot run a local model, so local-only inference (Ollama) does not cover the public demo.

Constraints any provider must meet:

- **Structured output** strong enough for plan/nutrition generation (FR-02, FR-08): every result is parsed into Pydantic and validated against the catalogue (ADR-0004).
- **Privacy** (principle 5, NFR-Privacy): prompts contain profile context, which is health-adjacent. The provider must not train on it or put it in front of human reviewers.
- **Lawful to serve the demo's audience**, which includes reviewers and recruiters in the EEA/UK.
- **Free limits** must be enough for a demo plus a small eval suite, not production traffic.

## Options considered

| Option                     | Pros                                                                                                                                                                                                                                                                                                                       | Cons                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do nothing (Anthropic API) | Strongest structured output + tool use; ADR-0004 as written                                                                                                                                                                                                                                                                | Not $0, which fails the constraint outright                                                                                                                                                                                                                                                                                                                                                                            |
| **Groq free tier**         | No card needed. No inference data retained by default; any customer can enable Zero Data Retention [1]. The Services Agreement forbids training on inputs/outputs [6]. Strict JSON-schema output on `openai/gpt-oss-120b` / `-20b` [2], both production models [7]. OpenAI-compatible API. Measured p50 3.6–5.9 s per plan | Per-model limits on the free organisation: 30 RPM, 1K RPD, **8K TPM, 200K TPD** [3]. Measured: about 2 plans/min and 50–80 plans/day per model. Strict structured output can't be combined with tool use or streaming [2]. **"Strict" isn't a guarantee in practice:** 2/36 (120b) and 11/36 (20b) first calls returned HTTP 400 `json_validate_failed` (truncation or schema mismatch). Open-weight models are weaker |
| Gemini API free tier       | Generous limits, good models                                                                                                                                                                                                                                                                                               | Free-tier content is used to improve Google products and may be read by human reviewers. Terms say not to submit personal info, and **only paid services may serve users in the EEA, Switzerland or UK** [4] (terms updated 2026-04-28, unchanged on these points). This rules it out for a public demo                                                                                                                |
| OpenRouter `:free` models  | Many models, one API                                                                                                                                                                                                                                                                                                       | 50 requests/day without a credit purchase (1,000 with a $10 top-up) [5][8]. Upstream providers and their logging terms vary per model, and capacity can disappear                                                                                                                                                                                                                                                      |
| Local Ollama only          | Truly private, $0, offline                                                                                                                                                                                                                                                                                                 | Can't run on free API hosts, so the deployed demo would have no AI; slower on a laptop                                                                                                                                                                                                                                                                                                                                 |

## Spike results (2026-10-28)

Script: `services/api/scripts/spikes/llm_plan_spike.py` (prompt `plan-spike-v1`, throwaway). Inputs: 12 synthetic profiles (1–6 days/week, 10–180 min, equipment none / dumbbells / unusable / mixed, edge cases) and the 7-exercise catalogue planned for S1.

Validation order: Pydantic schema, then catalogue, equipment, days/week, reps-vs-duration, duplicates and estimated session length ≤ `session_minutes`. A failed plan gets one repair call. Full method and failure cases: [docs/evaluation/llm-spike-2026-10-28.md](../evaluation/llm-spike-2026-10-28.md).

| model · `reasoning_effort` | runs | valid first try | valid after 1 repair | escalated | latency p50 / p95, first call (s) | avg tokens per call (prompt / completion) | 429s (recovered) |
| -------------------------- | ---- | --------------- | -------------------- | --------- | --------------------------------- | ----------------------------------------- | ---------------- |
| `gpt-oss-120b` · medium    | 36   | 34/36 (94%)     | **36/36 (100%)**     | 0         | 5.9 / 9.6                         | 969 / 2807                                | 3 (3)            |
| `gpt-oss-20b` · medium     | 36   | 27/36 (75%)     | 34/36 (94%)          | 2         | 4.5 / 7.4                         | 977 / 3352                                | 2 (2)            |
| `gpt-oss-120b` · low       | 12   | 12/12 (100%)    | 12/12 (100%)         | 0         | 3.6 / 4.7                         | 916 / 1514                                | 0                |
| `gpt-oss-20b` · low        | 12   | 8/12            | 9/12                 | 3         | 1.9 / 3.0                         | 920 / 1245                                | 8 (daily cap)    |

- **No failure was a domain violation.** Every failure was a Groq-side HTTP 400 `json_validate_failed`:
  - output truncated at `max_completion_tokens` (6,000) on 6-day plans;
  - the days array returned as the root object;
  - a field nested in the wrong object;
  - "Failed to generate JSON" with no detail.
- An independent re-check of all accepted plans found 0 violations of days/week, equipment or session length.
- Reasoning tokens are about 65% of the completion at medium effort. Low effort on 120b cut tokens per plan by 36% and latency by 39% with no failures (n=12).
- The 20b low-effort "failures" are daily-cap 429s, not quality failures.
- The acceptance criterion was validity after repair ≥ 95% on 120b. **It was met (100%)**, so the ADR is accepted, not amended.

## Decision

1. **Default hosted provider: Groq free tier.** `LLM_PROVIDER=groq`, `LLM_MODEL=openai/gpt-oss-120b`. Enable Zero Data Retention in the Groq console before any real profile data flows.
2. **Default model is `openai/gpt-oss-120b`; `gpt-oss-20b` is not a fallback.** 20b missed the gate at 94% after repair. Falling back to it on 429 would double capacity but trade validity for availability. If that's ever wanted, the eval suite must show it first.
3. **Plan generation call settings:**
   - `reasoning_effort: low` (S5's eval suite confirms this against medium on ~20 profiles before M3 closes; fall back to medium if validity drops);
   - `max_completion_tokens: 6000`;
   - `include_reasoning: false`;
   - strict `json_schema` with `exercise_id` as an enum of the catalogue.
4. **Groq's strict mode is not trusted.** An HTTP 400 `json_validate_failed` is a failed generation. It enters the same repair-once path, with the API error (and Groq's `failed_generation` text, if present) as feedback. Pydantic and domain validation stay authoritative either way (ADR-0004).
5. **`fake` provider** for unit tests, CI and the AI eval runner's offline mode: deterministic canned responses keyed by fixture. CI never calls a live model.
6. **Optional `ollama` provider** for private local development, using the same OpenAI-compatible client.
7. **`LLM_MONTHLY_BUDGET_USD=0`** by default. Because the guard fails closed (ADR-0004), a misconfigured paid provider is refused rather than billed.
8. **Respect the tool-use limitation**, which is still documented [2]. Write paths (plan and nutrition drafts) use single-shot structured output with no tools. The coaching assistant (FR-09) runs a tool-calling loop whose tool _arguments_ are validated by Pydantic server-side, with no strict schema on the reply.
9. **Anthropic stays implementable** behind the same interface, one env change away, if the project ever gets a budget.

## Consequences

- AI features cost $0. At Groq list prices a plan would cost about $0.001–0.002. The budget guard and `fake` provider make accidental spend and CI flakiness unlikely.
- **Capacity is the real constraint, and it's daily tokens, not requests.**
  - 200K TPD supports about 80 plans a day per model at low effort (about 50 at medium).
  - 8K TPM allows about 2 plans a minute.
  - A live eval pass over ~20 profiles uses 25–40% of a day's tokens, so `make eval-ai` runs once per prompt or model change, never in CI.
  - A 429 must map to a clear "coach is busy, try again" state, never a fabricated answer (principle 3), and must be logged as an FR-13 event.
  - A daily-cap 429 (long `retry-after`) must not be retried in-request.
- The repair loop is earning its keep on infrastructure errors (truncation, Groq's schema check), not on bad plans. Escalation (`needs_review`) still has to exist: 20b escalated 2/36 even after repair.
- Demo data should still be synthetic where practical. ZDR covers retention, but the public demo should not invite real health details. With ZDR off, Groq may keep inputs/outputs up to 30 days for reliability and abuse monitoring [1].
- Free-tier terms change. Re-check [1]–[8] before any public launch (M5).

## Sources (re-checked 2026-10-28)

1. **Groq, Your data:** https://console.groq.com/docs/your-data
   - No retention by default.
   - Any customer can enable ZDR.
   - Without ZDR, reliability and abuse-monitoring logs are kept up to 30 days.
   - The page doesn't mention training (see [6]).
2. **Groq, Structured outputs:** https://console.groq.com/docs/structured-outputs
   - Strict mode on gpt-oss-120b/20b, with all fields required and `additionalProperties: false`; `$defs`/`anyOf` supported.
   - "Streaming and tool use are not currently supported with Structured Outputs."
   - The page claims strict mode never errors. **The spike contradicts this.**
3. **Groq, Rate limits:** https://console.groq.com/docs/rate-limits
   - Both models: 30 RPM / 1K RPD / 8K TPM / 200K TPD.
   - The free organisation's headers showed `x-ratelimit-limit-requests: 1000` and `x-ratelimit-limit-tokens: 8000`.
   - _Replaces the third-party summary previously cited here. That summary (https://openrouter.ai/blog/tutorials/free-llm-apis-compared/, updated 2026-09-24) still lists 30 RPM / 1K RPD._
4. **Gemini API Additional Terms of Service:** https://ai.google.dev/gemini-api/terms (last updated 2026-04-28).
   - Unpaid content may be used to improve products and read by human reviewers.
   - Don't submit personal info.
   - Only Paid Services may serve users in the EEA, Switzerland or UK.
5. **OpenRouter free-tier limits** (third-party summary): https://www.truefoundry.com/es/blog/openrouter-rate-limits-your-free-tier-depends-on-what-youve-already-paid
6. **Groq Services Agreement** (last modified 2026-06-22): https://console.groq.com/docs/legal/services-agreement
   - §4.2: "Groq is not permitted to use Inputs or Outputs for training or fine-tuning any AI Model Services or other models" unless the customer instructs it.
   - Inputs and Outputs are Customer Data.
7. **Groq, Models:** https://console.groq.com/docs/models
   - gpt-oss-120b and gpt-oss-20b are production models, 131K context, 65K max completion, no deprecation notice.
8. **Free LLM APIs compared** (third-party, updated 2026-09-24): https://openrouter.ai/blog/tutorials/free-llm-apis-compared/
   - OpenRouter free models: 20 RPM, 50/day, or 1,000/day with a $10 top-up.
