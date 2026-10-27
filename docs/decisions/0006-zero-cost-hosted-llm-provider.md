# ADR-0006: Zero-cost hosted LLM provider (Groq free tier) behind the ADR-0004 abstraction

- **Status:** proposed (confirm at M3 start, after the provider spike)
- **Date:** 2026-10-27
- **Requirements:** FR-02, FR-08, FR-09, FR-13, NFR-Privacy, blueprint §9–10
- **Amends:** ADR-0004 ("providers (Anthropic first)") — the abstraction, validation and budget rules of ADR-0004 are unchanged

## Context

The project is a portfolio build with a hard **$0 running-cost** constraint. ADR-0004 defaulted to the Anthropic API, which has no free tier (pay-as-you-go, separate from a Claude subscription). The deployed demo runs on free hosts (ADR-0005) that cannot run a local model, so local-only inference (Ollama) does not cover the public demo.

Constraints any provider must meet:

- **Structured output** strong enough for plan/nutrition generation (FR-02, FR-08): every result is parsed into Pydantic and validated against the catalogue (ADR-0004).
- **Privacy** (principle 5, NFR-Privacy): prompts contain profile context, which is health-adjacent. The provider must not train on it or put it in front of human reviewers.
- **Lawful to serve the demo's audience**, which includes reviewers and recruiters in the EEA/UK.
- **Free limits** must be enough for a demo plus a small eval suite, not production traffic.

## Options considered

| Option                     | Pros                                                                                                                                                                                                                         | Cons                                                                                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do nothing (Anthropic API) | Strongest structured output + tool use; ADR-0004 as written                                                                                                                                                                  | Not $0, which fails the constraint outright                                                                                                                                                                                                        |
| **Groq free tier**         | No card needed; no inference data retained by default, and Zero Data Retention can be enabled by all customers [1]; strict JSON-schema output on `openai/gpt-oss-120b` / `-20b` [2]; OpenAI-compatible API; very low latency | Rate limits per organisation (e.g. ~30 RPM, ~1,000 req/day on larger models; exact values only in the console) [3]; strict structured output cannot be combined with tool use or streaming [2]; open-weight models are weaker than frontier models |
| Gemini API free tier       | Generous limits, good models                                                                                                                                                                                                 | Free-tier content is used to improve Google products and may be read by human reviewers; terms say not to submit personal info; **only paid services may serve users in the EEA, Switzerland or UK** [4]. This rules it out for a public demo      |
| OpenRouter `:free` models  | Many models, one API                                                                                                                                                                                                         | 50 requests/day without a credit purchase [5]; upstream providers and their logging terms vary per model; capacity can disappear                                                                                                                   |
| Local Ollama only          | Truly private, $0, offline                                                                                                                                                                                                   | Can't run on free API hosts, so the deployed demo would have no AI; slower on a laptop                                                                                                                                                             |

## Decision

1. **Default hosted provider: Groq free tier.** `LLM_PROVIDER=groq`, `LLM_MODEL=openai/gpt-oss-120b` (strict structured output). Enable Zero Data Retention in the Groq console before any real profile data flows.
2. **`fake` provider** for unit tests, CI and the AI eval runner's offline mode: deterministic canned responses keyed by fixture. CI never calls a live model.
3. **Optional `ollama` provider** for private local development, using the same OpenAI-compatible client.
4. **`LLM_MONTHLY_BUDGET_USD=0`** by default. Because the guard fails closed (ADR-0004), a misconfigured paid provider is refused rather than billed.
5. **Respect the tool-use limitation.** Groq can't combine strict structured output with tool calls [2]. Write paths (plan and nutrition drafts) therefore use single-shot structured output with no tools. The coaching assistant (FR-09) runs a tool-calling loop whose tool _arguments_ are validated by Pydantic server-side, with no strict schema on the reply.
6. **Anthropic stays implementable** behind the same interface, one env change away, if the project ever gets a budget.

## Consequences

- AI features cost $0; the budget guard and `fake` provider make accidental spend and CI flakiness unlikely.
- Weaker open-weight models make the validate → repair once → escalate loop (FR-02) do more work. The M3 eval suite must report validity rate and repair rate per model, and that evidence decides whether this ADR is accepted.
- Rate limits need handling: a 429 must map to a clear "coach is busy, try again" state, never a fabricated answer (principle 3), and must be logged as an FR-13 event.
- Demo data should still be synthetic where practical. ZDR covers retention, but the public demo should not invite real health details.
- Free-tier terms change. Re-check [1]–[4] before M3 and before any public launch.

## Sources (checked 2026-10-27)

1. Groq — Your data: https://console.groq.com/docs/your-data
2. Groq — Structured outputs: https://console.groq.com/docs/structured-outputs
3. Free LLM APIs compared (third-party, limits indicative only): https://openrouter.ai/blog/tutorials/free-llm-apis-compared/
4. Gemini API Additional Terms of Service: https://ai.google.dev/gemini-api/terms
5. OpenRouter free-tier limits (third-party summary): https://www.truefoundry.com/es/blog/openrouter-rate-limits-your-free-tier-depends-on-what-youve-already-paid
