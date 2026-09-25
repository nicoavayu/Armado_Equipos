# GATEWAY/AUTH — Production gateway/auth tooling (G1 + G2)

This directory prepares the gateway/auth phase of Arma2 Torneos. Nothing in it has run against a remote project.

| Role | Project | What this tooling does there |
|---|---|---|
| Core authority | Core Production `rcyuuoaqfwcembdajcss` | GET project + GET the certified `torneos-core-contract` (ezbr `10724195…`). Never a write, never a DB connection. |
| Torneos data | Arma2 Torneos `onzpwnqxnvlgsevivngf` (sa-east-1) | The writes W1, W2+W3 and W5 below, each in its own mode, after its own phrase. |
| Retired | Core Staging `hhyvmhgpapyuzjgxfnqv`, old `giaeztyghmhzcngskjmw` | GET project only: both must stay `INACTIVE`. |
| Gateway | external app (Deno Deploy) | Nothing. `--deploy-preflight` validates its Production env against the real `config.ts`, offline. |

The certified flow is unchanged:

```
Core session → POST <Torneos gateway>/exchange → gateway checks Core over HTTPS → RS256 bridge token (TTL 120 s, tolerance 5 s)
→ Torneos REST through the gateway (Core session re-checked) → PostgREST: custom_jwks + pgrst.db_pre_request → Torneos DB
```

## G1 — the gateway accepts Core Production as the authority, never as data

The rule lives in `supabase/functions/torneos-gateway/topology.ts`. It is enforced by `config.ts` (boot) and `core-client.ts` (contract URL).

- **Core authority plane:** `CORE_AUTH_URL`, `CORE_JWT_ISSUER` and `CORE_CONTRACT_URL`. These are reached only over HTTPS.
- **Torneos data plane:** `TORNEOS_REST_URL`, `TORNEOS_DB_IDENTITY_WRITER_URL` and `TORNEOS_DB_CORE_ADAPTER_URL`.
- A data-plane URL that names any Core project (Production or Staging), in its host, login, path or options, is refused. There is no DB-to-DB path and no Torneos REST on Core.
- An authority URL that names the Torneos project is refused.
- Each plane names exactly one project (or none: the loopback lab), and the two planes never name the same project.
- Naming Core Production or the Torneos project selects the **Production topology**. It pins both halves exactly:
  - the canonical URLs;
  - the `torneos_edge_*` logins on the sa-east-1 pooler or the direct host;
  - `TORNEOS_DB_SSL_CA` is required;
  - origin is exactly `https://app.arma2.com.ar`;
  - no Supabase or Edge Function host for the gateway itself;
  - commerce is OFF.
- A Production half paired with a non-Production half is refused.
- In every topology:
  - `CORE_SERVICE_ROLE_KEY`, `CORE_SECRET_KEY`, `CORE_JWT_SECRET`, `CORE_DB_URL` and `CORE_DATABASE_URL` are refused;
  - so is any Core JWT above `anon` under any name;
  - the `apikey` values must be public-level;
  - DB logins `postgres`, `supabase_*`, `service_role`, `authenticator`, the API roles and the payments role are refused.

The following are untouched:

- `token.ts`: RS256, TTL 120, tolerance 5, iss `urn:arma2:local:identity-bridge`, aud `arma2-torneos-local`;
- `/exchange` semantics, `CORE_UNAVAILABLE`, `db.ts` and `adapter.ts`;
- migrations (there is no 0004).

## G2 — modes

```
run-gateway-auth.sh --preflight          READ-ONLY        state of W1 / W2+W3 / KR / W5 + measured installer privileges → STOP
run-gateway-auth.sh --auth-lockdown      W1 (API write)   PATCH /v1/projects/<torneos>/config/auth
run-gateway-auth.sh --db-bootstrap       W2+W3 (psql)     ONE transaction on Arma2 Torneos
run-gateway-auth.sh --keyring-generate   LOCAL write      new Production ring → Keychain + pins/production-bridge-jwks.json
run-gateway-auth.sh --b03                W5 (API write)   POST /v1/projects/<torneos>/config/auth/third-party-auth
run-gateway-auth.sh --deploy-preflight   READ-ONLY        gateway Production env vs the real config.ts; lists pending decisions
run-gateway-auth.sh --certify            READ-ONLY        post-gateway/auth certification
```

