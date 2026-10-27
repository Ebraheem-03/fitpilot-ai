# Local development (macOS)

Prereqs: Node 22+, pnpm (`corepack enable`), uv (`brew install uv`), Docker Desktop (optional, for local Postgres), GitHub CLI (`brew install gh`).

```bash
cp .env.example .env          # fill values; never commit .env
make setup                    # pnpm install + uv sync
make db                       # optional: local Postgres 17 + pgvector on :5432
make dev                      # web → http://localhost:3000
make dev-api                  # api → http://localhost:8000/docs
make verify                   # format, lint, typecheck, unit + integration tests
make ci                       # verify + web build + Playwright e2e (exactly what CI runs)
```

`make ci` needs Chromium for Playwright once: `pnpm --filter @fitpilot/web exec playwright install chromium`.

### Docker troubleshooting

Docker Desktop must have been launched once (`open -a Docker`) and be running before `make db`.

- `failed to connect to the docker API … docker.sock` → the engine isn't running, or the CLI points at the wrong context. Start Docker Desktop, then `docker context use desktop-linux`.
- `unknown shorthand flag: 'd' in -d` → the Compose plugin isn't linked (`docker compose` is unknown). Launch Docker Desktop once; if it persists:
  `mkdir -p ~/.docker/cli-plugins && ln -sfn /Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose ~/.docker/cli-plugins/docker-compose`
- Check: `docker compose ps` shows `db … (healthy)`.

Camera testing: Safari and Chrome both need `localhost` or HTTPS for `getUserMedia`. To test on an iPhone on the same Wi-Fi, run `pnpm --filter @fitpilot/web dev --experimental-https` and open the Mac's LAN IP; accept the certificate warning.

Regenerating contracts after editing `packages/exercise-contracts`:

```bash
pnpm --filter @fitpilot/exercise-contracts export:jsonschema
cd services/api && uv run pytest tests/test_contract_parity.py
```
