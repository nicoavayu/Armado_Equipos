> ERROR-CONTRACT-V1: see [error-contract-v1/REPORT.md](error-contract-v1/REPORT.md). Status: **TORNEOS_DOMAIN_ERROR_MAPPING_LOCAL_CERTIFIED** — expected domain errors answer 409 / 422 / 429 (migration `00000000000006_domain_error_contract.sql`, PostgREST `PTxyz`; no domain 40001 left, so no retry storm), the gateway maps legacy 55000/54000 domain errors, and the transport keeps the bearer and the functional code instead of «Torneos no disponible». Certified locally on Node and Edge gateways; **nothing applied remotely**.

> OFFICIALIZATION-V1: see [officialization-v1/REPORT.md](officialization-v1/REPORT.md). Status: **TORNEOS_RESULT_OFFICIALIZATION_LOCAL_CERTIFIED** — dual control becomes an optional per-tournament policy (default OFF: a single owner/admin can take a result to official) and organizations gain real membership (invite by email → accept with the Core verified email → roles / removal). Migration `00000000000005_officialization_v1.sql`, gateway `officialization-v1-rpc-allowlist.json`, frontend members / invitation / dual-control UI. Certified locally on Node and Edge gateways; **nothing applied remotely**.
>
> COMPETITION-V1: see [competition-v1/REPORT.md](competition-v1/REPORT.md). Status: **TORNEOS_FULL_COMPETITION_LOCAL_CERTIFIED** — full competition contract for the hybrid composition (migration `00000000000004_competition_v1_rpc_exposure.sql`, gateway `competition-v1-rpc-allowlist.json` + public read-only route, frontend map). Certified locally on Node and Edge gateways; **nothing applied remotely** — Phase G (Torneos Production) awaits an explicit go.

> Phase 2D: see [phase2d/REPORT.md](phase2d/REPORT.md). Status: **A) STAGING RPC EXPOSURE GATE PASS** — `review_tournament_team_entry` certified on the real stack (season rule R3-2D), the other 32 INCONCLUSIVE RPCs plus their one parent path server-side disabled for staging v1 (`supabase/migrations/00000000000001_staging_v1_rpc_exposure.sql` + gateway allowlist `phase2d/staging-v1-rpc-allowlist.json`). Phase 2C (real Supabase ACL hardening, P3A-F1 closed): [phase2c/REPORT.md](phase2c/REPORT.md).

> Phase 2B: see [phase2b/REPORT.md](phase2b/REPORT.md). Status: **A) CLEAN TORNEOS BASELINE PASS** against the Phase 2A local Core contract. Real Core endpoint implementation remains pending and is required before Production. Phase 2A history: [phase2a/REPORT.md](phase2a/REPORT.md).

# Torneos isolated baseline v1 — local candidate

**Locally certified baseline candidate (Phase 2B).** Read [phase2b/REPORT.md](phase2b/REPORT.md) and the historical [REPORT.md](REPORT.md). The SQL installs from an empty database; the four Core-dependent RPCs are wired to a server-attested contract boundary whose Core side is the Phase 2A local implementation, not a real Core endpoint.

This directory is deliberately separate from the app's `supabase/migrations`: that migration path belongs to the existing Core project. Do not run root `supabase db push`, reset Core, link a project, or deploy this candidate.

The candidate migration is `supabase/migrations/00000000000000_torneos_baseline_v1.sql`. It is one final-state foundation, not a replay installer. The explicit zero-version filename follows the requested baseline convention.

Local prerequisites: Python 3.9+, `pglast==8.3` for AST comparison, Docker Desktop local Unix socket, cached Supabase Postgres image `public.ecr.aws/supabase/postgres:17.6.1.143`. No npm installation or external DB credentials are used. The lab is fixed to container `arma2-torneos-baseline-phase2`, network `none`, with no published ports. A local trust credential is limited to this network-disabled disposable container; it is not a deployment configuration.

From the repository worktree root:

```sh
python3 backend/torneos/tools/lab.py history
python3 backend/torneos/tools/build.py
python3 backend/torneos/phase2b/run.py
```

`phase2b/run.py` recreates the baseline DB from `template0`, runs every suite (baseline checks, Phase 2A contracts, temp-relation and season probes, the real Core-wiring suite, the season-scope sweep, the SECURITY DEFINER semantic review, the inventory, the equivalence and seed comparisons, the static analyzer) and computes the conclusion in `phase2b/results.json`. The individual tools remain runnable (`install-local.py`, `test.py`, `compare.py`, `check-functions.py`, `document.py`).

`history` creates its reference DB and deliberately rejects an existing one. It hash-checks each source before use, provides explicit structural Core/Storage substitutes only to the reference, and records final-object transitions. It is **not** the installation path. The reference Core permission helper always returns false and has no data: the reference is an object-derivation oracle, not proof that all historical Core flows work.

`install-local.py` recreates only the task's fixed `baseline` DB and its NOLOGIN identity-writer role after checking the container's label and network isolation. This drops local test fixtures. It installs only the new migration into `template0`, whose public schema was empty. The second execution fails before object changes and rolls back atomically.

`test.py` writes synthetic fixtures and is intended to run once after each clean install. Its role/claims tests are SQL-level tests, not a new browser/JWT-signature/revocation certification. The Phase 1.5 bridge/app remain untouched.

`compare.py` compares columns, types, defaults, constraints, indexes, policies, function definitions/settings/ACL, and triggers. It normalizes the documented identity boundary, owner-default ACL representation, and parsed equivalent CHECK Boolean grouping. It reports all remaining object differences instead of hiding them. Extension/platform and inactive Storage differences are documented separately.

A future Torneos migration starts after version `00000000000000` in this isolated migration directory. It must enable RLS and grant privileges explicitly. The baseline globally revokes the installer's default function EXECUTE because a schema-scoped revoke cannot remove PostgreSQL's global PUBLIC default. Other future migration-owner roles need the same explicit default-ACL setup.

The NOLOGIN `torneos_core_adapter` role (Phase 2B) is the server's append-only path for Core contract attestations: it can only insert into `private.core_contract_attestations` and execute `private.authorize_core_contract`; it cannot read domain tables or call domain RPCs. The historical Core-dependent RPCs consume those attestations once, bound to the caller's identity, Core session and exact request.

The NOLOGIN `torneos_identity_writer` role is intended for membership by a separately provisioned local bridge login. It supports the exact Phase 1.5 identity upsert and cannot reassign identity mappings. No login, password, JWKS, gateway, Supabase project, Auth user, scheduler or service deployment is provisioned here. `private.check_token` is the future PostgREST pre-request hook for the same local issuer/audience; signature validation and Core-session revocation still belong to the certified gateway/JWKS flow.
