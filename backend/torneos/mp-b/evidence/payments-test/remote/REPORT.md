# PAYMENTS TEST (remote) — PAYMENTS_REMOTE_TEST_CERTIFIED (2026-09-26)

**Scope.** This is the hosted Mercado Pago Checkout Pro TEST certification of the Torneos payments runtime:

- Deno Deploy app `torneos-payments-test`, `TORNEOS_PAYMENTS_DEPLOYMENT=remote-test`;
- data plane Arma2 Torneos `onzpwnqxnvlgsevivngf`;
- Mercado Pago Seller Test `3712890098`.

The Production gateway `torneos-gateway` stays commerce OFF, Core Production is read-only, the frontend is unchanged, and Mercado Pago LIVE is never configured.

**Tooling.** `backend/torneos/infra/torneos-payments-test/` at `2b2f5422` (branch chain `c2dfc3ed..2b2f5422`). The deployed runtime source is `b3b055b2`. The tooling commits after it (`dad1c99d`, `2b2f5422`) touch the operator session only; `payments-test-deploy.json` pins all 13 deployed files, and they are byte-identical at this HEAD.

This closeout adds only this directory's files and the deploy pin, copied byte for byte from the session's working tree. It changes no code.

## Verdict

`pt-11-certify-20260926T203916Z.json` (sha256 `a5e47ea0c64433ad…`) reports:

- verdict **PAYMENTS_REMOTE_TEST_CERTIFIED**;
- `failures: []`;
- repo secret scan 0 findings (1365 files);
- 0 Management API writes.

It binds these 11 steps by sha256:

| Step | File | sha256 (16) | Verdict |
|---|---|---|---|
| pt-01 | `pt-01-preflight-20260926T203751Z.json` | `25a8c66c0b79d1c4` | PAYMENTS_PREFLIGHT_PASS |
| pt-02 | `pt-02-payments-login-20260926T131234Z.json` | `e50b65caf257b4df` | PAYMENTS_LOGIN_CREATED |
| pt-03 | `pt-03-deno-app-20260926T131356Z.json` | `134d8af83ac24840` | PAYMENTS_TEST_APP_DEPLOYED |
| pt-03b | `pt-03b-redeploy-20260926T191616Z.json` | `c15810f71df844bc` | PAYMENTS_TEST_APP_REDEPLOYED (revision `y3c0y413n6zy`, git_head `b3b055b2`) |
| pt-04 | `pt-04-app-probe-20260926T191701Z.json` | `c9e0d38287c7f0ce` | PAYMENTS_APP_PROBE_PASS |
| pt-05 | `pt-05-qa-fixtures-20260926T203804Z.json` | `edb0d1096e45c465` | QA_FIXTURES_ISOLATED |
| pt-06 | `pt-06-ordering-rollback-20260926T194942Z.json` | `271731fe64310d97` | REMOTE_ORDERING_PASS |
| pt-07 | `pt-07-preference-20260926T183741Z.json` | `315ca93374ae502f` | MP_TEST_PREFERENCE_PASS |
| pt-08 | `pt-08-sandbox-checkout-20260926T195113Z.json` | `a2688f27aa4dd9fd` | SANDBOX_CHECKOUT_APPLIED |
| pt-09 | `pt-09-replays-20260926T194856Z.json` | `c82d129baa79bddc` | REAL_PAYMENT_REPLAYS_PASS |
| pt-10 | `pt-10-refund-20260926T203835Z.json` | `a9b78fb82fef24f6` | REFUND_LIFECYCLE_PASS_MANUAL_INITIATION |

**Real provider facts:**

- Payment `181036143126`: approved ARS 39.900, `live_mode:true` (the Seller Test sandbox).
- Purchase P1 `d4a72039-3b35-489c-8a75-7a6e37d85cd1` went approved → refunded; its grant was revoked.
- Refund `3298184573`: ARS 39.900, approved.
- The refund produced 3 real signed webhooks, each `200 reversal_applied`, but only one revoked event.
- A late replay came back `duplicate`.
- P2 is still `created` with no trace.
- The superseded purchase `f292c050…` is `expired`.
- The census contains exactly the QA set.

