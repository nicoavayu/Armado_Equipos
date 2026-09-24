# Core PRODUCTION contract deployment tooling (INFRA-0.5)

Prepared for INFRA-1. Nothing in this directory has run against Production.

Target: Core Production `rcyuuoaqfwcembdajcss` ("nicoavayu's Project", org `gwqrborhnqjdzzmpxulh`,
`sa-east-1`). This tooling installs only the following, all at once:

| What | Pin |
|---|---|
| migration `20260914120000_torneos_core_contract_v1` | file `2967ae6f…`, apply SQL `3d3e2845…` |
| migration `20260915120000_torneos_core_contract_v1_1_session` | file `52564138…`, apply SQL `859fa7a3…` |
| Edge secret `TORNEOS_CONTRACT_SERVICE_SECRET` | Keychain `arma2-torneos-prod-core-contract` / `contract-secret` (new value, never the Staging one) |
| Edge Function `torneos-core-contract` | 3 files, byte-identical to the certified Staging deploy of 2026-09-17 |

The owner authorized this as an explicit, limited exception to "NO modificar DB Core" (INFRA-0.5,
2026-09-24). It covers these two migrations and nothing else.

## Files

- `prod-contract.mjs` holds the whole contract as data. It covers:
  - the target;
  - the authorized migrations;
  - the ledger baseline and its evaluation;
  - prerequisites;
  - `app_private`;
  - the catalog digest;
  - the artifact;
  - custody;
  - the confirmation phrase;
  - the evidence gate.
- `mgmt-prod.mjs` is the only transport. It only accepts Production paths:
  - reads are a closed allowlist;
  - writes must be armed after the phrase and must match the pinned SQL, the single secret or the pinned deploy.
- `core-prod-deploy.mjs` is the runner. Modes: `--preflight-only`, `--dry-run`, `--apply`, `--acl-only` and `--harness-only`.
- `deploy-core-contract-prod.sh` is the operator wrapper. It needs a real terminal. It reads the PAT from `/dev/tty` and has no default mode.
- `keychain-prod.py` / `keychain-prod.mjs` handle Production Keychain custody:
  - `check` and `generate` only;
  - no add of an external value;
  - no `-U`;
  - no delete;
  - no rotation.
- `probe-prod.mjs` is the certified 9-answer signed harness, pointed at the Production endpoint.
- `pins/production-ledger-baseline.json` holds the 236-row Production ledger digests (`2093dcb3…`). It was derived by `derive-ledger-baseline.mjs` from the read-only capture of 2026-09-11 (`d00faa70…`).
- `core-prod.test.mjs` holds the offline unit tests.
- `offline-rehearsal-prod.mjs` runs the full rehearsal on a local `supabase/postgres:17.4.1.048` with `--network none`.

The certified Staging tooling (`phase3b/remote/*`) is imported, never modified. The runner verifies its
sha256 at d62039c7 before anything else.

## INFRA-1 runbook (operator, in Terminal.app; the agent cannot run it)

```bash
cd <repo>
bash backend/torneos/infra/core-prod-contract/deploy-core-contract-prod.sh --preflight-only
bash backend/torneos/infra/core-prod-contract/deploy-core-contract-prod.sh --dry-run
bash backend/torneos/infra/core-prod-contract/deploy-core-contract-prod.sh --apply
bash backend/torneos/infra/core-prod-contract/deploy-core-contract-prod.sh --acl-only
```

`--apply` prints the plan and asks for this phrase on `/dev/tty`:

```
DEPLOY TORNEOS CORE CONTRACT TO PRODUCTION rcyuuoaqfwcembdajcss <plan id>
```

The plan id is the first 12 hex characters of that run's preflight evidence sha256. It changes on every
run, so a typed answer cannot be prepared in advance. `y`, `yes`, `--force`, a CI environment, a missing
tty or a mistyped phrase all mean 0 writes.

Runtime evidence goes to `backend/torneos/mp-b/evidence/infra-1-core-prod/` (0600, never overwritten).
Every file passes a secret gate before it is written.

## Certification only: `--harness-only` (API-key recertification, 2026-09-24)

Re-certifies an installed contract without any Management API write, with a read-only PAT:

```bash
bash backend/torneos/infra/core-prod-contract/deploy-core-contract-prod.sh --harness-only
```

1. Local pins (Staging tooling, migrations, artifact bytes, ledger baseline), as in every mode.
2. Keychain: the Production entry must be PRESENT (never generated here), well-formed, and differ from the
   non-production entry, which must be present so the difference is provable.
3. Pre-harness: the `--acl-only` certification (same gates), ledger = 236 + 2 own rows, and the deployed
   `ezbr_sha256` equal to the certified Staging bundle. Any divergence STOPs before the first function call.
4. The certified signed harness, 9 requests, one attempt, no retry.
5. Post-harness: the `--acl-only` certification again, and every persistent observation (project, ledger,
   installed, prerequisites, app_private, ACL, catalog, secret names, function) identical to step 3. The
   function `version` counter is the only field allowed to move.
6. RPC reach is corroborated read-only: `pg_stat_statements` counts exactly 3 new `service_role` PostgREST
   calls to `torneos_contract_execute` (the signed session, its replay and the verified-email request).

The transport and the client view are read-only by construction. There is no confirmation phrase, because
there is nothing to authorize on the Management API. The remote side effects are the contract's own nonce
rows (61 s TTL). Evidence goes to `backend/torneos/mp-b/evidence/infra-1-core-prod-apikey-recert/`.

## Fail-closed conditions (all STOP before any write)

- **Target:**
  - a project ref, identity or status other than the pinned one (ACTIVE_HEALTHY);
  - any ref in the input.
- **Pins:**
  - migration bytes, rendered apply SQL, ledger rows or cli_parser changed;
  - an extra, missing or reordered migration;
  - an artifact byte difference;
  - the certified Staging tooling differs from d62039c7.
- **Ledger:**
  - any row missing, added, changed or newer than the baseline;
  - a foreign contract row;
  - the wrong shape;
  - objects present without a ledger row (no mark-as-applied, no repair).
- **Schema state:**
  - prerequisites missing or with a different type;
  - `app_private` pre-existing;
  - contract objects or the function present without the contract.
- **Custody:**
  - Keychain ambiguous, unreadable or malformed;
  - the value equals the Staging value;
  - Core holds a secret the Keychain does not;
  - a Core secret while the contract is absent.
- **Credentials and ambiguity:**
  - a PAT that is missing or malformed;
  - any ambiguous API answer;
  - state that changes between the preflight and the phrase.

After the phrase, any failure also STOPs. It is persisted in `core-prod-failed-*`, and the next step is
always `--preflight-only`. A Core secret that differs from the Keychain is a STOP; Production never
reconciles it.

Rollback is not part of this tooling. A Production rollback needs its own authorization.

## Secret flow (frozen)

```
macOS Keychain arma2-torneos-prod-core-contract/contract-secret   (generated once inside keychain-prod.py)
  ├─▶ Core Production rcyuuoaqfwcembdajcss  Edge secret TORNEOS_CONTRACT_SERVICE_SECRET   (this tooling)
  └─▶ later: Deno Deploy app torneos-gateway  TORNEOS_CONTRACT_SERVICE_SECRET          (not this tooling)
never: torneos-payments · frontend · repo · Supabase Torneos · evidence · logs · argv · files
```
