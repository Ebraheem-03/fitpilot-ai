# Local development (macOS)

Prereqs: Node 22+, pnpm (`corepack enable`), uv (`brew install uv`), Docker Desktop (optional, for local Postgres), GitHub CLI (`brew install gh`).

```bash
cp .env.example .env          # fill values; never commit .env
make setup                    # pnpm install + uv sync
make db                       # optional: local Postgres 17 + pgvector on :5432
make dev                      # web → http://localhost:3000
make dev-api                  # api → http://localhost:8000/docs
make verify                   # what CI runs
```

Camera testing: Safari and Chrome both need `localhost` or HTTPS for `getUserMedia`. To test on an iPhone on the same Wi-Fi, run `pnpm --filter @fitpilot/web dev --experimental-https` and open the Mac's LAN IP; accept the certificate warning.

Regenerating contracts after editing `packages/exercise-contracts`:

```bash
pnpm --filter @fitpilot/exercise-contracts export:jsonschema
cd services/api && uv run pytest tests/test_contract_parity.py
```
