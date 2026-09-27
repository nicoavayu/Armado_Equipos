# ARMA2_TORNEOS_MP_B1_1_REMOTE_ENABLEMENT_R2

**MP_B1_1_PASS** — remote TEST commerce is a prepared, explicit, fail-closed capability. Nothing was provisioned or activated.

Base / parent: `1f8e560ff0fa1a064aed5621247550c0325b8cda` (MP-B1.2 PASS). Branch: `claude/torneos-mp-b1-1-remote-enablement-r2`.
Worktree: `/Users/nicoavayu/Downloads/arma2/arma2-mp-b1-1-remote-enablement-r2`. One local commit (the one containing this report); no push / PR / merge / deploy.
Precheck: `precheck.json` — exact HEAD, clean tree, linear single-parent chain `95521a5d → … → 38c9669d → 1f8e560f`, 0 merges, `origin/main` = `c2dfc3ed`, no remote branch contains an MP commit, migrations 0000–0003 present, MP-B1.2 evidence present. MP-B1 / MP-B1.1 (blocked) worktrees were not used as base; the original `arma2` worktree was not touched.

## Config model (gateway, `torneos-gateway/commerce.ts`, one loader for Node and Edge)

| `TORNEOS_COMMERCE_MODE` | `TORNEOS_COMMERCE_DEPLOYMENT` | Result |
|---|---|---|
| unset / blank | anything | **OFF** (nothing else is read; a deployment or hosts alone never enable commerce) |
| `test` | unset / blank / `local-lab` | **local-lab** — the certified MP-A4 behaviour, unchanged: loopback gateway, lab payments mount; declaring a remote host here is refused |
| `test` | `remote-test` | **remote-test** — only with every requirement below |
| `test` | anything else (`remote`, `prod`, `live`, `production`, case variants…) | config error → whole gateway disabled |
| anything but `test` | — | config error → whole gateway disabled |

remote-test requires, all explicitly: `TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST`, `TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST`, `TORNEOS_PAYMENTS_INTERNAL_URL` = exactly `https://<payments host>/functions/v1/torneos-payments` (byte-for-byte, optional trailing `/`), `TORNEOS_PAYMENTS_INTERNAL_SECRET` (≥ 32 bytes, distinct from Core/bridge material), the gateway's own public URL = `https://<gateway host>/functions/v1/torneos-gateway`, and every dependency URL the Edge gateway uses (Core Auth, JWT issuer, Core contract, Torneos REST, allowed browser origin) https and non-Production. Dropping any single one fails closed (config matrix in `offline.json`). No hosts are hard-coded: they are declared at provisioning time.

## Host validation (`torneos-payments/remote-hosts.ts`, shared)

Declared hosts must be one exact lowercase public DNS name (≥ 2 labels, ≤ 63-char labels, no scheme/path/port/userinfo/wildcard/trailing dot/IP literal/`localhost`/`.invalid`/`.local`/`.internal`). URLs are then compared by exact hostname — never suffix. Rejected and evidenced (`offline.json` → `hostValidation`): `pay.….example.com.evil.com` (suffix spoof), `evil.pay.…` (unauthorised subdomain), `xpay.…` (prefix glue), `https://pay…@evil.com`, `https://evil.com@pay…`, `user:pw@`, `http://` remote, `:8443`, explicit `:443`, uppercase, trailing dot, lab mount, wrong function, sub-paths, query, fragment, `..`, `%2D`, `\@`, scheme-less, lab hosts, missing hosts.

## Production fail closed

Refused for any declared host, gateway URL, payments URL or dependency URL: the Production Supabase ref anywhere in the hostname (Core Production), `arma2.com.ar`, `app.arma2.com.ar`, `www.arma2.com.ar`, the Vercel Production aliases of `main`, and any DNS label that is or is hyphen-joined with `live` / `prod` / `production` (`product`, `olive`, `delivery` are accepted, tested). The payments service applies the same Production-host refusal to `APP_PUBLIC_URL` and the notification URL; its TEST-only Mercado Pago contract is unchanged. The MP-A6 §11 Production fail-closed harness (run unmodified against this tree, output redirected) is **8/8 PASS**, including a local production build (no deploy) and the prebuild billing gate. remote-test is prepared, **not activated**; a future Core Production transition is a separate explicit phase (it would currently be refused).

