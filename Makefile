.PHONY: setup dev dev-api db test verify ci e2e api-test api-lint

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
