# OFFICIALIZATION-V1 + ERROR-CONTRACT-V1 (remote prep) — TORNEOS_OFFICIALIZATION_ERROR_CONTRACT_REMOTE_READY (Deno leg pending) — 2026-09-28

**Scope.** This is the preparation of the Production rollout of migrations 0005 and 0006 and of the gateway revision
that serves them. **Nothing was written to Production.** There was no migration, no Deno deploy, no Vercel change, no
Core change and no push.

**Tooling.** [`backend/torneos/infra/torneos-officialization-error-v1/`](../../../infra/torneos-officialization-error-v1/README.md)
at commit `185cfb92`, on top of the certified chain `f88779b1..fdb043d5` (base `main` `5b786051`). No functional code
changed.

## Verdict

| Check | Result |
|---|---|
| Offline unit tests | **7/7**. Uses the REAL gateway `handle()` of the live and candidate sources, plus a fake DB and a fake Deno. |
| Offline rehearsal on `supabase/postgres:17.6.1.147`, installer `postgres` | **55/55**. [`../rehearsal/oec-rehearsal-20260928T124811Z`](../rehearsal/oec-rehearsal-20260928T124811Z/REHEARSAL-result.json). |
| Production G1, DB leg (psql READ ONLY) | **PASS**. State **`POST_0004`**, 0 failures. |
| Production G1, bundles | **PASS**. The live source rebuilt from git is `75e3535a…` (16 files), equal to the deploy pin. The candidate is `6c252863…` (17 files), deterministic, equal to the pin. |
| Production G1, live gateway probes (`current`) | **66/66**. |
| Production G1, Deno leg (revision id, env digests, app audit) | **NOT OBSERVED**. It needs a Deno token typed by the operator on a tty. |
| Frontend (public bundle read) | **CLOSED**. `main.d3339e14.js` is the rollback bundle of 2026-09-27. 0 `REACT_APP_TORNEOS_*` values, no gateway host. |

G1 evidence: `oec-01-g1-20260928T125026Z.json` (sha256 `7dfaae74…`), with 0 writes and 0 Deno requests.

## Migration pins

| file | sha256 |
|---|---|
| `00000000000005_officialization_v1.sql` | `51fe200f2124e786345a85e5dbadfc844765db550a7f8cc837adefbddf0aeb78` (byte-identical to `20bd3222`) |
| `00000000000006_domain_error_contract.sql` | `767d57e8fb96ca69cd9d3b9379c0c3135652c8cb7bc07d83d81d1d815e0f3cc3` |
| 0005 rollback | `3dc0776b18842a29f92aaa479fefce0806083a5e1750e29e65bae4cb6bb8e33a` |
| 0006 rollback | `30c15af17f952cc4b341c54168f6b01ee0a37066fe1d5a8f81fe4cfe4ac80f1b` |

0000–0004 are byte-identical to `main` (`f857bd09` / `3df4b96e` / `06378f12` / `d54b3293` / `36e45edd`). The migrations
directory holds exactly 0000–0006.

## Production G1 — DB (`onzpwnqxnvlgsevivngf`, read-only)

The connection was PostgreSQL 17.6 as the installer `postgres` over the sa-east-1 Session Pooler, `verify-full`,
`default_transaction_read_only=on`.

Counts and grants:
- `authenticated` 162 and `anon` 12. The catalog `execute` for authenticated is 164 / `fbd63016…`, which equals the
  COMPETITION-V1 post pin.
- The 23 closed functions are closed.
- COMPETITION-V1 is in force: 15 grants, and both fixes have their post bodies.
- Owner is `postgres` everywhere.
- There is no anon, PUBLIC or server-role exposure.
- `private.authorize_core_contract` is executable by `torneos_core_adapter` only.
- The foundation, gateway-auth and payments pins show no drift. There is no migrations ledger. The `anon`
  `statement_timeout` is 3 s.

Pins 0005 requires:
- `validate_tournament_match_operation` `4f43a7292753cbd191c9800dac08ed58`
- `get_tournament_match_operation_context` `2f43290e706d0471f91a4baf67f400c5`
- `private.authorize_core_contract` `488ca6bb0491e7ae9921091a90f30b65`

0005 and 0006 are both absent:
- The column `tournaments.match_result_dual_control_enabled`, the table `tournament_organization_invitations`, the
  owner capability row and all 9 RPCs are absent.
- 17 of the 18 error-contract bodies are at their POST_0005 md5. The 18th, `set_tournament_match_dual_control`,
  arrives with 0005.
- 3 functions still raise the domain `40001`: the storm is live, as expected before 0006.

Informational: `tournament_organization_members` holds 2 rows, the QA org of the rolled-back enablement. No step
deletes membership data.

## Production G1 — gateway (live revision `66we8r12079d`, read-only probes)