Every mode follows the same pattern:

1. Load the pins. If the foundation contract or pin changed (sha256), stop.
2. Observe everything:
   - Core Production and the contract ezbr;
   - Staging and old `INACTIVE`;
   - Torneos `ACTIVE_HEALTHY`, with no stray project in the org;
   - 0 Edge Functions;
   - the foundation catalog, strict paths other than the delta;
   - the state of W1, W2+W3, KR and W5.
3. Refuse anything out of order: W1 → W2+W3 → KR → W5.

Every write mode then continues:

4. Print the plan and its id.
5. Take the exact phrase from `/dev/tty`.
6. Re-observe. The plan id must be unchanged.
7. Perform only its declared write. There is no retry.
8. Post-check, then write evidence.

A second run of a write mode is `…_ALREADY_APPLIED` and writes nothing.

| Mode | Phrase |
|---|---|
| `--auth-lockdown` | `LOCK TORNEOS AUTH onzpwnqxnvlgsevivngf <plan>` |
| `--db-bootstrap` | `BOOTSTRAP TORNEOS GATEWAY DB onzpwnqxnvlgsevivngf <plan>` |
| `--keyring-generate` | `GENERATE TORNEOS PRODUCTION BRIDGE RING <plan>` |
| `--b03` | `PUBLISH TORNEOS B03 CUSTOM JWKS onzpwnqxnvlgsevivngf <plan>` |

### Remote delta, exactly

**W1 — Auth lockdown.** The body is exactly six keys: `{disable_signup: true, external_email_enabled: false, external_phone_enabled: false, external_anonymous_users_enabled: false, site_url: "https://app.arma2.com.ar", mfa_totp_enroll_enabled: false}`.
- `mfa_totp_enroll_enabled` joined the body on 2026-09-25: the hosted default is `true`, and the first W1 pre-check stopped on it (`ga-02-auth-lockdown-supplement-pre-20260925T204557Z.json`, 0 writes).
- Every other sign-in / enrollment path is a check only, never written: `AUTH_MUST_BE_OFF` (custom OAuth, OAuth server, passkeys, SAML, manual linking, phone / WebAuthn MFA enroll, Web3, Google, Apple, GitHub, Azure, the access-token hook) plus every other `external_*_enabled` and `hook_*_enabled` the API returns (37 flags on the hosted project). Any that is not `false`, or a named one missing from the answer: STOP.
- Pre-check also requires 0 `auth.users` and 0 third-party auth integrations.
- The post-check compares a per-key sha256 of the WHOLE Auth answer before and after (kept in memory; only key names reach evidence): any key outside the body that moved fails it. Then GoTrue on the Torneos host (`auth-probe.mjs`) must answer `/settings` locked and refuse email signup, anonymous signup, email OTP and phone OTP (`.invalid` address, the first 2xx stops); after the probes: still 0 users, 0 third-party auth, nothing moved.