## Webhook replay / freshness decision

Official Mercado Pago webhook documentation (reviewed 2026-09-24: [Checkout Pro webhooks](https://www.mercadopago.com.co/developers/es/docs/checkout-pro/additional-content/notifications/webhooks), [Checkout API webhooks](https://www.mercadopago.com.co/developers/es/docs/checkout-api-payments/additional-content/your-integrations/notifications/webhooks)) defines the `id;request-id;ts` manifest and a 10-digit example `ts`, **no maximum age / tolerance window**, and retries every 15 minutes that continue after the third attempt. Therefore:

- **No expiry TTL is invented.** An old authentic notification is accepted; it can only trigger a provider re-fetch.
- **Future bound: +300 s** (`WEBHOOK_FUTURE_SKEW_S`). A genuine `ts` precedes delivery, so it can exceed our clock only by skew; 300 s covers any realistic skew between NTP-disciplined clocks while refusing absurd values (key misuse, forged clock, unit mix-ups) **before any provider call** → `401 invalid_signature` (log code `invalid_signature_future_ts`), which Mercado Pago retries.
- The check runs after the certified HMAC verification (only an authenticated `ts` is judged) and parses `ts` exactly as the verifier does (last duplicate wins), so no differential parsing is possible (tested). The shared provider copy stays byte-identical to legacy.
- **webhook `ts` ≠ `payment.date_last_updated`.** `ts` authenticates/announces; only the re-fetched provider date orders state (MP-B1.2). The freshness module never reads the provider date; the handler never passes `ts` to the ordering RPCs (source-tested).
- Unchanged and still mandatory: HMAC, x-request-id, 10-digit `ts`, provider re-fetch, seller / payment / preference / amount / currency / `live_mode=false` bindings, body non-authoritative, DB idempotency.
- Note: some Mercado Pago pages describe `ts` as milliseconds while every example is 10-digit seconds; the certified verifier accepts only 10 digits. If the real TEST provider ever sent 13 digits, every webhook would fail closed (401) — detectable at the first remote TEST run, never insecure.

## Interaction with MP-B1.2 (lab, `webhook-replay.json`, 15/15)

Real torneos-payments function + real Torneos DB 0000→0003 + lab provider stub, notifications signed with the official manifest:
bad signature / other manifest / 9-, 13-digit / letter / missing `ts` → 401 with **0 provider reads**; authentic `ts` +301 s, +1 h, +1 day, +10 y → 401 with **0 provider reads**, domain untouched; `ts` −30 days → accepted, re-fetched, approved, 1 grant; +60 s accepted; exact replay ×3 → re-fetched each time, `provider_snapshot_duplicate`, no new event; repeated same payment → idempotent; duplicate refund / duplicate dispute → no new event; **old approved after refunded** → re-fetch sees refunded → stays refunded; **stale approved snapshot** after refunded → `stale_ignored`; **old disputed after restored** → stays approved, grant effective; **stale disputed snapshot** after restored → `stale_ignored`; **revoked** (buyer won) never revived by old approved / old dispute / stale restored. Max 1 grant everywhere. RED on the base: the future-`ts` case was accepted and consumed the approval (`webhook-replay-red.json`, 13/15).

## Secret isolation

Frozen by static contract + runtime (`offline.json` D): gateway sources read only gateway / Core public config / bridge / REST / commerce-link variables (incl. the internal HMAC key) and never a Mercado Pago token, webhook secret or payments DB login; payments sources (+ provider copy) read only MP TEST values, seller, public URLs, payments DB login, internal HMAC key — never Core, bridge, gateway DB or commerce values; frontend `src/` names no secret and exposes no `REACT_APP_*` secret. At boot (both deployments) the gateway refuses any `MERCADO_PAGO_*`, payments DB, provider, notification or lab variable. The lab router never forwards the remote-test variables (the lab cannot become remote-test). No remote secret store was created.

**Provisioning precondition (documented, not solved here):** hosted Supabase shares Edge Function secrets project-wide. If torneos-gateway and torneos-payments ran with one shared secret scope, the gateway would see Mercado Pago material and **refuse to boot** (fail closed, by design). Remote TEST therefore needs disjoint secret scopes for the two functions; the provisioning phase must choose how (this affects the planned single "Arma2 Torneos" project).

## Node / Edge parity

One loader (`loadCommerceConfig`) in both gateways; every config-matrix case gives the same verdict with the gateway URL as a URL object (Edge) or a string (Node) (`offline.json` → `parity`); both disable the whole gateway on `CommerceConfigError` (Edge `bootError`, Node 503). The Node lab gateway stays loopback-only (Host pinned), so remote-test fails closed on it through the same code. Regression found and fixed during this phase: the Node lab container mounts commerce.ts's imports explicitly, so the new `remote-hosts.ts` is now mounted in `compose.mpa.yaml`, guarded by a new offline check.

## Regression (commerce lab `arma2-mpb11r2`, local only)

| Suite | Result |
|---|---|
| R2 offline (config, hosts, Production, secrets, parity, freshness) | 29/29 (RED on base 14/28; the Node-mount guard was added after the finding) |
| R2 webhook replay / freshness (lab) | 15/15 (RED 13/15) |
| T10 + T3 + T4 + T5 + MP-B1.2 ordering (combined, as MP-B1.2) | **149/149**, 0 skipped |
| T2 provider copy | 6/6 (7 incl. parent) |
| MP-B1.2 migrations fresh 0000→0003 + upgrade, drift fail-closed | 2/2 |
| T6 unit | 31/32 — only the accepted historical MP-A4 «U scope» freeze (same as MP-A5/MP-A6) |
| T6 TEST, both gateways (local-lab commerce unchanged) | 49/50 — same single accepted «U scope» failure (MP-A6: 49/50) |
| MP-A6 §11 Production fail-closed | 8/8 |
| Static guard / migrations guard | PASS secrets=0 unknownProjectHosts=0 / 8/8 |
| Invariants + secret scan (`invariants.json`) | PASS |

Not run (out of scope, unchanged surfaces): R4/R5, browser journeys, full Jest (frontend byte-identical). Default-lab T6 OFF was not re-run: OFF returns before any changed code (unit-tested).

## Invariants

Frontend, Core, `/exchange`, pricing, grant policy, provider-ordering model and migrations 0000/0001/0002/0003 byte-identical to the base (no new migration); `index.ts` code diff is exactly the dependency-URL wiring; payment service holds exactly 4 EXECUTE, 0 API privileges on the watermark; staging allowlist 43 + commerce reads 2; 0 secrets in 31 changed files, evidence and container logs; lab egress without masquerade and Mercado Pago hosts black-holed (0 remote operational calls; documentation was read via web search/fetch only); lab destroyed: 0 containers / 0 volumes / 0 networks; temporary `compose.yaml` edit restored.

## Files

Runtime: `torneos-gateway/commerce.ts`, `torneos-gateway/index.ts`, `torneos-payments/config.ts`, `torneos-payments/handler.ts`, new `torneos-payments/remote-hosts.ts`, new `torneos-payments/webhook-freshness.ts`. Lab: `compose.mpa.yaml` (one mount). Tests/guards: `remote-test-enablement.test.mjs`, `webhook-replay.test.mjs`, `remote-test-invariants.mjs`. Evidence: this directory only.

Reproduce: `node --test integration/torneos-core-contracts/remote-test-enablement.test.mjs` (offline); with `TORNEOS_LAB_MODE=commerce` and a fresh lab: `node --test --test-concurrency=1 integration/torneos-core-contracts/webhook-replay.test.mjs`, then the MP-B1.2 combined command and `node integration/torneos-core-contracts/remote-test-invariants.mjs` before destroying the lab.
