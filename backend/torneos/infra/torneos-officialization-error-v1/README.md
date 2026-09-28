# OFFICIALIZATION-V1 + ERROR-CONTRACT-V1 REMOTE — G1 read-only, W1 0005, W2 0006, W3 gateway, rollbacks

This tooling targets Arma2 Torneos `onzpwnqxnvlgsevivngf` and the Deno Deploy app `torneos-gateway` (`5d4f18e9…`).
Core, Vercel and Mercado Pago are out of scope. It has no endpoint for any of them.

It extends `../torneos-competition-v1/` and reuses its transport, Keychain, psql, Deno-allowlist and probe code. The
base is Production as COMPETITION-V1 left it: DB `POST_0004`, gateway revision `66we8r12079d`, source `ee34b2a7`, bundle
`75e3535a…`, 16 files.

## State machine (fail closed)

| state | authenticated / anon | what it is |
|---|---|---|
| `POST_0004` | 162 / 12 | No 0005 objects (column, invitations table, owner capability row, 9 RPCs). The 3 bodies 0005 replaces are at `4f43a729` / `2f43290e` / `488ca6bb`. 17 of the 18 error-contract bodies are at their POST_0005 md5. There are 3 functions raising `40001`. |
| `POST_0005` | 171 / 12 | Every 0005 object is present and exactly shaped. The 3 bodies are at their 0005 md5 and the 18 at POST_0005. |
| `POST_0006` | 171 / 12 | `POST_0005` plus the 18 bodies at their 0006 md5. 0 functions raise `40001`. |
| `ROLLED_BACK_0005` | 162 / 12 | What the 0005 rollback leaves: the 9 RPCs are dropped and the 3 bodies are back at POST_0004. The column, table and capability row are kept. This state is **terminal**. |
| `DRIFT` | — | Anything else, for example partial 0005, partial 0006, an unknown body md5, an unexpected grantee or owner, anon or PUBLIC or server-role exposure, a count change, or catalog drift. Every write refuses it. |

Every state also requires all of the following:
- per-function attributes (grantees, definer, `search_path`, owner) equal to the rehearsal pin;
- the 23 closed functions stay closed;
- COMPETITION-V1 stays in force;
- the private authorizer is executable by `torneos_core_adapter` only;
- the foundation, gateway-auth and payments pins show no drift, and the moved catalog paths equal the pin of that state.

Every migration and rollback file is re-hashed before each read and each write (`migrationDrift()`).

| step | only from | refused elsewhere with |
|---|---|---|
| **W1** 0005 | `POST_0004` | `POST_0006` → **`W1_REFUSED_POST_0006_0005_WOULD_REVERT_0006`**. 0005's own precondition accepts its post-state, so the file would run and put `set_tournament_match_dual_control` back to its POST_0005 body. The rehearsal proves this on real Postgres. `POST_0005` → already applied. `ROLLED_BACK_0005` → the file itself refuses; a fix needs a new certified phase. |
| **W2** 0006 | `POST_0005` | `POST_0004` → 0005 not applied. `POST_0006` → already applied. |
| **W3** gateway | DB `POST_0006` + gateway on the live source | not `POST_0006` → `W3_DB_NOT_POST_0006`. The candidate digest must equal the pin (built twice, identical). |
| **W3 rollback** | gateway on the candidate | Redeploys `ee34b2a7` rebuilt from git. The digest must be `75e3535a…`. |
| **W2 rollback** | `POST_0006` + gateway on the live source | While the candidate serves → refused. Roll the gateway back first. |
| **W1 rollback** | `POST_0005` + gateway on the live source | `POST_0006` → **refused**. The 0005 rollback would drop `set_tournament_match_dual_control`, which 0006 replaced; the rehearsal proves this inside a rolled-back transaction. Roll 0006 back first. |

Every DB write goes through these steps in order:
1. Precondition, plus a migration-hash check.
2. The gateway must be on the live source: Deno labels `ee34b2a7` + `75e3535a…`, and the `current` probes must pass.
3. `PLAN <id>`, then the exact phrase.
4. An immediate recheck of state, file bytes and gateway revision.
5. One psql transaction: the file's `BEGIN…COMMIT` with `ON_ERROR_STOP`, as `postgres.<ref>`, `verify-full`.
6. A read-only postcheck: target state, no drift, organization members kept, and the `current` probes still pass.

