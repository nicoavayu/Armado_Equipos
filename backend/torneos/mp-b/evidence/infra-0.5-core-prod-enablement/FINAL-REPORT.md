# ARMA2_TORNEOS_INFRA_0_5_CORE_PROD_ENABLEMENT — final report

**Verdict: CORE_PROD_DEPLOY_TOOLING_READY**

Everything in this phase was local:
- 0 remote calls and 0 remote writes;
- no Supabase CLI;
- the real macOS Keychain was never read or written;
- no PAT was typed.

State after this phase:
- Core Production is unchanged.
- Core Staging is not paused.
- Arma2 Torneos was not created.
- INFRA-1 was not run.

## Base

The work is on branch `claude/torneos-core-prod-contract-enablement`, created from `d62039c7`, in worktree `/Users/nicoavayu/Downloads/arma2/arma2-core-prod-contract-enablement`. The commit is a single one on top of `d62039c7`.

The original worktree `/Users/nicoavayu/Downloads/arma2/arma2` is intact:
- HEAD is `0a25998f`;
- `git status --porcelain` has the same sha256 `bc9365ae…` before and after;
- it has 4 entries.

## Files

| Tooling (`backend/torneos/infra/core-prod-contract/`) | Role |
|---|---|
| `prod-contract.mjs` | The contract as data: target, 2 migrations, ledger model, prerequisites, `app_private`, catalog digest, artifact, custody, phrase, evidence gate |
| `mgmt-prod.mjs` | Production-only transport. Closed read allowlist; writes must be armed and pinned |
| `core-prod-deploy.mjs` | Runner: `--preflight-only`, `--dry-run`, `--apply`, `--acl-only` |
| `deploy-core-contract-prod.sh` | Operator wrapper. Needs a tty, has no default mode, refuses flags and CI |
| `keychain-prod.py`, `keychain-prod.mjs` | Production Keychain custody: `check` and `generate` only |
| `probe-prod.mjs` | The certified 9-answer harness, pointed at the Production endpoint |
| `pins/production-ledger-baseline.json`, `derive-ledger-baseline.mjs` | Pinned 236-row ledger digests and how to reproduce them |
| `core-prod.test.mjs`, `offline-rehearsal-prod.mjs` | Tests and the real-Postgres rehearsal |
| `README.md` | INFRA-1 runbook |

The evidence is in this directory, files 00–10, plus the test outputs and the rehearsal.

The certified Staging tooling (`phase3b/remote/*`, 12 files) is byte-identical to d62039c7. The runner checks this before anything else.

## Authorized migration hashes

| Version | File sha256 | Apply SQL sha256 | Ledger row |
|---|---|---|---|
| `20260914120000_torneos_core_contract_v1` | `2967ae6f67e36877c4931cb7821535eab10c5b7312026846f619b14fb045672c` | `3d3e2845987ccdfd74b77ace51195865234066bb5828280fb0c8114969b84485` | 22 stmts, md5 `09ad7d26…`, 16688 B |
| `20260915120000_torneos_core_contract_v1_1_session` | `5256413839ad0abe9c9533a675461cc6589fd720e6b2bede3bc8d201a75ce422` | `859fa7a30dee4a03376a662ab74427927c6a8b8a404556abdd3bfa59e5e5b78c` | 3 stmts, md5 `b424cc66…`, 12088 B |

Both are equal to the certified Staging pins. The plan must be exactly these two migrations, in this order. The transport rejects any other write SQL, including a ledger-only INSERT.

## Production target guard

The target is pinned by identity:
- ref `rcyuuoaqfwcembdajcss`;
- name "nicoavayu's Project";
- org `gwqrborhnqjdzzmpxulh`;
- region `sa-east-1`;
- created_at `2025-06-30T20:57:55.045023Z`, from the R1 inventory `502c2c69…`;
- status must be `ACTIVE_HEALTHY`.

The tooling takes no ref input. Every request path must be the Production ref. It rejects:
- the Staging ref in a path, body or PAT;
- an arbitrary, empty or malformed ref;
- a `ref` key in the input.

## Ledger preflight model

The read-only preflight reads per-row digests of the whole ledger with Postgres md5. It compares them with the pinned baseline (`2093dcb3…`: 236 rows, max `20260903213456`). The baseline comes from the READ-ONLY capture of 2026-09-11 (`d00faa70…`).

It also checks:
- the hosted 6-column ledger shape;
- the writer's privileges.

Decision table per migration: `apply`, `skip` or STOP. There is no repair, no mark-as-applied and no reconcile. The following all STOP:
- a row that is missing, added, changed or newer than the baseline;
- a foreign contract row;
- objects present without a ledger row;
- an order violation.

**Caveat:** if the Production ledger has changed since 2026-09-11 (for example, promotion steps 37–48 were run), INFRA-1 will STOP at `LEDGER_UNEXPECTED` by design. Re-pinning needs a fresh read-only capture and a reviewed code change.

## Prerequisites and state checks

- The Core columns and functions the contract compiles against must exist with Production types:
  - `usuarios`, `teams`, `team_members`, `jugadores`, `auth.users` and `auth.sessions`;
  - `normalize_tournament_person_name`, `team_user_is_owner` and `team_user_is_admin_or_owner`.
- `app_private` must be absent before the apply. Production has no such schema, so the migration creates it.
- After the apply, `app_private` must hold exactly 7 relations and 4 functions, owned by postgres, with no API-role USAGE.
- Catalog digests outside the contract must be equal before and after the apply. They cover:
  - public functions, relations, columns, policies and triggers;
  - namespaces;
  - default ACL;
  - roles and memberships;
  - the rest of the ledger.

