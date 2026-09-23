# MP-A4 — gateway commerce (local mock only): decisions, open risks and follow-ups

Scope of MP-A4: `POST /commerce/v1/season-checkout` and the commerce TEST read allowlist in both Torneos
gateways (Edge `torneos-gateway`, Node lab `gateway.mjs`), through ONE shared module
(`torneos-gateway/commerce.ts`). There is no frontend, no real Mercado Pago and no remote target.
`torneos-payments`, the provider, migrations 0000/0001/0002, the staging-v1 allowlist (43), `/exchange`,
the token format, the Core client and the adapter are unchanged.

## Decisions taken inside the brief

| Topic | Decision |
|---|---|
| Node/Edge parity | Both gateways import the same `commerce.ts`. The config loader, allowlist validation, route order, body validation, HMAC call, error mapping, timeouts and logging exist once. Each gateway lends its own certified primitives through hooks: bridge verification, Core session check, identity lookup and dependency classification. Parity is by construction, and T6 also checks it live: every case runs on both gateways, 59 verdict rows, all identical. |
| HMAC | The gateway imports `signInternal` from `torneos-payments/hmac.ts` (the MP-A3 signer, unmodified). T6 verifies the live signature with the MP-A3 `verifyInternalRequest`. |
| Node config channel | The Node lab gateway reads `.runtime/server/commerce.env`, its private 0600 config directory, like all its other config. It never uses its container env. With no file, the module is never loaded. `lab.mjs` deletes the file outside commerce mode. |
| Edge env | `torneos-edge-main/env.ts` passes `TORNEOS_PAYMENTS_INTERNAL_URL` and `_SECRET` to the gateway worker only when `TORNEOS_COMMERCE_MODE` is set. MP-A3's OFF isolation (T5) is therefore unchanged. |
| Fail-closed | A faulty commerce config disables the whole gateway: 503 `access denied` on every request, with one boot log line that carries no values. This applies to both gateways. |
| Lab-only TEST | Commerce TEST requires a gateway published on loopback and an internal URL of `http://{torneos-functions,localhost,127.0.0.1}/…/torneos-payments`. A hosted gateway, or any https or public URL, is refused. |
| Methods | Any non-POST method on the route, or a trailing slash, gets 404 `not found`. This matches the existing gateway convention, for example `GET /exchange`. |
| Body limits | Over 1 KiB (declared or streamed) → 413 `TORNEOS_CHECKOUT_TOO_LARGE`. Invalid input → 400 `TORNEOS_CHECKOUT_INVALID`. Both are checked only after auth steps 2–4. |

## Error mapping (gateway answer; body `{ "error": <code> }`)

| Source | Answer |
|---|---|
| no / invalid bearer, invalid bridge, revoked Core session, unknown identity, `TORNEOS_AUTH_REQUIRED`, PostgREST 401 | 401 `access denied` (as today: at most one re-exchange) |
| Core unreachable (GoTrue health, contract 5xx) | 503 `CORE_UNAVAILABLE` |
| Torneos identity store / PostgREST down, 5xx without a business code, 4 s timeout | 503 `TORNEOS_UNAVAILABLE` |
| `TORNEOS_BILLING_FORBIDDEN`, `TORNEOS_PURCHASE_FORBIDDEN` | 403 (same code) |
| `TORNEOS_SEASON_ALREADY_PREMIUM`, `…_PREMIUM_SUSPENDED`, `TORNEOS_IDEMPOTENCY_CONFLICT`, `TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT`, `TORNEOS_PRODUCT_UNAVAILABLE`, `TORNEOS_OFFER_UNAVAILABLE` | 409 (same code); matched by message token, because PostgREST sends 55000 as 500 |
| purchase `expired` (DB), or payments `preference_expired` | 409 `TORNEOS_CHECKOUT_EXPIRED` |
| payments `purchase_not_payable` / `preference_conflict` (races) | 409 `TORNEOS_PURCHASE_NOT_PAYABLE` / `TORNEOS_PREFERENCE_CONFLICT` |
| payments 503, unreachable, 8 s timeout | 503 `TORNEOS_PAYMENTS_UNAVAILABLE` |
| contract faults (payments 401/400/404/413/422/502, malformed answers, unknown DB 4xx) | 502 `TORNEOS_CHECKOUT_FAILED` |
| purchase not open (`pending`, `approved`, `cancelled`, …) | 200 `{purchase, preference: null}` (no payments call) |

## Open risks

| # | Risk | Status | Needed before |
|---|------|--------|---------------|
| G1 | **Stale `purchase` in the response.** `purchase` is the DB projection returned at step 6. For a new checkout it says `status: created` / `providerPreferenceId: null`, even though `preference` was just recorded. | Documented contract. The client should rely on `preference`, and re-read through `get_tournament_purchase` when it needs the state. | MP-A5 frontend. |
| G2 | **Project-wide Edge secrets (MP-A3 R5).** On hosted Supabase the gateway would see `MERCADO_PAGO_*` and the payments DB login. In TEST, `commerce.ts` refuses to boot when it sees them. Separately, TEST is lab-only by design. | Fail-closed. Commerce cannot be enabled on a hosted project today. | Production: a separate deployment boundary for payments, plus a reviewed non-lab URL policy. |
| G3 | **Plain-http internal hop (MP-A3 R7).** Gateway → payments runs on the internal lab network. It carries HMAC over path/time/nonce/body and a per-isolate nonce cache. | Lab-only by URL validation. | Hosted: https to the platform function URL, plus a decision on a shared replay store. |
| G4 | **Timeout vs provider completion.** The gateway stops at 8 s. The payments service or Mercado Pago may still create the Preference afterwards, leaving an orphan (MP-A3 R4). | T6-H (slow stub): a retry with the same key completes with one purchase, and the Preference is reused through `X-Idempotency-Key = purchase.id`. | Production: reconcile orphans (MP-A3 R4). |
| G5 | **Shared open purchase.** A second billing manager using a different key gets the same open purchase and its checkout URL (`existingOpenPurchase: true`, baseline DB semantics). | Intended: one open purchase per season, and nobody without `billing.manage` + season access can reach it. | A product decision if per-buyer checkouts are wanted. |
| G6 | **T5 wording.** MP-A3 T5 still asserts that the gateway *env/config files it inspects* hold no payments secret, and it passes unchanged. In commerce TEST the gateway holds exactly the internal HMAC key, by design, in separate files (`server/commerce.env`, `torneos-gateway-commerce.env`). | T6 freezes the new separation: exactly 3 variables, never Mercado Pago or payments-DB values, 0600. | None. |
| G7 | **D1 still applies.** With the Core contract down, the Edge gateway refuses session-gated requests (`CORE_UNAVAILABLE`), while the Node gateway keeps its DB-to-DB session check (certified D1). Commerce inherits this. | Not re-exercised by T6. T6 stops GoTrue, which both gateways refuse identically. | None (certified D1). |
