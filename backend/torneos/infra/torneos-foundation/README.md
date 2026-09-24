# INFRA-1 R3 — Staging retirement + Arma2 Torneos Supabase foundation

This is operator-run tooling for one sequence:

1. Pause Core Staging `hhyvmhgpapyuzjgxfnqv`.
2. Create **exactly one** Free project, **Arma2 Torneos**, in org `gwqrborhnqjdzzmpxulh`, region `sa-east-1`.
3. Apply **exclusively** Torneos migrations 0000–0003 to it.
4. Certify the result read-only.

It never touches Core Production (`rcyuuoaqfwcembdajcss`) beyond two GETs. It never deploys a function, never writes a secret, and never connects Mercado Pago.

```
run-foundation.sh --staging-prepause    READ-ONLY PAT
run-foundation.sh --pause-staging       temporary WRITE PAT (projects:write) + phrase
run-foundation.sh --create-preflight    READ-ONLY PAT
run-foundation.sh --create-project      temporary WRITE PAT (projects:write) + phrase
run-foundation.sh --migrate             READ-ONLY PAT + phrase (the DB write is psql with the Keychain password)
run-foundation.sh --certify             READ-ONLY PAT
```

## What is pinned (`foundation-contract.mjs`), never an argument

| Pin | Value |
|---|---|
| Refs | Production `rcyuuoaqfwcembdajcss`, Core Staging `hhyvmhgpapyuzjgxfnqv`, old `giaeztyghmhzcngskjmw` |
| Organization | `gwqrborhnqjdzzmpxulh` |
| Project name | `Arma2 Torneos` |
| Region | `sa-east-1` |
| Create body | `{organization_slug, name, region_selection:{type:specific, code:sa-east-1}, db_pass}`, exactly these keys. No plan, no instance size (so the smallest), no template, no add-on. |
| Migrations | 0000 `f857bd09…`, 0001 `3df4b96e…`, 0002 `06378f12…`, 0003 `d54b3293…`. The migrations directory must hold exactly these four files. Each file is re-hashed right before psql reads it. |
| Keychain | `arma2-torneos-dataplane-db` / `postgres`. Disjoint from every Core, Staging and non-prod entry. |
| Core contract | `torneos-core-contract` ezbr `10724195…` (INFRA-1 harness-only certification) |

## Endpoint allowlist (`ENDPOINTS` + `classifyRequest`)

- **Production:** only `GET /v1/projects/rcyuuoaqfwcembdajcss` and `GET …/functions/torneos-core-contract`.
- **Old project:** `GET /v1/projects/giaeztyghmhzcngskjmw` only.
- **Reads:** GETs of org, projects, available regions (`continent=SA`), project, functions, branches, health, pooler, third-party-auth, auth config, PostgREST config, api-keys (`reveal=false`), secrets, and the migrations list. `POST …/database/query` is allowed only with exactly `{query, read_only:true}` and one SELECT, with no write verb and no side-effect function.
- **Write 1:** `POST /v1/projects/hhyvmhgpapyuzjgxfnqv/pause`, with no body, only on a client armed for `pause` (`--pause-staging`).
- **Write 2:** `POST /v1/projects` with the exact pinned body, only on a client armed for `create` (`--create-project`).
- Everything else is refused before the socket: DELETE, PATCH, PUT, restore, secrets writes, function deploy, `reveal=true`, and unknown refs.

## Confirmations