## Secret custody model and Keychain namespace

The Keychain entry is `arma2-torneos-prod-core-contract` / `contract-secret`. Non-production namespaces are refused.

Generation:
- The value is 32 random bytes, generated once inside `keychain-prod.py` and stored through a pty.
- It happens only after the confirmation phrase and before the first remote write.
- There is no add of an external value, so the Staging secret cannot be copied in.
- There is no `-U`, no delete and no rotation.

Checks:
- The value is compared in memory with the nonprod entry. If they are equal, the run STOPs.
- Keychain × Core state machine:
  - Keychain present, Core has a different value → STOP, never reconciled.
  - Core has a secret the Keychain does not → STOP.

The value never appears in output, evidence, argv, env or files. The evidence gate refuses known values and `sbp_`, `sb_secret_`, JWT and connection-string patterns.

The flow is frozen as: Keychain → Core Production secret (this tooling), and later → Deno Deploy `torneos-gateway`.

## Confirmation model

`--apply` asks for this phrase on `/dev/tty`, read by node itself:

```
DEPLOY TORNEOS CORE CONTRACT TO PRODUCTION rcyuuoaqfwcembdajcss <plan id>
```

- The plan id is the first 12 hex of the sha256 of that run's preflight evidence, so it changes on every run.
- Only an exact match counts. `y`, `yes`, `--force`, `-y`, CI, a missing tty or a stale plan id all mean 0 writes.
- After the phrase, a full re-observation must be identical or the run STOPs.

## Certification harness

`probe-prod.mjs` sends the same requests, one for one, as the certified `probe-core-contract.mjs`; a test proves this. It checks 9 exact answers:
1. unsigned request → 401;
2. random key → 401;
3. stale time → 401;
4. correct HMAC with a synthetic unknown session → Core authority 403;
5. replay → 401 REPLAY;
6. v1 route → 403;
7. malformed request → 400;
8. unknown route → 404;
9. GET → 404.

It also checks:
- the security headers;
- that no answer contains sensitive material;
- fail-closed classification.

Fixtures are synthetic. A 200 needs a real user session, so it is not produced in Production; Staging D1 positive and the local E2E cover it.

## ACL checks

- The certified `aclFailures` checks, plus: `app_private` USAGE false for anon, authenticated and service_role.
- The exact `app_private` object set.
- Strays = 0.
- Nothing else changed in Core, by the catalog digest.
- `--acl-only` runs the same checks read-only after the deploy.

## Tests

- **RED:** 33/33 failing against stubs (`tests-red.txt`).
- **GREEN:** 33/33 (`tests-green.txt`). These tests cover every item on the RED list:
  - Production ref correct;
  - Staging ref and arbitrary refs rejected;
  - migration hashes correct; altered and extra migrations rejected;
  - unexpected ledger rejected;
  - Production namespace correct; nonprod namespace rejected;
  - secret never logged;
  - phrase mandatory; non-interactive run rejected;
  - preflight and dry-run make 0 writes;
  - artifact mismatch rejected.
- **Staging regression:** 32/32 (`tests-staging-regression.txt`).
- **Offline rehearsal:** 15/15 PASS (`offline-rehearsal-20260924T200621Z/`, `offline-rehearsal-console.txt`).
  - Setup:
    - local `supabase/postgres:17.4.1.048`, the Production engine build;
    - `--network none`;
    - `postgres` is a non-superuser;
    - seeded with the 236 captured ledger rows and Production-typed prerequisite stubs.
  - What it proved:
    - the baseline is reproduced exactly by Postgres md5;
    - apply of v1 + v1.1 → 9/9 with the **real** handler and the **real** RPC as service_role;
    - ACL, `app_private` and catalog all pass;
    - the ledger ends at 238 rows;
    - the Keychain value was generated exactly once;
    - 0 writes outside `--apply`;
    - the container was removed.
  - All 9 negative cases STOP as expected: ledger drift, changed row, pre-existing `app_private`, missing column, not ACTIVE_HEALTHY, wrong phrase, API USAGE grant, secret mismatch, and objects without a ledger row.

## Invariants

- 0 remote calls and 0 remote writes.
- The worktree `arma2` is untouched.
- The Core contract runtime, Core and Torneos migrations, gateway, payments, frontend, Social Studio, pricing, grants, MP-B1.2 and the MP-B1.1 runtime were not touched.
- The certified Staging tooling is byte-identical to d62039c7.

## Secret scan

Details are in `10-secret-scan.json`.
- 0 real secrets.
- 0 content from the capture: no statements text and no `created_by` value.
- Pattern hits appear only in `core-prod.test.mjs`, and they are synthetic fixtures.
- The 64-hex strings in the evidence are all hash fields.

## Differences from Staging (documented, not contract changes)

- `app_private` is created by the migration in Production. In Staging it already existed with API-role USAGE, so the Production ACL expectation is stricter.
- Production has no `reconcile-ledger`, and no secret reconcile after a mismatch.
- The function's `ezbr_sha256` may differ from Staging's `10724195…`, because it is built server-side. The deploy readback records it, but it is not a gate. Byte identity is checked on the 3 source files.
- A Production rollback is not part of this tooling.

## Next step (not executed)

INFRA-1, run by the operator in a terminal:
1. `--preflight-only`
2. `--dry-run`
3. `--apply` with the phrase
4. `--acl-only`

After that, the rest of INFRA-1 (Staging pause, Torneos project) still needs its own go.