The probes used tokens minted for random identities only. They reach the allowlist or the live Core authority and
write nothing.

Results, 66/66:
- `/config`: the publishable key matches the pin digest.
- B7: health, JWKS (k1 active + k2 standby), CORS, `/exchange` refusals, token contract, commerce OFF.
- COMPETITION-V1 RPCs return 401 with `no-store`, which means they are allowlisted and live Core authority is checked
  on each request.
- The **9 OFFICIALIZATION-V1 RPCs return 403 `rpc not enabled`** on the authenticated route, and also 403 on the public
  route.
- Service-only, kept-revoked, commerce and public RPCs on the authenticated route return 403.
- Unauthenticated calls return 401.
- The public route contract: 200 `null` with `no-store`, 400 / 403 / 400 / 405.

**Not observed without the Deno token:** the revision id, the env digests (13 keys), and the app config, labels and
revision set. The session command `g1` observes them and audits them against the COMPETITION-V1 W2 certification.

## Gateway candidate (not deployed)

Digest `6c252863fd94bcad0f785af9bb3636d09b2bc2265baafb0af2a771efdb6143a4`, 17 files. It was built twice from HEAD and
both builds were identical. The functions tree is from `c0a72bc1`.

Delta from the live source (`75e3535a…`):
- **Added:** `officialization-v1-rpc-allowlist.json`.
- **Changed:**
  - `competition.ts`: the officialization loader and `domainErrorStatus`.
  - `index.ts`: the allowlist union, and the proxy status mapping.
  - `adapter.ts`: the `organization_invitation_token` → `verified_email` mapping.
- **Unchanged** (byte-identical): `commerce.ts`, the commerce, COMPETITION-V1 and staging allowlists, `token.ts`,
  `config.ts`, `db.ts` and `core-client.ts`.

Proven on the REAL `handle()`:
- the 9 RPCs are served on the authenticated route only, with Core authority on every request;
- `no-store` and the 5 s timeout are preserved;
- a legacy `55000` / `54000` 500 with a contract message becomes 409 / 422 / 429, with the body byte for byte;
- **a genuine 500** (another SQLSTATE, another message, a non-JSON body) **stays 500**;
- **a genuine timeout stays 503**;
- commerce is OFF.

The env diff is zero by construction: W3 sends assets and labels only.

## Atomic vs separate DB writes — decision: **SEPARATE (W1 0005, W2 0006)**

A single atomic transaction is **not technically valid** without changing certified bytes:
- Each file carries its own `BEGIN; … COMMIT;`.
- PostgreSQL has no nested transactions. Under `psql --single-transaction` (or a concatenation), 0005's `COMMIT`
  commits, and 0006 then runs in a second transaction.
- The only way to get one transaction is to strip or alter the `BEGIN` / `COMMIT` lines. That sends bytes whose hash is
  not the pin and that were never certified, so it was not done.

Each step is atomic on its own. If W2 fails, the database stays at `POST_0005`, which is safe (see below).

## Write plans (ids are pure functions of pins + observed state; re-derived and re-checked at run time)

| step | target | pre-state | post-state | artifact | plan id | phrase |
|---|---|---|---|---|---|---|
| **W1** | DB `onzpwnqxnvlgsevivngf` | `POST_0004`, 162 / 12, gateway `66we8r12079d` (live source) | `POST_0005`, 171 / 12 | 0005 `51fe200f…` | `b87509e6dcec` | `APPLY TORNEOS MIGRATION 0005 OFFICIALIZATION-V1 onzpwnqxnvlgsevivngf b87509e6dcec` |
| **W2** | DB | `POST_0005`, 171 / 12, gateway on the live source | `POST_0006`, 171 / 12, 0 × 40001 | 0006 `767d57e8…` | `b55062fd2b1a` | `APPLY TORNEOS MIGRATION 0006 ERROR-CONTRACT-V1 onzpwnqxnvlgsevivngf b55062fd2b1a` |
| **W3** | Deno `torneos-gateway` | DB `POST_0006`; revision `66we8r12079d` (`ee34b2a7` / `75e3535a…`); env 13 unchanged | new production revision, labels `bundle_digest=6c252863…`; env identical; `candidate` probes pass | bundle `6c252863…` (17 files) | `94d4a1527f59` | `DEPLOY TORNEOS GATEWAY OFFICIALIZATION-ERROR-CONTRACT torneos-gateway 94d4a1527f59` |

Each write runs these steps in order:
1. Precondition, plus a migration re-hash.
2. The gateway must be on the live source: labels plus `current` probes. This applies to W1 and W2.
3. `PLAN` and the exact phrase.
4. An immediate recheck of state, file bytes and gateway revision.
5. One request.
6. A read-only postcheck.

