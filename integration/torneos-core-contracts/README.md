# Phase 3A — Real Core contracts → isolated Torneos (local lab)

Non-production end-to-end laboratory for the three Core contracts Torneos needs
(verified email, directory, frozen team snapshot). Everything runs on this machine.

Branch `claude/torneos-phase3a-core-contracts-ac1d84` on `b5c5d4af` (Phase 2B).

## What is real here

| Piece | Source | Runtime |
|---|---|---|
| Core schema | `supabase/migrations/*.sql` (all 42, applied as `postgres`) | `supabase/postgres:17.6.1.143` |
| Core sessions | real GoTrue (`/signup`, `/token`, `/user`, `/logout`, admin API) | `supabase/gotrue:v2.194.0` |
| Core endpoint | `supabase/functions/torneos-core-contract/index.ts` + `_shared/torneosCoreContract.ts` | `supabase/edge-runtime:v1.74.2` |
| Core SQL | `public.torneos_contract_execute` (migration `20260914120000_torneos_core_contract_v1.sql`) | PostgREST `v14.15` as `service_role` |
| Torneos | `backend/torneos/supabase/migrations/` applied in order: baseline `00000000000000` (Phase 2D `f857bd09…`) + staging v1 RPC exposure gate `00000000000001` | PostgREST `v14.15` + JWKS |
| Identity bridge | `integration/torneos-sso/token.mjs` mounted verbatim; `gateway.mjs` = Phase 1.5 `server.mjs` + 4 RPC routes + Phase 2D staging v1 RPC allowlist (`backend/torneos/phase2d/staging-v1-rpc-allowlist.json`, mounted read-only) | node 22 |
| Adapter | `adapter.mjs` (real counterpart of `backend/torneos/phase2b/adapter.py`) + `core-client.mjs` (Node port of Phase 2A `CoreClient`) | node 22 |

Only the gateway is published (`127.0.0.1:58420`). Databases, Auth, REST and the
Edge Function are on an internal network. `core-functions` alone has outbound access,
solely so Deno can resolve the function's remote imports (as the hosted edge platform
does). `core-api.mjs` is the Kong substitute the Edge Function's supabase-js talks to.

## Reproduce

```sh
npm ci --prefix integration/torneos-core-contracts --ignore-scripts
npm --prefix integration/torneos-core-contracts run up
npm --prefix integration/torneos-core-contracts test
npm --prefix integration/torneos-core-contracts run test:acl        # Phase 2C ACL certification
npm --prefix integration/torneos-core-contracts run test:exposure   # Phase 2D staging RPC exposure gate
node --test scripts/edge-functions/torneos-core-contract.test.mjs
npm --prefix integration/torneos-core-contracts run down      # keeps volumes
npm --prefix integration/torneos-core-contracts run destroy   # drops volumes
```

Requires Docker Desktop. The suite is re-runnable on a lab that keeps earlier runs'
data (every fixture carries a per-run tag). Secrets (DB passwords, Core JWT secret,
service key, contract secret, RS256 keys) are generated into `.runtime/` (ignored);
the gateway only receives what it needs (`.runtime/server/config.json`).

## Evidence

`evidence/e2e-results.json`, `evidence/e2e-tests.txt` (40 checks, all PASS after Phase 2C),
`evidence/core-unit-tests.txt` (15/15), `evidence/install.json` (migration hashes),
`evidence/gateway-vs-phase15.diff`, `evidence/finding-p3a-f1.json` (P3A-F1 CLOSED in Phase 2C) and
`evidence/finding-p3a-f1-anon-sweep.json`. Phase 2C ACL certification: `npm run test:acl`
(`evidence/acl-*.json`). Phase 2D exposure gate: `npm run test:exposure` (`evidence/exposure-*.json`:
ACL before/after of the 33, P0 actor matrix, direct PostgREST and gateway sweeps). Reports:
`backend/torneos/phase3a/REPORT.md`, `backend/torneos/phase2c/REPORT.md`, `backend/torneos/phase2d/REPORT.md`.
