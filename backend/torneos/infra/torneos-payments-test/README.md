# PAYMENTS TEST — hosted Mercado Pago Checkout Pro TEST certification

This directory certifies the payments runtime on hosted infrastructure without any Production commerce. Everything else stays as certified:

- The Production gateway `torneos-gateway` stays commerce OFF. It never holds `MERCADO_PAGO_*`, `TORNEOS_PAYMENT*` or `TORNEOS_COMMERCE_*`.
- Core Production is read-only.
- The frontend is unchanged.
- Mercado Pago LIVE is never configured.

| Piece | Where |
|---|---|
| Data plane | Arma2 Torneos `onzpwnqxnvlgsevivngf`, plus one dedicated login `torneos_payments_test` (LOGIN NOINHERIT, member of `torneos_payment_service` only) |
| Runtime | Deno Deploy app `torneos-payments-test` (Free, default alias `https://torneos-payments-test.nicoavayu.deno.net/functions/v1/torneos-payments`), `TORNEOS_PAYMENTS_DEPLOYMENT=remote-test` |
| Provider | Mercado Pago Checkout Pro / Preferences API, the app's **test credentials**. For Checkout Pro these belong to the auto-created test seller (`APP_USR-…`); the runtime attests them with `GET /users/me`: seller id, tag `test_user`, site `MLA`. Otherwise it answers 503. |
| Product | `torneos_premium`: 1 × ARS 39.900 (list 49.900), one-time |
| QA data | One private org `qa-payments-test-*`, seasons S1 (sandbox checkout) and S2 (ordering, rolled back), created by the operator's existing Torneos identity (`qa-fixtures.js`) |

## Files

- `payments-test-contract.mjs`: every pin (allowlists, env names, SQL, phrases, QA prefixes).
- `payments-session.mjs` + `run-payments-session.sh`: the operator session.
  - The tty wrapper asks, with echo off, for the read-only Supabase PAT, the Deno org token, the MP test Access Token and the MP test-mode webhook secret.
  - The values are piped to node and live in memory only.
  - Commands and phrases go through the FIFO `$ARMA2_SESSION_DIR/ctl`.
- `payments-db.mjs`: the psql legs.
  - PB: one transaction as `postgres`, SCRAM verifier only.
  - Login probe (39 checks, ports 5432 and 6543).
  - Ordering permutations: 19 cases, every transaction ends in ROLLBACK.
- `payments-clients.mjs`: the Deno v2, Mercado Pago and TEST-app clients. Every request is classified before it reaches the socket, and writes are armed one at a time.
- `payments-bundle.mjs`: the deployed source is the static graph of `torneos-payments/index.ts`, and it must equal HEAD.
- `keychain-payments-test.{mjs,py}`: Keychain `arma2-torneos-payments-test` holds the login password and the internal HMAC key. The installer is read from `arma2-torneos-dataplane-db/postgres`.
- `qa-fixtures.js`: runs in `https://app.arma2.com.ar` with the signed-in Core session, via `/exchange`, the gateway RPCs and one PostgREST RPC. It creates no Core user.
- Rehearsals, no network:
  - `offline-rehearsal.mjs`: DB, PB, ordering, and the real runtime against the MP emulator.
  - `session-rehearsal.mjs`: the real session end to end on Docker, with fake Management and Deno APIs and the real runtime booted with the exact deployed env.
- `payments-session.test.mjs`: unit tests.

## Session

```
ARMA2_SESSION_DIR=<abs dir, 0700> bash backend/torneos/infra/torneos-payments-test/run-payments-session.sh
```

| Command | Kind | Phrase |
|---|---|---|
| `preflight` | read | — |
| `pb` | psql write | `CREATE TORNEOS PAYMENTS TEST LOGIN torneos_payments_test <plan>` |
| `create` | Deno write | `CREATE TORNEOS PAYMENTS TEST DENO APP torneos-payments-test <plan>` |
| `app-probe` | read | — |
| `fixtures` | read (after `qa-fixtures.js`) | — |
| `ordering` | rolled back | — |
| `preference` | TEST provider write | `CREATE MERCADO PAGO TEST PREFERENCE <plan>` |
| `observe` | read (after the sandbox checkout) | — |
| `replays` | read* | — |
| `refund` | TEST provider write | `REFUND MERCADO PAGO TEST PAYMENT <plan>` |
| `refund-verify` | read* (refund made in the Seller Test panel) | — |
| `certify` | read | — |
| `status`, `quit` | — | — |

**How writes are guarded.**
- Each write re-reads the state it was planned on before writing.
- There are no retries.
- Evidence goes to `backend/torneos/mp-b/evidence/payments-test/remote/`. It is secret-scanned against every value the session holds.
- `certify` binds every step file by sha256 and scans the tracked tree for the session's values.

## What is real and what is harness

**Real provider:**
- the Preference;
- the rejected and approved sandbox payments;
- the signed webhooks;
- the refund and its webhook.

**Refund initiation (2026-09-26).** The Seller Test sandbox reports its payments `live_mode:true`, and Mercado Pago refuses the API refund of such a payment with the Seller Test token (`401 "Unauthorized use of live credentials"`).
- The operator then refunds the payment in full from the Seller Test's Mercado Pago panel.
- `refund-verify` certifies everything that follows: the provider's total refund, the real signed webhook (`200 reversal_applied` in the app logs, before the step sends anything), the refunded purchase, the revoked grant, the watermark and a harmless late replay.
- The evidence (`pt-10`, verdict `REFUND_LIFECYCLE_PASS_MANUAL_INITIATION`) and `certify` (`pt-11.limitations`) state that the refund API initiation is **not** certified.
- `observe` runs made after the refund are necessarily INCOMPLETE (the purchase is no longer approved). They are kept in `remote/post-refund-observations/` and hashed into `pt-10`.

**Harness:**
- **Disputes, restores and "old dispute after restore"** (the 0003 bug). Mercado Pago TEST cannot open a chargeback on demand, so these run as ordering permutations on the hosted functions, in transactions that roll back.
- **Forged provider answers** (wrong amount, currency, reference or season). The provider is the authority and cannot be made to lie, so these run in the offline rehearsal against the real sources.