## Limitation (declared in pt-10 and pt-11.limitations)

- **Refund API initiation: NOT CERTIFIED.** The Seller Test payments report `live_mode:true`. At 19:50:23Z, `POST /v1/payments/181036143126/refunds` (plan `e88bdbc9b5b2`) answered `401 "Unauthorized use of live credentials"`, and 0 writes were applied.
- **Refund lifecycle: CERTIFIED.** The refund was made in full, manually, from the Seller Test Mercado Pago panel. The chain refund → signed webhook → revoke was then verified read-only (pt-10: 9/9 checks, 0 MP writes).

## Contents (109 evidence files + this report + SHA256SUMS)

| Files | Count | Note |
|---|---|---|
| `pt-01-preflight-*` | 7 | all PASS |
| `pt-02-payments-login-*` | 1 | |
| `pt-03-deno-app-*` / `pt-03b-redeploy-*` | 1 / 4 | revisions `dzvgze7sr654` → `pvmzmrj10rj7` → `xpdg5zct49w3` → `szb0wwg9b90q` → `y3c0y413n6zy` |
| `pt-04-app-probe-*` | 8 | all PASS |
| `pt-05-qa-fixtures-*` / `pt-05a-fresh-purchase-*` | 8 / 1 | |
| `pt-06-ordering-rollback-*` | 3 | `131621Z` = REMOTE_ORDERING_FAILED; the psql runner truncated the output (fixed in `26072120`), and the 2 later runs PASS |
| `pt-07-preference-*` | 2 | the first Preference expired; `183741Z` is the fresh one |
| `pt-08-sandbox-checkout-*` | 69 | observe polling while the webhooks were 401 (signing-secret investigation), 66 INCOMPLETE + 3 APPLIED |
| `pt-09` / `pt-10` / `pt-11` | 1 / 1 / 1 | the certified tail |
| `post-refund-observations/pt-08-…202156Z.json` | 1 | post-refund observe (INCOMPLETE by construction), hashed into pt-10 |
| `../../../../infra/torneos-payments-test/pins/payments-test-deploy.json` | 1 | public facts of the deployed app + the 13 source-file hashes |

Every file is kept, including the failed and incomplete runs. They are the audit trail of the 401 investigation.

## Verify

```
cd backend/torneos/mp-b/evidence/payments-test/remote && shasum -a 256 -c SHA256SUMS
```

Expect 109 OK and 0 failures. The closeout run on 2026-09-26 also checked the following (local only, no network except the Docker lab):

- **Evidence chain:** every step pt-11 binds matches the file on disk by sha256 and verdict, with 0 secret findings. That is 11/11. The pt-10 aside hash matches too.
- **Deploy pin:** all 13 deployed files equal the tree.
- **Secret scan** of all 111 committed files, 0 findings. It used the contract's `secretFindings` shapes plus 14 extra patterns:
  - Supabase PAT and secret keys, Deno tokens, JWTs, private keys, GitHub and AWS keys;
  - DSNs with passwords;
  - `APP_USR-` / `TEST-` tokens;
  - Bearer values, secret-named JSON fields and raw `x-signature` values.

  Negative controls were caught 3/3.
- **Tests:**
  - `payments-session.test.mjs` 13/13
  - `payments-remote-test` 49/49
  - `remote-test-enablement` 30/30
  - `deno-runtime-hardening` 30/30
  - `payments-provider-copy` 7/7
  - `payments-config` 12/12 (`MP_A3_SKIP_LAB=1`)
- **Rehearsals:**
  - offline rehearsal 13/13 (R10 61/61, ordering 19/19)
  - session rehearsal: standard 22/22, fresh 26/26, manual-refund 27/27, fresh + manual-refund 31/31