**W2 + W3 — one psql transaction.** It runs over the Session Pooler as `postgres.<torneos>`, `verify-full`, with the SQL on stdin:
```
BEGIN; SET LOCAL statement_timeout = '30s';
DO … RAISE EXCEPTION 'GATEWAY_LOGINS_ALREADY_PRESENT' if either login exists …;
CREATE ROLE torneos_edge_identity_writer LOGIN NOINHERIT PASSWORD '<SCRAM-SHA-256 verifier>';
CREATE ROLE torneos_edge_core_adapter    LOGIN NOINHERIT PASSWORD '<SCRAM-SHA-256 verifier>';
GRANT torneos_identity_writer TO torneos_edge_identity_writer;
GRANT torneos_core_adapter    TO torneos_edge_core_adapter;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'private.check_token';
NOTIFY pgrst, 'reload config'; NOTIFY pgrst, 'reload schema';
COMMIT;
```
- Login passwords are generated inside `keychain-gateway-auth.py` into `arma2-torneos-gateway-db/<login>`.
- The server only receives SCRAM verifiers (RFC 7677, checked against the RFC vector). The plaintext never reaches the server, its logs or `pg_stat_statements`.
- No payments login is created.
- If the transaction fails it rolls back whole. A later run reuses the custody and does not regenerate it.

**KR — local only.** k1 (active) and k2 (standby) are generated in memory: RSA 2048, RS256.
- Kids are `arma2-torneos-prod-k<n>-<thumbprint16>`.
- There is no import path.
- Private halves go to Keychain `arma2-torneos-prod-bridge` as `k<n>.meta` plus `k<n>.part0..19`. Each line is under 100 characters (the macOS getpass limit is 128), is read back and compared, and is re-derived against the pin.
- Public halves go to `pins/production-bridge-jwks.json`.

**W5 — B03.** The body is exactly `{"custom_jwks": {"keys": [<k1 public>, <k2 public>]}}`. It carries no issuer, no `jwks_url` and no private member.
- Before the write, bridge tokens must be refused by the host.
- After the write, `bridge-probe.mjs` measures, without assuming. At most 6 read-only re-probes run, 10 s apart:
  - k1 and k2 tokens for a non-existent identity must reach the identity gate (`401 PT401 invalid identity token`);
  - an unknown key, a foreign HS256 token and `alg=none` must be refused before the DB;
  - anon still reads the public-page table.
- If the host refuses a k1 token itself, for example because it pins another `aud`, the run STOPs with `B03_HOST_REJECTS_BRIDGE_TOKEN`. That is a human decision about iss/aud and a possible migration 0004. It is never silent.

### Scoped PAT per mode

Resource access is always Organization `gwqrborhnqjdzzmpxulh`, with a 24 h expiry. Each wrapper prints the exact list.

| Mode | Permissions |
|---|---|
| `--preflight` | Read: API Keys, Auth Config, Connection Pooling, Data API Config, Database, Edge Function Secrets, Edge Functions, Migrations, Organization Settings, Project Settings, Projects (account-wide) |
| `--auth-lockdown` | **Auth Config: Read-write**, **Project Settings: Read-write**, API Keys: Read (publishable key for the GoTrue refusal probes), Database: Read, Edge Functions: Read, Organization Settings: Read, Projects (account-wide): Read |
| `--db-bootstrap` | Read: Auth Config, Connection Pooling, Database, Edge Functions, Organization Settings, Project Settings, Projects. The DB write uses the Keychain installer password (`arma2-torneos-dataplane-db/postgres`), not the PAT. |
| `--keyring-generate` | Read: Auth Config, Database, Edge Functions, Organization Settings, Project Settings, Projects |
| `--b03` | **Auth Config: Read-write**, API Keys: Read, Database: Read, Edge Functions: Read, Organization Settings: Read, Project Settings: Read, Projects (account-wide): Read |
| `--deploy-preflight` / `--certify` | Same as `--preflight` (read-only). `--certify` does not need Connection Pooling. |

## Certification (`--certify`)

`--certify` is the post-gateway/auth verdict. It does not reuse the foundation `--certify`, which by design expects no logins, no pre_request and no B03. It checks:

- Foundation intact: every foundation strict path except the four delta paths equals `torneos-foundation/pins/expected-catalog.json` (`5d66d4f4…`). Foundation invariants hold, except "0 Torneos logins".
- The delta pin (`pins/gateway-auth-delta.json`), derived by the rehearsal from a rolled-back run of the exact bootstrap SQL:
  - `roles`, `role_members`, `login_roles_torneos` = 2, `authenticator_pre_request` = `private.check_token`;
  - logins and memberships including their ADMIN/INHERIT/SET options.
