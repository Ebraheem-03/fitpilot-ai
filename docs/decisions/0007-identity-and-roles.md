# ADR-0007: Identity mapping and application roles

- **Status:** proposed (confirm when S3 #9 lands)
- **Date:** 2026-10-27
- **Requirements:** FR-01, FR-11, NFR-Security, NFR-Privacy

## Context

Supabase Auth (ADR-0003) owns credentials and issues tokens whose `sub` is a stable user UUID. FitPilot needs application roles (member, trainer, gym admin, platform admin; blueprint §2) and must let trainers and admins act only within their scope. The token's `role` claim is the **Postgres** role (`authenticated`), not an application role, so it can't be used for app authorization. We have to decide where app roles live and how auth users become `users` rows.

## Options considered

| Option                                                         | Pros                                                                                                                | Cons                                                                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Roles in our `users` table; API is the authority**           | One source of truth, next to `gym_memberships`/`trainer_assignments`; role changes apply immediately; easy to audit | One DB read per request (indexed PK lookup)                                                                                                                                  |
| Roles as custom JWT claims (Supabase Custom Access Token hook) | No DB read to know the role                                                                                         | Stale until the token refreshes (a demoted trainer keeps access for up to the token TTL); authority split between Supabase and the API; trainer/gym scope still needs the DB |
| Roles in Supabase `app_metadata`                               | Editable in the dashboard                                                                                           | Same staleness; a second admin surface outside our audit trail                                                                                                               |

## Decision

- `users.id` **is** the Supabase `sub` (UUID primary key). No separate internal id, and no email or name copied into our DB: Supabase holds credentials and contact data (data minimisation).
- `users.role` is an enum (`member`, `trainer`, `gym_admin`, `platform_admin`), default `member`. The API reads it per request, together with `status` (`active`, `suspended`). JWT claims other than `sub` are never used for authorization.
- **Just-in-time provisioning:** the first authenticated API call creates the `users` row (`INSERT … ON CONFLICT (id) DO NOTHING`), which is idempotent under concurrent first requests.
- Signing up always produces a `member`. In M0, elevated roles are granted only by a seed/admin script. From M5 they go through an admin endpoint that writes an `audit_events` row (FR-11).
- Trainer and gym-admin scope comes from `trainer_assignments` / `gym_memberships`, never from the role alone.

## Consequences

- S3 tests: provisioning happens once; a token with a forged `app_metadata`/`role` claim doesn't change the app role; a `suspended` user gets 403.
- Deleting a Supabase user leaves an orphaned `users` row. The FR-01 export/deletion workflow (M5) must delete our rows too, and provisioning must never resurrect a deleted user (track tombstones by `sub`).
- Role checks live in one dependency (`require_role(...)`), so every endpoint states its required role explicitly.
