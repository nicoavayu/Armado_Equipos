# GATEWAY/AUTH G1 + G2 — GATEWAY_AUTH_LOCAL_READY (2026-09-25)

**Base:** certified tip `5cf93a2e`. The work is local only:

- 0 remote calls of any kind: no Management API, no Supabase, no Deno Deploy, no Core.
- 0 remote writes.
- No push, no PR.

## Verdict

- **G1 — resolved.** The gateway accepts Core Production `rcyuuoaqfwcembdajcss` exclusively as the HTTPS authority (`CORE_AUTH_URL`, `CORE_JWT_ISSUER`, `CORE_CONTRACT_URL`), and never as a data backend.
  - Naming Core Production (or the Torneos ref `onzpwnqxnvlgsevivngf`) selects a pinned Production topology.
  - iss/aud, RS256, TTL 120 s, tolerance 5 s and `/exchange` are unchanged. There is no migration 0004.
- **G2 — resolved.** There is new Production tooling in `backend/torneos/infra/torneos-gateway-auth/`.
  - It has 7 fail-closed modes and 0 Supabase Edge Functions.
  - It has no dependency on `phase3b/remote`, which is kept as history.

## Evidence (this directory)

| File | sha256 (16) | What |
|---|---|---|
| `rehearsal-20260925T200820Z/REHEARSAL-result.json` | `5f53f53c58936f73` | offline rehearsal **37/37 PASS**: runner, all modes + negative controls, E2E real gateway 17/17, Deno 2.1.4 leg |
| `local-tests-20260925T200849Z.json` | `d99a9687e873b8a3` | 15 suites (counts below) |
| `postgrest-measurements-20260925T200541Z.json` | `8f8651d4214f35c5` | PostgREST v14.15 pre_request startup window + `jwt-aud` matrix (measurement, not a gate) |
| `../../../infra/torneos-gateway-auth/pins/gateway-auth-delta.json` | `169f2b1458843d40` | new delta pin (derived from a rolled-back run of the exact bootstrap SQL; reproduced by later runs) |

Earlier rehearsal runs of the same day failed on rehearsal fixtures only, and were deleted:

- a table without `id`;
- the Core contract fixture answering `active:false` instead of 403;
- no-op sleeps during the PostgREST restart.

They were fixed. Two findings came out of them: the payments-login measure counted superusers, and the pins directory was missing. Both were fixed in the tooling.

## Tests (local, offline)

| Suite | Result |
|---|---|
| G1 `gateway-topology.test.mjs` (new) | 5/5 (49 FAIL cases + PASS matrix) |
| G2 `gateway-auth.test.mjs` (new) | 14/14 |
| `phase3b/gateway-port.test.mjs` (updated) | 6/6 (was 5/6 at 5cf93a2e: stale console.log assertion vs the MP-A4 audit hook, now pinned exactly) |
| `torneos-foundation/foundation.test.mjs` | 53/53 |
| `core-prod-contract/core-prod.test.mjs` | 41/41 |
| `deno-runtime-hardening.test.mjs` (guard narrowed for topology.ts pins; a planted hostname is still caught) | 30/30 |
| `deno-runtime-compat.test.mjs` (Deno 2.1.4) | 8/8 |
| `remote-test-enablement.test.mjs` | 30/30 |
| `commerce-gateway.test.mjs` | 31/33 — same 2 as at 5cf93a2e (U scope diff vs the MP-A4 base) |
| `payments-config.test.mjs` | 11/19 — same 8 as at 5cf93a2e (need the running Docker lab) |
| phase3b r42 / route-fault / core-contract / d1-managed / inventory | 11/11 · 3/3 · 32/32 · 4/4 · 20/20 |

`phase3b/r42/worker-invocation.test.mjs` cannot run here, because it bundles `npm:jose` from registry.npmjs.org and this session has no network. That is environmental and unrelated.

## Future remote writes (NOT executed)

| # | Mode | Write | PAT (Organization gwqrborhnqjdzzmpxulh, 24 h) |
|---|---|---|---|
| W1 | `--auth-lockdown` | `PATCH /v1/projects/onzpwnqxnvlgsevivngf/config/auth` with exactly `{disable_signup:true, external_email_enabled:false, external_phone_enabled:false, external_anonymous_users_enabled:false, site_url:"https://app.arma2.com.ar"}` | **Auth Config RW + Project Settings RW**; Read: Database, Edge Functions, Org Settings, Projects |
| W2+W3 | `--db-bootstrap` | psql, ONE transaction: 2 × `CREATE ROLE torneos_edge_* LOGIN NOINHERIT PASSWORD '<SCRAM>'`, 2 GRANTs, `ALTER ROLE authenticator SET pgrst.db_pre_request='private.check_token'`, NOTIFY | PAT read-only (Auth Config, Connection Pooling, Database, Edge Functions, Org Settings, Project Settings, Projects); DB write = Keychain installer password |
| KR | `--keyring-generate` | LOCAL: Keychain `arma2-torneos-prod-bridge` + `pins/production-bridge-jwks.json` | read-only |
| W5 | `--b03` | `POST /v1/projects/onzpwnqxnvlgsevivngf/config/auth/third-party-auth` `{custom_jwks:{keys:[k1,k2 public]}}` | **Auth Config RW**; Read: API Keys, Database, Edge Functions, Org Settings, Project Settings, Projects |
| — | `--preflight` / `--deploy-preflight` / `--certify` | none | read-only (11 / 11 / 10 Read permissions) |

Only one payments-related check is made: 0 payments logins. Nothing is deployed, and the gateway is still `NOT_DEPLOYED`.

## Measured risks (not blockers)

- **PostgREST startup window.** PostgREST v14.15 served for about 1 s without the in-DB pre_request in 1 of 4 connection-recovery starts.
  - Only tokens it already trusts pass in that window.
  - Identity gating stays in `current_identity_id()` and RLS.
  - `--b03` re-probes, bounded and read-only.
- **Host `aud` handling.** With `jwt-aud=authenticated`, PostgREST refuses bridge tokens (`PGRST303`). With it unset or set to `arma2-torneos-local`, they reach the identity gate.
  - The hosted setting is unknown.
  - `--b03` measures it and STOPs with `B03_HOST_REJECTS_BRIDGE_TOKEN`: an iss/aud human decision. No migration now.
- **Keychain storage of the ring.** The pty storage of 100-char ring parts has not been exercised against the real Keychain.
  - The failure mode is fail-closed, and recovery is manual.
  - B03 is a separate mode, so nothing remote is involved.

## Pending human decisions

1. The external gateway public URL and the Deno Deploy organization. `GATEWAY_DEPLOY_DECISIONS` is null, so `--deploy-preflight` stays BLOCKED until they are set.
2. The source of the Core Production publishable key (`CORE_ANON_KEY`, public) for the gateway env.
3. Capacitor. The single certified origin `https://app.arma2.com.ar` is kept, and `capacitor://localhost` and `https://localhost` are refused (proven in E2E). Supporting them needs a multi-origin policy decision, reported separately. Nothing was widened.
4. If `--b03` measures `B03_HOST_REJECTS_BRIDGE_TOKEN`: the iss/aud decision and a possible migration 0004.
5. The go for each remote mode, in order W1 → W2+W3 → KR → W5 → deploy phase → `--certify`.