W3 sends assets and labels only; env is never part of the request. It then checks the revision succeeded and is live,
that env is identical, and that the `candidate` probes pass.

## Plans and phrases

Plans are pure functions of the pins and the observed state. They use no clock and no git HEAD, so G1 records the
expected ids of W1, W2 and W3 in its evidence (`expected_plan_ids`).

- `APPLY TORNEOS MIGRATION 0005 OFFICIALIZATION-V1 onzpwnqxnvlgsevivngf <plan>`
- `APPLY TORNEOS MIGRATION 0006 ERROR-CONTRACT-V1 onzpwnqxnvlgsevivngf <plan>`
- `DEPLOY TORNEOS GATEWAY OFFICIALIZATION-ERROR-CONTRACT torneos-gateway <plan>`
- `ROLLBACK TORNEOS GATEWAY torneos-gateway TO ee34b2a7 <plan>`
- `ROLLBACK TORNEOS MIGRATION 0006 ERROR-CONTRACT-V1 onzpwnqxnvlgsevivngf <plan>`
- `ROLLBACK TORNEOS MIGRATION 0005 OFFICIALIZATION-V1 onzpwnqxnvlgsevivngf <plan>`

## Credentials (unchanged from COMPETITION-V1)

| credential | where | used by |
|---|---|---|
| installer password | Keychain `arma2-torneos-dataplane-db` / `postgres` | G1 DB reads, W1, W2 and their rollbacks |
| bridge ring k1 | Keychain `arma2-torneos-prod-bridge` | probes; tokens minted for random users only |
| Deno Deploy organization token | typed on the tty by the operator (`run-oec-session.sh`) | Deno leg of G1, and every write (all of them observe the gateway) |
| Supabase PAT | **not used** | — |

## Commands

```
node backend/torneos/infra/torneos-officialization-error-v1/oec-session.mjs g1      # read-only, no Deno leg
ARMA2_SESSION_DIR=<abs dir, 0700> bash backend/torneos/infra/torneos-officialization-error-v1/run-oec-session.sh
#   then on $ARMA2_SESSION_DIR/ctl, one line at a time:
#   g1 | db | deno | deno-audit | probes-current | probes-candidate | w1 | w2 | w3 | w3-rollback | w2-rollback | w1-rollback | quit
```

Evidence goes to `backend/torneos/officialization-v1/evidence/remote/`. Files are written with `wx` and are
secret-scanned against every value the process holds.

## Tests

```
node --test backend/torneos/infra/torneos-officialization-error-v1/oec-remote.test.mjs   # offline, 7 tests
node backend/torneos/infra/torneos-officialization-error-v1/offline-rehearsal.mjs         # Docker, real Postgres, 55 checks
```

The **unit tests** cover:
- the state machine and 28 drift cases;
- both bundles;
- the REAL gateway `handle()` of both sources: probe discrimination, the officialization RPCs authenticated-only, Core
  authority checked on every request, the legacy 55000/54000 defense, a genuine 500 staying 500, a real 5 s timeout
  giving 503, `no-store`, and commerce OFF;
- the full sequence and every refusal, with fake DB and fake Deno;
- plan ids equal to the ones G1 predicts;
- secret-leak refusal.

The **rehearsal** runs on `supabase/postgres:17.6.1.147` with installer `postgres` (non-superuser), in two parts.

Part A applies the raw files. It:
- derives `pins/oec-db-delta.json`;
- proves that 0006 changes only 23 errcode literals in 18 bodies, and only `functions.bodies_md5` in the catalog;
- proves re-applies are no-ops;
- proves both hazards above;
- proves the 0006 rollback restores the exact POST_0005 catalog;
- proves the 0005 rollback reaches 162/12, and that 0005 cannot be re-applied after it.

Part B drives the REAL tooling on a fresh database through every step and refusal, including partial 0005 and 0006
injected into the real catalog.
