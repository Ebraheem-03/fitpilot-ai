.PHONY: setup dev dev-api db test verify ci e2e api-test api-lint bench-phone eval-ai

# make eval-ai: live plan-generation eval (ADR-0006). Override e.g. `make eval-ai EFFORT=medium RUNS=1`.
EVAL_MODEL ?= openai/gpt-oss-120b
EFFORT ?= low
RUNS ?= 2
ENV_FILE ?= $(CURDIR)/.env

setup:            ## install all deps (JS + Python)
	pnpm install
	cd services/api && uv sync

db:               ## start local Postgres+pgvector
	docker compose up -d --wait db

dev:              ## web on :3000
	pnpm dev

dev-api:          ## api on :8000
	cd services/api && uv run uvicorn app.main:app --reload --port 8000

api-test: db       ## needs local Postgres for integration tests (tests/db)
	cd services/api && uv run pytest -q

api-lint:
	cd services/api && uv run ruff check . && uv run ruff format --check . && uv run mypy app

test:             ## all tests
	pnpm test
	$(MAKE) api-test

verify:           ## format + lint + typecheck + unit/integration tests (JS + Python)
	pnpm verify
	$(MAKE) api-lint api-test

e2e:              ## Playwright vs local Supabase stack + local API (Docker; never hosted projects)
	scripts/e2e.sh

ci: verify        ## everything CI runs: verify + web build + e2e (needs `playwright install chromium`)
	pnpm --filter @fitpilot/web build
	$(MAKE) e2e

bench-phone:      ## serve /dev/pose-bench on your Wi-Fi for an on-device run (ADR-0010); Ctrl-C stops it. Rebuilds .next: stop `make e2e` first
	cd apps/web && NEXT_PUBLIC_DEV_TOOLS=1 pnpm build
	@printf '\nOn your phone (same Wi-Fi) open: http://%s:3300/dev/pose-bench\n\n' "$$(ipconfig getifaddr en0 || hostname -I | cut -d' ' -f1)"
	cd apps/web && NEXT_PUBLIC_DEV_TOOLS=1 pnpm exec next start -H 0.0.0.0 -p 3300

eval-ai:          ## LIVE plan-generation eval vs Groq (~2.5K tokens/plan of the 200K/day free tier); never in CI. Writes docs/evaluation/plans-<prompt_version>.{md,json}
	cd services/api && uv run python -m app.services.evaluation.plans --mode live \
		--model $(EVAL_MODEL) --effort $(EFFORT) --runs $(RUNS) --env-file $(ENV_FILE); \
		status=$$?; cd $(CURDIR) && pnpm exec prettier --log-level warn --write 'docs/evaluation/plans-*.{md,json}'; exit $$status
