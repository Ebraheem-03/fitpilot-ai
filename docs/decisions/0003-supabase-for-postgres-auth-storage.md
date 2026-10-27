# ADR-0003: Supabase for Postgres, Auth and object storage

- **Status:** accepted (2026-10-27, after spike S0 #6)
- **Date:** 2026-10-27
- **Requirements:** FR-01, FR-11, NFR-Security, blueprint §5 "managed auth service"

## Context

The blueprint wants PostgreSQL (+ optional pgvector), a managed identity provider to avoid custom auth, and object storage for GLB assets. Budget: free tiers (ADR-0006).

## Options considered

| Option                             | Pros                                                                                  | Cons                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Supabase (free)                    | Postgres 17 + pgvector, Auth (JWT), Storage, RLS, official MCP server for Claude Code | Free projects pause after inactivity; vendor coupling on auth |
| Neon + Clerk + R2                  | Strong DX each                                                                        | Three vendors, three dashboards                               |
| Self-hosted Postgres + custom auth | Full control                                                                          | Highest risk, rejected by blueprint                           |

## Decision

Supabase. FastAPI verifies Supabase JWTs and remains the authorization authority (role, tenant, trainer assignment checks happen in the API, not only in RLS). RLS is enabled as defence in depth. Local dev uses `docker compose up db` (pgvector image) or the Supabase CLI.

### Token verification (verified in spike S0, branch `spike/s0-auth-handoff`)

- The hosted project signs user access tokens with **ES256** (asymmetric signing keys). The dashboard still lists the legacy HS256 secret, but it does not sign user sessions.
- The API verifies tokens against the project's **JWKS** (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`) and requires `exp`, `sub`, `iss = {SUPABASE_URL}/auth/v1` and `aud = authenticated`. Only `ES256`/`RS256` are accepted; `HS256` and `none` are rejected.
- **No shared JWT secret in the API.** Supabase strongly advises against shared-secret verification [1]. `SUPABASE_JWT_SECRET` is removed from config in S3.
- Keys are cached in-process for at most 10 minutes, matching Supabase's edge cache, so rotation and revocation still take effect [1].
- Tests mint ES256 tokens with a local keypair and a fake JWKS client: no network, no Supabase. S0 proved 2 accept cases and 8 reject cases (missing, malformed, expired, wrong issuer, wrong audience, bad signature, unknown `kid`, `alg: none`).

### Web session handling (Next 16)

- `src/proxy.ts` (Next 16's renamed middleware) calls `@supabase/ssr`'s `updateSession` → `auth.getClaims()` to refresh the cookie session. Proxy redirects are optimistic only; the API is the authority.
- Server components read the session server-side and forward `access_token` to FastAPI as `Authorization: Bearer`. The browser never talks to the API with cookies.
- The monorepo has one root `.env`. `next.config.ts` loads it with `loadEnvConfig(root, …, forceReload = true)`, because Next has already loaded and cached `apps/web` env before reading the config.
- Use the **publishable key** (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), not the legacy JWT-based anon key (S6).

### CI end-to-end auth

Run the **local Supabase CLI stack in CI** (`supabase/setup-cli` → `supabase start`) with an ES256 signing key generated at job time (`supabase gen signing-key`, never committed), so CI exercises the same asymmetric path as production [2]. A dedicated hosted test project was rejected:

- it needs repository secrets, which fork PRs can't use;
- it fills the real project with test users;
- free-tier auth rate limits would make it flaky.

_Not yet proven in CI; S6 (#12) must demonstrate it._

## Consequences

- Schema managed by Alembic in `services/api` (single migration source of truth); do not edit tables in the Supabase dashboard.
- Supabase's Data API exposes the `public` schema to the anon/publishable key, so **every table gets RLS enabled with no policies** (default-deny). S2 asserts this in a test.
- Authorization tests must cover member↔member and trainer↔unassigned-member denial (FR-01, FR-11 acceptance criteria).
- Don't revoke the legacy HS256 secret while any legacy JWT-based anon/service_role key is still in use. Migrate to publishable/secret keys first.
- Open item for S6: with `cacheComponents: true`, the session-reading route logged "unstable value `Date.now()` while prerendering". Auth-dependent server components must opt out of prerendering explicitly.

## Sources (checked 2026-10-27)

1. Supabase — JWTs, verifying a JWT: https://supabase.com/docs/guides/auth/jwts
2. Supabase CLI — `supabase gen signing-key` (ES256 recommended): https://supabase.com/docs/reference/cli/supabase-gen-signing-key