- Invariants:
  - exactly the 2 `torneos_edge_*` LOGIN NOINHERIT roles, unprivileged;
  - each is a member only of its baseline role (SET, not ADMIN);
  - 0 payments logins;
  - no edge login reaches a privileged role;
  - the authenticator's `pgrst.*` settings are exactly the pre_request.
- Auth locked (W1), with 0 `auth.users`.
- `custom_jwks`: exactly one integration, with kids and digest equal to the pin and no private member.
- Platform:
  - 0 Edge Functions and `SUPABASE_*` secrets only;
  - empty migrations ledger;
  - no private schema exposed.
- PostgREST probes: the foundation set plus the bridge set.
- Core Production unchanged (project plus contract ezbr), Staging and old `INACTIVE`, no stray project.
- Gateway: `NOT_DEPLOYED`. It is out of scope until the deploy phase.

## Measured risks (offline)

- **PostgREST startup window.** PostgREST v14.15 can serve for about 1 s without the in-DB `pre_request` when it boots through connection recovery.
  - Reproduced locally: 1 of 4 isolated starts, and in the rehearsal (M01).
  - During that window only tokens it already trusts pass: k1/k2 (minted by the gateway) and the project's own keys.
  - Identity gating stays in `current_identity_id()` and RLS.
  - `--b03` absorbs the window with bounded read-only re-probes.
- **Host `aud` handling.** Local PostgREST with `jwt-aud` unset or `arma2-torneos-local` sends bridge tokens to the identity gate. With `jwt-aud=authenticated` it refuses them (`PGRST303`). The hosted setting is measured by `--b03`.
- **Keychain storage of the ring.** Values are kept under the getpass limit and read back. It has not been exercised against the real Keychain. The failure mode is `KEYCHAIN_STORE_FAILED` or a `PARTIAL` ring → STOP. Recovery is manual: delete `arma2-torneos-prod-bridge` entries in Keychain Access. Nothing remote is touched, because B03 is a separate mode.

## Tests and rehearsal

```
node --test backend/torneos/infra/torneos-gateway-auth/gateway-topology.test.mjs   # G1 PASS/FAIL matrix (real gateway sources)
node --test backend/torneos/infra/torneos-gateway-auth/gateway-auth.test.mjs       # G2 tooling
DENO_BIN=<deno 2.x> node backend/torneos/infra/torneos-gateway-auth/offline-rehearsal.mjs
```

The rehearsal runs entirely offline.

**Infrastructure:**
- Postgres 17.6.1.147 on an internal network.
- PostgREST v14.15 behind an emulated apikey gateway.
- An emulated Management API and Keychain.

**What it drives:**
- The real runner through every mode.
- Negative controls:
  - an Edge Function present;
  - out-of-order modes;
  - a wrong phrase;
  - state changing after the plan;
  - an unprivileged installer (rollback);
  - an edge login granted payments;
  - a payments login;
  - Torneos email re-enabled;
  - a stray project.
- The pre_request reload via NOTIFY.
- SCRAM logins.
- A real-gateway end-to-end run in the Production topology:
  - Core Production served as in-process fixtures;
  - Torneos REST routed to the local PostgREST;
  - postgres.js 3.4.7 behind an emulated Supavisor relay.
- A Deno 2.x boot with the Production topology and loopback-only network.
- A secret scan of every evidence file and the pin.

## Not in this tooling

- Deploying or configuring the gateway (Deno Deploy).
- The payments login and Mercado Pago.
- Edge Functions and secrets.
- The frontend.
- Rotation execution. `keyring.mjs → rotationPlan()` documents the order: POST the new integration before DELETE of the old one, drain ≥ 125 s.
- Capacitor origins: the single certified origin is kept; see the report.