Each write mode prints its plan and plan id (the first 12 hex of the plan's sha256), then reads one exact phrase from `/dev/tty`:

- `PAUSE CORE STAGING hhyvmhgpapyuzjgxfnqv <plan id>`
- `CREATE ARMA2 TORNEOS gwqrborhnqjdzzmpxulh sa-east-1 <plan id>`
- `APPLY TORNEOS MIGRATIONS 0000-0003 <ref> <plan id>`

After the phrase the state is observed again. A different plan id stops the run (`STATE_CHANGED_SINCE_PLAN`). There is no `--force`, `-y` or `--yes`, and CI and non-tty runs are refused.

## Secrets

- **PAT:** read by the wrapper from `/dev/tty` with echo off and piped to node through the `printf` builtin. It never goes to argv, env or a file.
- **DB password:** generated inside `keychain-foundation.py` (`secrets.token_urlsafe(30)`, 40 characters) and stored through a pty. The runner reads it with `security find-generic-password -w`. It exists only in the POST body and in the `PGPASSWORD` of the psql child, whose environment is minimal and built by the runner.
- **API keys:** the publishable (or legacy anon) key used by the PostgREST probe is public by design, but it is never written.
- **Evidence:** every evidence file is scanned for known values and secret shapes before it is written (`EVIDENCE_REJECTED_SECRET_LEAK`), with mode 0600, and never overwritten.

## Certification (`--certify`)

- **Catalog:** one read-only SELECT (`CATALOG_SQL`) is compared on 33 strict paths with `pins/expected-catalog.json`. The pin is derived by `offline-rehearsal.mjs` from `supabase/postgres:17.6.1.147` after 0000–0003, installed as non-superuser `postgres` like the hosted installer. The strict paths cover roles, memberships, tables, RLS, policies, functions, bodies, EXECUTE and table-privilege matrices per API role, watermark, provider ordering, audit triggers, identity gate, pre-request, and DB-to-DB objects.
- **Invariants checked independently of the pin:**
  - `torneos_payment_service` has exactly 4 EXECUTE;
  - the watermark has RLS, 0 API privileges, `requires_manual_review` and `date_last_updated`;
  - provider ordering is in place;
  - both append-only audit triggers exist;
  - the bridge issuer is pinned in `current_identity_id`;
  - every public table has RLS;
  - there are 0 Torneos LOGIN roles, 0 procedures and 0 functions executable by PUBLIC;
  - there is no FDW/dblink;
  - anon has no privilege on any internal table.
- **Platform:**
  - 0 Edge Functions and only `SUPABASE_*` secrets;
  - 0 `auth.users`;
  - the migrations-API ledger is empty (psql does not write it);
  - no third-party auth, so B03 is classified;
  - no private schema exposed by PostgREST;
  - Core Production is unchanged and Core Staging is INACTIVE.
- **PostgREST** at `https://<ref>.supabase.co/rest/v1`, with no user and no fixture:
  - no apikey → 401;
  - anon on the 4 internal tables → denied;
  - anon on a public-page table → 200 (RLS-filtered);
  - `Accept-Profile: private` → 406/denied;
  - anon on 4 RPCs it cannot execute → denied (POST is only allowed for this set);
  - forged HS256 `service_role`, `alg=none` and an ephemeral-key RS256 bridge-shaped token → 401;
  - the OpenAPI root does not describe internal objects.

## Tests and rehearsal

```
node --test backend/torneos/infra/torneos-foundation/foundation.test.mjs
node backend/torneos/infra/torneos-foundation/offline-rehearsal.mjs
```

The rehearsal (Docker, `--pull never`, DB on an `--internal` network) drives the real runner through all six modes against an emulated control plane. It runs real psql for 0000→0003 and a real local PostgREST v14.15 (no pre-request, as hosted after 0000–0003) behind an emulated apikey gateway. It also runs:

- negative controls: a tampered grant fails the certification;
- a foreign-token proof: a JWT a Torneos-project GoTrue would mint cannot reach identity data, and a NULL-argument sweep of every `authenticated` function writes nothing.

## Not in this tooling (later phases)

- Gateway LOGIN roles (`torneos_edge_identity_writer` / `torneos_edge_core_adapter`), the payments login, and `pgrst.db_pre_request = private.check_token`. These are gateway/payments bootstrap, not migrations 0000–0003.
- `custom_jwks` (B03). It needs the bridge key ring of the Deno gateway, which does not exist yet.
- Deno Deploy, Mercado Pago, the frontend.
