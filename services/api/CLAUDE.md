# services/api — FastAPI backend

- Python 3.12+, FastAPI, Pydantic v2, SQLAlchemy 2.x, Alembic. Package manager: **uv** (`uv add`, `uv run`). Never `pip install` into the system.
- Layering: `api/` (thin routers) → `services/` (business rules) → `repositories/` (DB only). Routers never touch the DB directly; repositories never contain business rules.
- **Authorization is enforced server-side on every resource** (FR-01, FR-11): member sees only own data; trainer only assigned members (`trainer_assignments`); everything gym-owned is tenant-scoped by `gym_id`. Every new endpoint ships with a test proving a *different* user gets 403/404.
- Plans are versioned, never overwritten (FR-02, FR-10). Session completion and plan generation accept an `Idempotency-Key` header (blueprint §7).
- **`POST /training-plans/generate` and `Idempotency-Key`:** the key is required and scoped per member. Reusing a key **replays the original plan** (200, `Idempotent-Replayed: true`) regardless of any profile change since: no new generation, no LLM call. To get a plan from an updated profile, send a new key. A second request while one is generating answers 409 `generation_in_progress` (retry later with the same key). The LLM call holds no DB transaction: a claim row (`plan_generation_claims`) is committed first and a claim older than 3 minutes is treated as a dead worker's and taken over.
- **`POST /workout-sessions/{id}/events`:** a repeated event `idempotency_key` is a duplicate and the first stored event wins, even if the payload differs. Those are counted in `conflicting_duplicates` (a subset of `duplicates`) and logged as a count, never the payloads.
- Secrets in `Settings` are `SecretStr` (`groq_api_key`): call `.get_secret_value()` only where the Authorization header is built.
- Concurrency tests (`tests/db/test_concurrency.py`) use real threads, one DB session per request and committed data (`tests/db/concurrency_helpers.py`); the rollback-per-test `api` fixture shares one connection and can't show races.
- AI lives only in `services/coaching`, `services/plans`, `services/nutrition`, behind `services/llm` (ADR-0004). The model gets narrow tools (`get_current_plan`, `generate_plan_draft`, `request_trainer_review`), never raw DB access. All LLM output is parsed into Pydantic models and validated against the catalogue before it is saved or shown.
- Never log raw prompts with personal data, never store video. Log event + ids + latency + token cost.
- `app/schemas/exercise.py` mirrors the zod contract; `tests/test_contract_parity.py` guards drift.
- Commands (from this folder): `uv run pytest`, `uv run ruff check . --fix`, `uv run ruff format .`, `uv run mypy app`, `uv run uvicorn app.main:app --reload`.
