#!/usr/bin/env bash
# Playwright e2e against a LOCAL Supabase stack + local API (ADR-0003).
# Exported env overrides the root .env, so hosted projects are never touched.
# Usage: scripts/e2e.sh [playwright args...]
set -euo pipefail
cd "$(dirname "$0")/.."

keys=supabase/signing_keys.json
if ! grep -q '"ES256"' "$keys" 2>/dev/null; then
  echo '[]' > "$keys"
  pnpm exec supabase gen signing-key --algorithm ES256 --append
fi
pnpm exec supabase start

status="$(pnpm exec supabase status -o env)"
sb() { printf '%s\n' "$status" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }

export NEXT_PUBLIC_SUPABASE_URL="$(sb API_URL)"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(sb PUBLISHABLE_KEY)"
export SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL"
db_url="$(sb DB_URL)"
export DATABASE_URL="postgresql+psycopg://${db_url#postgresql://}"
export CORS_ORIGINS="http://localhost:3100"
export LLM_PROVIDER=fake

(cd services/api && uv run alembic upgrade head)
pnpm --filter @fitpilot/web exec playwright test "$@"
