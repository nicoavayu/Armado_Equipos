# ARMA2_TORNEOS_MP_B1_1_R3_DENO_RUNTIME_PREPARATION

**MP_B1_1_CODE_READY.** The code is prepared for the approved topology. The real Deno Deploy control plane is **not** certified (`remotePlatformCertified: false`). Nothing was created, deployed, provisioned or pushed.

- Parent / candidate: `bdc605fdccec3fe3fa4082be0fac67e5ba496f79`, whose parent is MP-B1.2 `1f8e560f`.
- Branch: `claude/torneos-mp-b1-1-remote-enablement-r2`.
- One follow-up commit, not an amend; its hash is given in the delivery.
- Precheck (`precheck.json`): exact HEAD, single parent, 0 merges, no remote branch contains the candidate, `origin/main` = `c2dfc3ed`, the original `arma2` worktree was not touched.
- The pre-existing untracked `mp-b1.1-r2-final-review/` (from an earlier session) is neither changed nor committed.

## Approved runtime topology (frozen: `deno-deploy-isolation-contract.json`)

| Component | Holds | Never holds |
|---|---|---|
| Deno Deploy app **torneos-gateway**<br>entry `torneos-gateway/index.ts`<br>`/functions/v1/torneos-gateway/*` | `TORNEOS_CONTRACT_SERVICE_SECRET`, `TORNEOS_BRIDGE_KEYS`, `TORNEOS_DB_IDENTITY_WRITER_URL` (`torneos_edge_identity_writer`), `TORNEOS_DB_CORE_ADAPTER_URL` (`torneos_edge_core_adapter`), `TORNEOS_PAYMENTS_INTERNAL_SECRET`, plus public Core/REST/commerce-link configuration | any `MERCADO_PAGO_*`, the payments DB login, provider, notification or lab variables (refused at boot in commerce TEST); Supabase service role / admin DB, `DATABASE_URL`, `PG*` (never read; platform-enforced) |
| Deno Deploy app **torneos-payments**<br>entry `torneos-payments/index.ts`<br>`POST /functions/v1/torneos-payments/internal/v1/season-checkout-preference`<br>`POST …/webhooks/mercadopago/v1` | `MERCADO_PAGO_TEST_ACCESS_TOKEN`, `MERCADO_PAGO_TEST_WEBHOOK_SECRET`, seller id, `TORNEOS_PAYMENTS_DB_URL` (dedicated login, NOINHERIT member of `torneos_payment_service`), `TORNEOS_PAYMENTS_INTERNAL_SECRET`, `TORNEOS_PAYMENTS_DB_SSL_CA` | bridge / contract / gateway-DB / Core-private / Supabase-admin variables, `DATABASE_URL`, any `PG*` variable, gateway logins (all **refused at boot**, H1/H2) |
| Supabase project **Arma2 Torneos** | DB, PostgREST, migrations 0000–0003, RLS/grants, inline `custom_jwks` | **no Edge Functions** |
| Browser | 0 secrets | — |

Invariants:
- All variables are **app-level**.
- **0 organization-level variables**.
- **No Deno Deploy database integration**.
- Only the gateway↔payments HMAC key is shared.
- No Vercel for gateway/payments.
- Hosts are never hard-coded. remote-test still requires HTTPS and the exact declared hosts; the gateway commerce loader is unchanged and was re-tested.

## H1 — payments secret deny-list (`torneos-payments/config.ts`)

