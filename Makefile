.PHONY: setup dev dev-api db test verify api-test api-lint

setup:            ## install all deps (JS + Python)
	pnpm install
	cd services/api && uv sync

db:               ## start local Postgres+pgvector
	docker compose up -d db

dev:              ## web on :3000
	pnpm dev

dev-api:          ## api on :8000
	cd services/api && uv run uvicorn app.main:app --reload --port 8000

api-test:
	cd services/api && uv run pytest -q

api-lint:
	cd services/api && uv run ruff check . && uv run ruff format --check .

test:             ## all tests
	pnpm test
	$(MAKE) api-test

verify:           ## everything CI runs
	pnpm verify
	$(MAKE) api-lint api-test
