# Torneos isolated baseline v1 — local candidate

**BLOCKED: not a certified release.** Read [REPORT.md](REPORT.md). The SQL installs from an empty database, but preserving all historical functionality requires Core contracts beyond the certified identity-only bridge.

This directory is deliberately separate from the app's `supabase/migrations`: that migration path belongs to the existing Core project. Do not run root `supabase db push`, reset Core, link a project, or deploy this candidate.

The candidate migration is `supabase/migrations/00000000000000_torneos_baseline_v1.sql`. It is one final-state foundation, not a replay installer. The explicit zero-version filename follows the requested baseline convention.

Local prerequisites: Python 3.9+, `pglast==8.3` for AST comparison, Docker Desktop local Unix socket, cached Supabase Postgres image `public.ecr.aws/supabase/postgres:17.6.1.143`. No npm installation or external DB credentials are used. The lab is fixed to container `arma2-torneos-baseline-phase2`, network `none`, with no published ports. A local trust credential is limited to this network-disabled disposable container; it is not a deployment configuration.

From the repository worktree root:

```sh
python3 backend/torneos/tools/lab.py history
python3 backend/torneos/tools/build.py
python3 backend/torneos/tools/install-local.py
python3 backend/torneos/tools/test.py
python3 backend/torneos/tools/compare.py
python3 backend/torneos/tools/check-functions.py
python3 backend/torneos/tools/document.py
```

`history` creates its reference DB and deliberately rejects an existing one. It hash-checks each source before use, provides explicit structural Core/Storage substitutes only to the reference, and records final-object transitions. It is **not** the installation path. The reference Core permission helper always returns false and has no data: the reference is an object-derivation oracle, not proof that all historical Core flows work.

`install-local.py` recreates only the task's fixed `baseline` DB and its NOLOGIN identity-writer role after checking the container's label and network isolation. This drops local test fixtures. It installs only the new migration into `template0`, whose public schema was empty. The second execution fails before object changes and rolls back atomically.

`test.py` writes synthetic fixtures and is intended to run once after each clean install. Its role/claims tests are SQL-level tests, not a new browser/JWT-signature/revocation certification. The Phase 1.5 bridge/app remain untouched.

`compare.py` compares columns, types, defaults, constraints, indexes, policies, function definitions/settings/ACL, and triggers. It normalizes the documented identity boundary, owner-default ACL representation, and parsed equivalent CHECK Boolean grouping. It reports all remaining object differences instead of hiding them. Extension/platform and inactive Storage differences are documented separately.

A future Torneos migration starts after version `00000000000000` in this isolated migration directory. It must enable RLS and grant privileges explicitly. The baseline globally revokes the installer's default function EXECUTE because a schema-scoped revoke cannot remove PostgreSQL's global PUBLIC default. Other future migration-owner roles need the same explicit default-ACL setup.

The NOLOGIN `torneos_identity_writer` role is intended for membership by a separately provisioned local bridge login. It supports the exact Phase 1.5 identity upsert and cannot reassign identity mappings. No login, password, JWKS, gateway, Supabase project, Auth user, scheduler or service deployment is provisioned here. `private.check_token` is the future PostgREST pre-request hook for the same local issuer/audience; signature validation and Core-session revocation still belong to the certified gateway/JWKS flow.
