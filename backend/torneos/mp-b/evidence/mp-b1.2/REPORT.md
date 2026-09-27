# ARMA2_TORNEOS_MP_B1_2_PROVIDER_ORDERING

Parent: `38c9669d60ee96020c64e5c0c83bb0fd636b100a`. Branch: `codex/torneos-mp-b1-2-provider-ordering`.
Worktree: `/Users/nicoavayu/Downloads/arma2/arma2-mp-b1-2-provider-ordering`.
The implementation commit is the commit containing this report (its hash is supplied in the delivery).

Migration: `00000000000003_mercadopago_provider_ordering.sql`.

## Provider authority

Reviewed official Mercado Pago documentation on 2026-09-24:

- [Checkout Pro GET payment](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/get-payment/get), the same `/v1/payments/{id}` consumed by the adapter, includes `date_last_updated`.
- [Payment response field definition](https://www.mercadopago.com.co/developers/en/reference/online-payments/checkout-api-payments/update-payment/put) defines it as “Date on which the last payment event was recorded.”
- [Payment search](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/search-payments/get) supports ordering by `date_last_updated`.

These documented semantics support chronological snapshot comparison for the same payment. The reviewed documentation does NOT guarantee strict monotonicity, a distinct timestamp per transition, or precision greater than seconds. `date_last_updated` is the best available ordering signal, not a documented sequence counter. Equal timestamps with incompatible normalized state therefore fail closed with durable manual review and no automatic tie-breaker. No webhook timestamp, reception time, invented sequence or local clock is used. PostgreSQL compares timestamptz instants; the handler preserves the original offset and fractional precision (up to PostgreSQL microseconds).

## Durable contract

One private watermark per (purchase, payment). It stores provider time, normalized state identity and the two existing manual-action flags needed for replay without changing refund/review policy. Purchase `FOR UPDATE` precedes comparison and remains held through commercial transition and watermark update. Exceptions/transaction rollback roll back both. Distinct attempts have separate watermarks.

Newer snapshots run the unchanged MP-A2 commercial policy; older snapshots preserve commercial state and add a deduplicated stale audit event; equal compatible snapshots do nothing; equal incompatible snapshots durably mark manual review and audit the conflict, report `provider_ordering_anomaly` with manual review and preserve current state. The manual-review flag remains sticky on replays and later versions. Audit metadata contains only payment ID, provider timestamps and whitelisted normalized states; never raw payloads, credentials or payer PII. Stale/duplicate responses preserve previously determined manual-action flags. No backfill invents ordering timestamps for historical unversioned snapshots: the first verified version establishes the watermark. This local certification concerns the versioned contract, not a remote migration/backfill procedure.

The two existing seven-argument functions are renamed as internal policy implementations and all API/service EXECUTE privileges are revoked. Their replacements require an eighth timestamptz argument. The payment role still has exactly four executable functions, no table/sequence privileges and no unordered bypass. The browser and gateway have no new input or access. Provider re-fetch and all existing seller, payment/preference, amount, currency and test-mode bindings remain mandatory.

## Verification

**MP_B1_2_PASS.** One local implementation commit; no push/PR/deploy.

| Check | Result |
| --- | --- |
| Test-first RED on runtime base | 10/10 fail, including delayed old disputed and concurrent old/new (ordering-red.txt) |
| Review RED against initial fix | 2/2 fail: durable anomaly and stale audit (review-red.txt) |
| Final provider ordering suite | 23/23 PASS |
| T10 complete | 49/49 PASS, including concurrency/idempotency and 48 multi-pending sequences |
| T3 / T4 / T5 | 23/23, 32/32, 18/18 PASS |
| Combined final run | 149/149 PASS (includes four suite parent tests), 0 skipped |
| Additional T2 provider parity | 6/6 PASS: both shared provider files remain byte-identical to legacy |
| Fresh 0000→0003 / committed 0000→0002 + restart + 0003 upgrade | 2/2 PASS in isolated cached-image container with network none |
| Drift preconditions | Missing function, changed SECURITY DEFINER, missing EXECUTE all abort before new objects |
| Migration guard / static guard | 8/8 PASS / secrets=0, unknownProjectHosts=0 |
| ACL | Exactly 4 payment EXECUTE; no API/service access to watermark or unordered policy helpers |
| Secret/invariant scan | See invariants.json and secret-scan-live.json (captured before cleanup); exact ephemeral lab secrets, credential patterns, source/evidence and container logs |

Final run: regression.txt. T10 and T3–T5 machine-readable evidence is in backend/torneos/mp-a/evidence with the mpb12 suffix. Fresh-install hashes are in fresh-install.json. Migration exercise: migration-install.txt. Independent-review focal GREEN: review-green.txt.

The tests cover restored→stale disputed, approved→stale pending/rejected, refunded→stale approved, duplicate grant/suspend/revoke, actual SQL lock contention and two independent handlers with old re-fetch paused until newer restoration commits. Equal pending/approved timestamps persist manual review and one sanitized audit without commercial mutation; compatible and conflicting replays retain the flag. NOT_READY rolls back without creating a watermark and the same timestamp succeeds after preference recording. Settled revocation survives stale dispute/restore/approve and a newer restoration. HTTP timestamp tests cover offset/Z/no fraction/1–6 fractional digits, rejection of greater precision and invalid timezone, body forgery, and retryable 503 for obsolete RPC errors. The seven-argument function no longer exists.

No gateway RPC contract changed: the modified RPCs belong exclusively to torneos-payments, so T6 focal was not required. R4/R5 were not run. Historical T10 reapply probes restore the old signatures only inside rollback, so they cannot downgrade the live ordered contract.

Maximum effective grants per season = 1; maximum live grants per season = 1. No new manual-refund, partial-refund, reconciliation, orphan-preference or remote gateway policy was introduced.

Reproduce from a fresh local lab with TORNEOS_LAB_MODE=commerce and PHASE3A_LAB_PROJECT=arma2-mpb12:
- node --test --test-concurrency=1 integration/torneos-core-contracts/commerce-db.test.mjs integration/torneos-core-contracts/payments-checkout.test.mjs integration/torneos-core-contracts/payments-webhook.test.mjs integration/torneos-core-contracts/payments-config.test.mjs integration/torneos-core-contracts/provider-ordering.test.mjs
- node --test --test-concurrency=1 integration/torneos-core-contracts/provider-ordering-migrations.test.mjs
- node integration/torneos-core-contracts/provider-ordering-invariants.mjs

Use an empty lab for the migration chain; do not reapply 0002 over 0003. The existing lab readiness check briefly reported a database ready during initial Postgres setup; retry after initialization succeeded without changing the certified harness.

## Scope

Frontend, Core, gateway and migrations 0000/0001/0002 are unchanged. Production remains OFF. No R4/R5, push, PR, deploy, provisioning, provider credentials or operational remote API calls. Public documentation was consulted through web search; this is not a claim of zero documentation-network requests.

All runtime tests use local Docker and synthetic provider fixtures. The temporary local compose configuration disables outbound masquerading for function containers and uses the pre-existing host Deno cache; images and Node dependencies were already local. The compose file is restored before delivery. No real Mercado Pago request was made.

Local lab cleanup verified: 0 containers, 0 volumes and 0 networks for arma2-mpb12 (cleanup.json). Temporary runtime secrets are removed before delivery.
