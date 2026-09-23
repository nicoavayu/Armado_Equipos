# MP-A3 — torneos-payments (local mock only): open risks and follow-ups

Scope of MP-A3: the `torneos-payments` Edge Function (internal Preference endpoint + Mercado Pago
webhook), the byte-identical provider copy, the dedicated DB login, the lab `mp-stub` and suites T2–T5.
No gateway commerce route, no frontend, no real Mercado Pago, no remote target.

The following are **known and deliberately unresolved**. They block Production (and a real Mercado Pago
TEST sandbox run where noted). They are not MP-A3 local blockers.

| # | Risk | Where it stands after MP-A3 | Needed before |
|---|------|-----------------------------|---------------|
| R1 | **`x-signature` freshness.** The reused provider validates the official manifest (`id;request-id;ts`) but does not bound `ts`. A captured, validly signed notification can be replayed. | Unchanged on purpose: the provider stays byte-identical. Replay can only re-trigger an idempotent re-read of the *current* provider state. The DB deduplicates per (event, payment, status). | Production: a freshness window, or a request-id replay store, in a reviewed provider revision. |
| R2 | **Lost webhook reconciliation.** If Mercado Pago gives up retrying, a paid purchase can stay `pending` / `preference_created`. | No reconciliation job exists. | Production: a periodic re-query of open purchases (search payments by `external_reference`). |
| R3 | **Partial refund.** `refunded` is treated as a total refund, which revokes the grant. Partial refunds (`status_detail` / `transaction_amount_refunded`) are not distinguished. | Same semantics as legacy. | Production: a product decision plus provider handling. |
| R4 | **Orphan preference.** A Preference is created at Mercado Pago, then `record_tournament_purchase_preference` fails, times out, or loses a race (409 `preference_conflict`). The MP preference then exists without a DB record. A retry on a `created` purchase reuses the same `X-Idempotency-Key = purchase.id`, so Mercado Pago returns the original preference. That preference carries the first attempt's expiry, while the DB records the retry's `now + 30 min`. | Harmless in the lab. The binding check (`order.preference_id == purchase.providerPreferenceId`) refuses any payment made on a preference the DB does not own (422, no mutation). The mismatch is bounded by the 30-minute TTL, plus the wrapper's 15-minute grace. | Production: reconcile or expire orphans, and use MP's returned `expiration_date_to` as the recorded expiry. |
| R5 | **Project-wide secrets on hosted Supabase.** Edge Function secrets are shared by every function of a project. In the lab, `torneos-edge-main/env.ts` hands each worker only its own variables: the gateway gets no `MERCADO_PAGO_*`, and payments gets no Core, bridge or gateway-DB keys. That isolation **does not exist** on the platform. | Code-level isolation only: payments never reads a Core, bridge or service key (T2/T5 static guards). Its config refuses any non-TEST `MERCADO_PAGO_*` variable. | Production: a separate project or deployment boundary for payments, or an accepted risk decision. |
| R6 | **Baseline `apply_tournament_purchase_reversal`** (service_role only) can insert `restored` after `revoked` when called directly. The MP-A2 wrapper blocks that path (`reversal_ignored_after_revocation`, T4). | MP-A3 never uses `service_role`. `torneos_payment_service` cannot execute the baseline function (T5, live 42501 plus `has_function_privilege = f`). The code allowlist (`rpc.ts`) refuses the name before any SQL is built. | Production: fix or revoke the baseline function (a baseline change). |
| R7 | **Internal nonce replay cache is per isolate.** Within the ±30 s window, a captured internal request could be replayed on another worker instance. | The endpoint is idempotent per purchase. A replay can only return the same preference or reuse it. | MP-A4 (gateway): the gateway→payments hop must stay on a private channel, with the secret held only by the gateway. |
| R8 | **Lab `APP_PUBLIC_URL`.** It is `https://torneos-mp-a3.lab.invalid`, which is non-routable and passes the provider guard unchanged. The provider was not relaxed for localhost. The lab MP origin override is accepted only together with `.invalid` public URLs and the lab DB host. | Lab only. | A real sandbox run needs a real public https app URL and notification URL. |

Other notes:
- The DB `CHECK`s make provider, environment, amount and currency violations impossible in the lab
  DB. T3 therefore covers the TypeScript defence-in-depth checks offline, and shows in the lab that
  the DB refuses such rows (23514) and that non-MP purchases are invisible to the payment service (404).
- Webhook `Origin` → 400 (inside the webhook status matrix). Internal `Origin`/`Authorization` → 403.
  Body over the limit → 413 on both routes. The internal endpoint also uses 409 (`purchase_not_payable`,
  `preference_expired`, `preference_conflict`) and 502 (`provider_response_invalid`).