`FORBIDDEN_PAYMENTS_ENV` covers these exact real names found in the runtime and repo:
- gateway: `TORNEOS_BRIDGE_KEYS`, `TORNEOS_CONTRACT_SERVICE_SECRET`, `TORNEOS_DB_IDENTITY_WRITER_URL`, `TORNEOS_DB_CORE_ADAPTER_URL`;
- Core private (lab compose): `CORE_SERVICE_ROLE_KEY`, `CORE_JWT_SECRET`;
- Supabase admin: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEYS`, `SUPABASE_DB_URL`;
- `DATABASE_URL`.

`FORBIDDEN_PAYMENTS_ENV_RE = /^PG[A-Z_]+$/` covers the rest. Verified in the cached source: postgres.js 3.4.7 `parseOptions` silently fills anything the URL and options leave unset from `PGHOST/PGPORT/PGUSER(NAME)/PGPASSWORD/PGDATABASE/PGAPPNAME/PGTARGETSESSIONATTRS` and `env['PG'+OPTION]` (`PGSSL`, `PGIDLE_TIMEOUT`, …). The pattern also covers PostgREST `PGRST_*` secrets.

Any non-blank value refuses the boot: 503 on both routes, no DB connection, value-free log.

Not over-broad (tested): these keep booting:
- Deno Deploy platform variables (`DENO_DEPLOYMENT_ID`, `DENO_REGION`), `PORT`, `TZ`, `HOME`, `PATH`;
- public configuration (`CORE_AUTH_URL`, `CORE_ANON_KEY`, `TORNEOS_REST_URL`, `SUPABASE_URL`, `TORNEOS_DB_SSL_CA`);
- look-alikes (`XPGHOST`, lower-case `pghost`);
- blank values.

## H2 — forbidden DB logins

`FORBIDDEN_DB_LOGINS` gains `torneos_edge_identity_writer` and `torneos_edge_core_adapter`. The decision uses the **login** inside `TORNEOS_PAYMENTS_DB_URL`, not the variable name. The login is taken from the pooler `<login>.<ref>` form, %-decoded and compared case-insensitively. Tested:
- a gateway login via the pooler with no gateway variable present → refused;
- dedicated payments logins (plain and pooler form) → allowed;
- platform roles → still refused.

## Webhook `ts` model (`webhook-signature.ts` new, `webhook-freshness.ts`, `handler.ts`)

- **One Torneos-local parser** (`parseMercadoPagoSignature`):
  - split on `,`; each part is `key=value` at the first `=`; keys are trimmed;
  - unknown keys are ignored;
  - a part without `=`, or a **repeated `ts`/`v1`**, is ambiguous and refused.
- The **`ts` value is not trimmed or normalised**. It must match `^[1-9]\d{9}$` (epoch seconds) or `^[1-9]\d{12}$` (epoch milliseconds). Everything else is refused before any HMAC or provider call:
  - other lengths, leading zero, float, exponent, sign, whitespace, prefix/suffix garbage, hex, `_`, non-ASCII digits;
  - 16- and 19-digit (overflow / unsafe integer) values.
- **Raw-HMAC guarantee.** The manifest is `id:<data.id>;request-id:<x-request-id>;ts:<raw ts>;` with the exact received bytes. Tested:
  - a 13-digit header signed over its seconds → 401;
  - a 13-digit header signed over its ISO date → 401;
  - a 10-digit header signed over ×1000 → 401;
  - a 10-digit header signed over its space-padded form → 401;
  - only the raw bytes verify.
- **Normalisation only in freshness.** `webhookTimestampMs` turns 10 digits into ×1000 and keeps 13 digits as they are; it is used only by `webhookTimeVerdict`. The signature module does no conversion; the freshness module does no cryptography (source-tested).
- **Freshness:**
  - future skew is at most **+300 s**, so +300 000 ms is ok and +300 001 ms is `future`;
  - absurd future → **401 before any provider call or DB call**;
  - **no maximum age**: an old valid signed notification is accepted and re-fetched.
- **Order in the handler:** HMAC → freshness (on `signature.ts`, the same parsed raw ts) → provider re-fetch.
- **`ts` ≠ `payment.date_last_updated`.** The ordering RPC receives the re-fetched provider date byte-exact (`2026-09-24T11:00:00.123-03:00`); the `ts` (10 or 13 digits) never reaches the DB.
- **Legacy freeze:** `_shared/mercadoPagoPaymentProvider.ts` is byte-identical (sha `1136217d…`). The webhook path no longer calls its 10-digit-only `verifyMercadoPagoWebhookSignature`; everything else still comes from the shared copy. The HMAC helpers (`hex`, `constantTimeEqual`) are now exported from `hmac.ts` and reused, not duplicated.
- **Extra finding (RED):** the certified verifier also accepted a 0-leading 10-digit `ts` (`/^\d{10}$/`). It is refused now.

## Deno Deploy compatibility (CODE_READY)

- **Static checks** (`offline.json` → `deno`):
  - both module graphs stay inside `backend/torneos/supabase/functions`;
  - the imports are relative, plus exactly `npm:jose@6.2.12` / `npm:postgres@3.4.7` and JSON `with { type: "json" }` (no Deno-1 `assert`);
  - the only Deno APIs are `Deno.serve`, `Deno.env` and `Deno.env.toObject`;
  - no `EdgeRuntime`, no filesystem, no subprocess, no KV/cron/FFI, no `process.env`, no container paths, no hard-coded platform hostname;
  - the payments graph = `torneos-payments` + `_shared`;
  - the gateway graph = `torneos-gateway` + `hmac.ts`/`remote-hosts.ts` only (the gateway never loads payments config or the MP provider).
- **Runtime on standard Deno 2.1.4** (`deno-runtime.json`, 7/7):
  - Runs fully offline: `--cached-only`, a dead-proxy black hole, `--allow-net` = one loopback port only.
  - The **unmodified** `index.ts` files run from a temp copy of the functions tree. A harness shim only pins the `Deno.serve` listen address to loopback.
  - Payments on Deno 2.1.4:
    - boots and routes `/functions/v1/torneos-payments/…`;
    - authenticates signed 10- and 13-digit `ts` (old ones too), then fails closed at the unreachable provider (503);
    - refuses future / malformed / seconds-signed-as-13-digit `ts` (401);
    - checks the internal HMAC, and a valid call reaches postgres.js → 503 because the DB is unreachable;
    - refuses to boot on H1/H2 material.
  - Gateway on Deno 2.1.4, in remote-test commerce (https + declared hosts):
    - serves JWKS, `/config`, `/exchange` (401 without bearer) and the commerce route;
    - wrong Host → 403; Core unreachable → 503;
    - refuses to boot on Mercado Pago / payments-DB material.
- **Resolution finding (proven):**
  - Inside the repo, the **root `package.json`** switches Deno 2 to node_modules resolution, and `npm:` imports then fail. It fails closed at boot; it is not insecure.
  - Each Deno Deploy app must therefore be rooted at `backend/torneos/supabase/functions`. This is a platform check.
  - A nested `deno.json` was tried and does **not** override the root `package.json`; the only code-level fix would be a repo-root Deno config, which is out of scope.
- **Type-check:** payments is clean. The gateway reports 3 **pre-existing** strict-type diagnostics (`adapter.ts:82`, `db.ts:42`, `index.ts:66`), frozen by the test. They are type-only, Deno does not type-check at run time, and they were not touched (certified gateway code).
- **Deno 2.9.4** is also installed locally, but its npm cache format differs from the local cache, so it cannot run offline. It was not used.

## Replay / ordering (MP-B1.2 unchanged)

- R2 lab suite, 15/15, with 10-digit `ts`: old approved after refunded, old disputed after restored, exact replay ×3, duplicate approved / refund / dispute, stale provider snapshots `stale_ignored`, revoked never revives, max 1 grant.
- New R3 lab suite (`webhook-ts-ordering.json`, 9/9) repeats these with **13-digit and mixed `ts`**. It also covers a stale snapshot notified with a **newer** 13-digit `ts` (+299 s / +120 s / +200 s): still `stale_ignored`, so the `ts` never outranks `date_last_updated`.

## Regression (lab `arma2-mpb11r3`, local only)

| Suite | Result |
|---|---|
| R3 offline focal (H1, H2, ts, raw HMAC, ordering, Deno static, isolation contract) | **29/29**<br>RED on the untouched candidate: 17 fail / 12 pass, final test file (`offline-red.*`) |
| R3 Deno 2.1.4 runtime | **7/7** |
| R3 lab ts 10/13 vs ordering | **9/9** |
| R2 remote-test offline | **29/29** (superseded assertions updated, below) |
| R2 webhook replay / freshness (lab) | **15/15** |
| T10 + T3 + T4 + T5 + MP-B1.2 ordering (combined) | **149/149**, 0 skipped |
| T2 provider copy | 6/6 |
| MP-B1.2 migrations fresh 0000→0003 + upgrade, drift fail-closed | 2/2 |
| T6 unit | 31/32 (same as R2); the only failure is the accepted historical MP-A4 «U scope» freeze |
| T6 TEST, both gateways | 49/50 (same as R2); the only failure is the accepted «U scope» freeze |
| Static guard / migrations guard | `STAGING_STATIC_GUARD_OK secrets=0 unknownProjectHosts=0` / 8/8 |
| Invariants + secret scan (`invariants.json`) | PASS |

Not run: R4/R5 and browser journeys (no demonstrated regression; the frontend is byte-identical).

Historical assertions superseded by the R3 contract. These are minimal edits; the diff is in the commit.
- **T2 and T5 static scans, R2 D static scan:** they now also strip `const FORBIDDEN_PAYMENTS_ENV = new Set([...])` before scanning, exactly as they already strip `FORBIDDEN_DB_LOGINS`. The deny-list names forbidden variables on purpose; it is the guard, not a read.
- **R2 F module / verdict:** moved to the R3 API (13 digits valid, no trimming, duplicates refused).
- **R2 F duplicate-ts:** both orders are now 401 with 0 reads (previously the "future, now" variant was accepted).
- **R2 F source:** now expects the local verifier before freshness.

## Invariants

- Migrations 0000–0003 are byte-identical to both `bdc605fd` and MP-B1.2. There are exactly 4 and no new migration.
- Payment EXECUTE = **4** (live ACL); 0 API privileges on the watermark.
- **Frontend byte-identical. Core byte-identical. The whole `torneos-gateway/` directory is byte-identical, including `/exchange`.**
- Payments `index.ts`, `db.ts`, `rpc.ts`, `lab-fetch.ts` and `remote-hosts.ts` are unchanged.
- The shared provider copy is byte-pinned.
- 0 secrets in 39 changed files, the evidence and the container logs.
- **0 operational remote calls:**
  - lab egress without masquerade, Mercado Pago hosts black-holed, modules from a scratch copy of the local Deno cache;
  - Deno harness offline;
  - no Deno login / org / app, no deploy, no provisioning, no Supabase project, no real secrets, no Mercado Pago credentials, Core Staging / Production untouched.
- Lab destroyed (`cleanup.json`): 0 containers / volumes / networks. The temporary `compose.yaml` edit was restored; `.runtime`, the copied `node_modules` and the cache copy were removed. `node_modules` was copied from the MP-B1.2 worktree (same lockfile); nothing was downloaded.

## Files

- **Runtime (payments only):**
  - `torneos-payments/config.ts` (H1, H2);
  - new `torneos-payments/webhook-signature.ts`;
  - `torneos-payments/webhook-freshness.ts` (raw ts, 10/13 digits);
  - `torneos-payments/handler.ts` (wiring);
  - `torneos-payments/hmac.ts` (export of two helpers).
- **Tests:**
  - new `deno-runtime-hardening.test.mjs`, `deno-runtime-compat.test.mjs`, `webhook-ts-ordering.test.mjs`, `r3-invariants.mjs`;
  - updated `remote-test-enablement.test.mjs`, `payments-config.test.mjs`, `payments-provider-copy.test.mjs`.
- **Evidence:** this directory only; all tagged regression outputs were moved into `regression/`.

Reproduce:
- `node --test integration/torneos-core-contracts/deno-runtime-hardening.test.mjs` (offline).
- `DENO_BIN=<local deno 2.x with cached npm:jose@6.2.12 + npm:postgres@3.4.7> node --test integration/torneos-core-contracts/deno-runtime-compat.test.mjs`.
- Lab, with `TORNEOS_LAB_MODE=commerce`, a fresh lab and egress without masquerade:
  1. `webhook-ts-ordering.test.mjs` and `webhook-replay.test.mjs`;
  2. the MP-B1.2 combined command;
  3. `node integration/torneos-core-contracts/r3-invariants.mjs` before destroying the lab.

## Remaining blockers (REMOTE_PLATFORM, not code)

These are listed in `deno-deploy-isolation-contract.json → pendingRemotePlatformChecks`:
- create exactly 2 apps;
- 0 organization variables;
- no DB integration: payments refuses `DATABASE_URL` / `PG*`; the gateway relies on this platform check (not runtime-refused there in R3);
- secret-flagged variables not exposed to builds or previews;
- **app root = `backend/torneos/supabase/functions`**, and boot verified on the platform's current Deno 2.x;
- bind the declared hosts over HTTPS;
- restrict organization membership: every member is an owner;
- an end-to-end real Mercado Pago TEST notification (observe 10 vs 13 digits).

Non-blocking follow-ups:
- the 3 pre-existing gateway type diagnostics;
- optional gateway boot refusal of `SUPABASE_*` admin / `DATABASE_URL` / `PG*`, symmetric to payments;
- a lockfile for npm integrity pinning on the platform.