**W1 is refused on `POST_0006`**, and on `POST_0005` and `ROLLED_BACK_0005`. The rehearsal proves on real Postgres
that a raw 0005 on `POST_0006` exits 0 and reverts `set_tournament_match_dual_control`: 0005's precondition accepts its
own post-state.

## Intermediate states

**`POST_0005`, live gateway (between W1 and W2):**
- The frontend is closed, measured.
- The 9 new RPCs are unreachable through the gateway: the live allowlist and the public route both return 403, measured
  on Production.
- **Residual exposure** is the same model as the 59 functions authenticated has executed since the baseline. The 9 are
  `EXECUTE`-granted to `authenticated`, so a valid bridge token, which `/exchange` gives any Core user, could call them
  directly on Torneos PostgREST. Their own guards are the boundary:
  - invite, list, revoke, role and remove need organization capabilities;
  - get and set dual control need `match_operations.*` and season access;
  - accept needs a Core attestation that only the adapter can insert. The live adapter has no organization branch, so
    accept is always refused.
- Existing COMPETITION-V1 RPCs behave differently through the live gateway:
  - `validate_tournament_match_operation` now lets an authorized owner or admin validate their own report while the
    tournament's policy is OFF, which is the default for every existing tournament. This is the intended fix.
  - `get_tournament_match_operation_context` gains a `dualControl` object; the change is additive.
  - The authorizer's organization branch is unreachable through the live adapter.
- The domain `40001` storm is still live. This is **not new exposure**: it is the current `POST_0004` situation. Keep
  the window short by running W2 right after W1.

**`POST_0006`, live gateway (between W2 and W3):**
- The database answers PT409 / PT422 / PT429. The live source passes those statuses through: 409 → 409 and 429 → 429,
  proven on the live `handle()`.
- The storm is gone.
- The frontend is closed. The gateway is fully functional, since the `current` probes are re-run in the W2 postcheck.

## Rollback (order enforced: W3 → W2 → W1; no destructive cleanup)

1. **W3 rollback.** One revision of `ee34b2a7`, rebuilt from git. Its digest must be `75e3535a…`. The plan id is
   runtime, because it depends on the new revision id. Phrase: `ROLLBACK TORNEOS GATEWAY torneos-gateway TO ee34b2a7 <plan>`.
2. **W2 rollback.** The 0006 rollback script. It is refused while the candidate serves.
   - The result is exactly the `POST_0005` catalog; the rehearsal checked every strict path plus `acl_md5`.
   - The domain `40001` storm returns.
   - Plan id `96fc07b5078c` if the gateway is `66we8r12079d`. Phrase:
     `ROLLBACK TORNEOS MIGRATION 0006 ERROR-CONTRACT-V1 onzpwnqxnvlgsevivngf <plan>`.
3. **W1 rollback.** The 0005 rollback script. It is **refused on `POST_0006`**, because it would drop a function 0006
   replaced.
   - The result is `ROLLED_BACK_0005`, **162 / 12**.
   - The 3 bodies return to their `POST_0004` md5 and the 9 RPCs are dropped.
   - The column, the invitations table, the capability row, memberships, audit and invitation rows are **kept**. No
     data is deleted; the top-level scan of both rollbacks finds no data write.
   - Plan id `70f9f4793087` if the gateway is `66we8r12079d`. Phrase:
     `ROLLBACK TORNEOS MIGRATION 0005 OFFICIALIZATION-V1 onzpwnqxnvlgsevivngf <plan>`.

**`ROLLED_BACK_0005` is terminal.** 0005's own precondition refuses a re-apply from it, which the rehearsal proved. A
forward fix would need a new certified phase. Prefer rolling back W3 and/or W2 only: `POST_0005` with the live gateway
is a safe resting state.

## Warnings

1. **Deno leg pending.** Before W1, the operator must run `run-oec-session.sh` with a NEW Deno token typed on the tty,
   then `g1`, and get `G1_PASS`. That run covers the revision id, env 13/13 and the app audit. Every write re-observes
   the gateway, so none can run without the token.
2. The app `updated_at` bound is inferred: the COMPETITION-V1 W2 evidence did not record it. The bound is `≤
   2026-09-27T16:46:00Z`. If Deno moved it without a change, the audit fails closed and must be reviewed, not bypassed.
3. After W1 the live dual-control policy is OFF for every existing tournament, including the QA tournament
   `f45575dc`.
4. After W3 the gateway serves the 9 RPCs to any signed-in Core user, and each function's guards decide the outcome
   (organization role, capability, season access, attestation). The frontend stays closed until a separate Vercel
   decision.
5. A W2 rollback restores the domain 40001 storm. The candidate gateway cannot fix 40001.
6. The frontend changes of both phases (members UI, transport keeping the bearer) ship only with a later merge and
   Vercel deploy. That is out of scope here.
