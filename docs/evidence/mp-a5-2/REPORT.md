# ARMA2_TORNEOS_MP_A5_2_PLAN_REFRESH

Verdict: **MP_A5_2_PASS**

Base / parent: `6e70cabfe990e2285928dfa3736a700d3d889716`.
Branch: `codex/torneos-mp-a5-2-plan-refresh`.
Worktree: `/Users/nicoavayu/Downloads/arma2/arma2-mp-a5-2-plan-refresh`.
Commit: the single local commit containing this report (resolve with `git log -1 --format=%H`).

## Cause and fix

PurchaseStatus read server entitlements into its own presentation state while Plan used the competition context's old projection. Client navigation preserved that context.

PurchaseStatus now reuses the existing `retryPlan()` for its active season in hybrid mode. This performs the server read, clears the shared projection while loading, and updates the context and status presentation from the same normalized response. No new store, context API, transport, manual Premium assignment or reload was introduced. A ref keeps context render changes from restarting purchase reads. Request generations discard superseded responses and prevent local state updates after unmount. A shared entitlement read already in flight can finish after navigation and update Plan through the provider's existing mounted/request guards.

Legacy keeps its previous commerce path; the shared refresh only runs with `entitlementsAuthority` and a matching active season. Standalone compositions retain their existing adapter read.

## Test-first evidence

`red.log`: on unchanged base runtime, five transition tests failed at the actual Plan heading after client navigation; unchanged entitlement passed (5 RED / 1 GREEN). The failure covers pending approval, rejected attempt approval on the same purchase, refund, chargeback, and restoration.

`green.log`: **7 suites / 87 tests PASS**: MP-A5.2 (10), PurchaseStatus, PlanExperience, hybrid commerce MP-A5, MP-A5.1 routes, CompetitionContext, canonical tournament context. Additional tests exercise polling, repeated navigation without request loops, navigation during a pending entitlement read, superseded responses, timer cleanup, and fail-closed entitlement errors. Legacy regression is included in PurchaseStatus and PlanExperience.

`node.log`: **58/58 PASS** frontend foundation/transport/adapter/commerce. An initial inventory assertion flagged an import line-number shift; retaining the existing commerce import's position resolved it without changing any test or certified inventory.

`static.log`: **STAGING_STATIC_GUARD_OK secrets=0 unknownProjectHosts=0**.
`eslint.log`: no lint errors (existing Browserslist age notice only).
`git diff --check`: PASS.

## Focal browser repro

`browser.mjs` is adapted from the existing MP-A5 harness and uses the real local Core login, gateway, payments service, database and signed webhooks, with only Checkout Pro fulfilled locally and provider responses supplied by mp-stub. Other external browser hosts are aborted.

`browser.json` / `browser.log`: **3/3 PASS**:

1. Login → Plan Free → buy → pending; approval arrives while PurchaseStatus is open; polling shows Premium; “Volver al Plan” shows Premium with no buy button.
2. Browser history returns to PurchaseStatus in the same document; refund arrives; “Actualizar” → refunded; “Volver al Plan” shows Free.
3. One checkout request, one purchase, same Preference; exactly one grant after approval, no effective grant after refund.

A per-document marker survives both journeys, proving no reload. The first harness attempt failed selecting a season link on the organization overview; the focal harness now opens the canonical Plan URL after login. No product change was made for that fixture/navigation issue. The lab initially lacked its own node dependencies; `npm ci` using its existing lockfile fixed the gateway startup. No backend/config changes were needed.

## Integrity and scope

`integrity.json` records full SHA ancestry, unchanged original worktree status, migration SHA and allowlist counts. The only runtime diff is PurchaseStatusPage.jsx. Backend, migrations (0000/0001/0002), gateway, MP-A3, MP-A4, Core, /exchange, transport and flags are byte-identical to the parent. Staging allowlist remains 43; commerce reads remain 2. Migration 0002 SHA remains `06378f12b57620e8ae550a0d881ad66464ffdc0a734ad621cba8a6ba3e6d6078`.

Production remains OFF; no real Mercado Pago or remote operations. Exact lab-secret scanning of the runtime, tests and evidence passed. No previous evidence or T6 freeze was changed. Full MP-A6 and the known environmental staging-live suite were not rerun.

Files: PurchaseStatusPage.jsx, torneosMpA52PlanRefresh.test.jsx, and this MP-A5.2 evidence directory. One local commit only; no amend, push, PR, merge or deployment. Stop after MP-A5.2.
