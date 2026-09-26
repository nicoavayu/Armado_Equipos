# GATEWAY REMOTE — Production keyring/B03 session + Deno Deploy gateway

This directory runs the remote half of the gateway/auth phase in **one operator session**:

- Phase A: KR and B03, through the certified `../torneos-gateway-auth` modes, unmodified.
- Phase B: deploy the certified gateway to Deno Deploy and run the basic certification.
- Phase C: the operator side of the remote E2E.

The architecture is the certified one:

- Core Production is the only identity authority.
- `/exchange` lives on the Torneos gateway, which is an external Deno Deploy app, never a Supabase Edge Function.
- The bridge uses RS256 with TTL 120 s and tolerance 5 s.
- iss/aud are unchanged.
- Commerce stays OFF.

## Session

```
ARMA2_SESSION_DIR=<absolute dir, mode 0700> bash backend/torneos/infra/torneos-gateway-remote/run-remote-session.sh
```

**Credentials.** The human types two tokens on the tty, with echo off:

- the Supabase scoped PAT: Organization `gwqrborhnqjdzzmpxulh`, 24 h. The permissions are the union of the session's gateway-auth modes, printed by the wrapper: reads plus **Auth Config: Read-write** for B03.
- a Deno Deploy organization token.

Both are piped to `remote-session.mjs` on stdin and live only in its memory. Keychain values are read into memory when a step needs them:

- the bridge ring;
- the Core contract secret `arma2-torneos-prod-core-contract/contract-secret`;
- the two gateway DB logins.

**Control.** Commands and plan phrases arrive one line at a time on the FIFO `$ARMA2_SESSION_DIR/ctl`. The session appends a redacted transcript to `$ARMA2_SESSION_DIR/transcript.log`. Every write prints `PLAN <id>` and requires the exact phrase for that id. The certified gateway-auth modes read their phrase from the same FIFO.

| Command | Kind | What it does |
|---|---|---|
| `ga --preflight` / `--keyring-generate` / `--b03` / `--deploy-preflight` / `--certify` | as certified | `../torneos-gateway-auth/gateway-auth.mjs` modes, same plans and phrases |
| `deno-observe` | read | apps, layers, the gateway app (env names/flags only), revisions |
| `create` | write, `CREATE TORNEOS GATEWAY DENO APP torneos-gateway <plan>` | `POST /v2/apps`, then deploy revision 1 |
| `publish-url` | write, `DEPLOY TORNEOS GATEWAY torneos-gateway <plan>` | `PATCH` `TORNEOS_GATEWAY_PUBLIC_URL`, deploy revision 2, write `pins/gateway-deploy.json` |
| `probe` | read | the B7 probe set on the live gateway |
| `db-identities` | read-only SQL | `torneos_identity` count |
| `quit` | — | wipes the in-memory secrets and exits |

**`create` details.**
- The app is created with app-level variables only, 0 layers, no install/build/predeploy step, `crons: false` and entry `torneos-gateway/index.ts`.
- The app root is `backend/torneos/supabase/functions`, so the repo-root `package.json` stays out of Deno's scope.
- `TORNEOS_GATEWAY_PUBLIC_URL` is not set yet. Until it is, the gateway boots disabled and every request gets 503 (fail closed).

**`publish-url` details.** The URL is the Deno default alias `https://torneos-gateway.<org>.deno.net/functions/v1/torneos-gateway`. There is no custom domain.

**Deno Deploy API v2 allowlist.**
- Only the app `torneos-gateway`.
- Writes are armed one at a time and bodies are pinned:
  - env names are exactly the 13 the real `config.ts` reads;
  - secrets are flagged `secret: true`;
  - `contexts: all`;
  - `production: true`, `preview: false`;
  - the assets are exactly the gateway module graph.
- The following are refused by name or pattern: `CORE_SERVICE_ROLE_KEY`, `CORE_JWT_SECRET`, `CORE_DB_URL`, `SUPABASE_*`, `DATABASE_URL`, `PG*`, `MERCADO_PAGO_*`, `TORNEOS_PAYMENT*` and `TORNEOS_COMMERCE_*`.

**`CORE_ANON_KEY`** is the Core Production anon-level key, read from the public Production web bundle (`/torneos` → `main.*.js`). Exactly one key must be present, it must be for Core Production, and its role must be `anon`. No Core Management API call is made for it: the Core api-keys listing would also return admin material.

**Deployed source** (`gateway-bundle.mjs`) is the static graph of `torneos-gateway/index.ts`:
- 14 files, including `torneos-payments/hmac.ts` and `remote-hosts.ts`;
- bare specifiers exactly `npm:jose@6.2.12` and `npm:postgres@3.4.7`;
- files must equal HEAD.

## B7 probe set (`gateway-probe.mjs`)

The probe set covers:

- `/health`;
- `/.well-known/jwks.json` = exactly the pinned public k1 + k2;
- `/config` without secrets;
- foreign, `null` and look-alike Origin → 403;
- CORS preflight;
- another hostname of the app → 403 (Host check);
- `/exchange`: without a bearer → 401, a non-Core bearer → 401, identity/role input → 400, oversized body → 4xx;
- RPC without a bearer → 401;
- commerce RPCs and the checkout route while commerce is OFF → 403 / 404;
- allowlisted RPC with a valid k1 token for a Core user that does not exist → 401, because the live Core authority is asked;
- expired, TTL-broken, foreign-key and `aud=authenticated` tokens → 401;
- unknown paths → 404;
- no response carries any secret the session holds.

Nothing is written: `/exchange` is never called with a valid Core bearer here. The real exchange (it creates exactly the shadow identity of the signed-in user) is the Phase C E2E, driven in the browser from `https://app.arma2.com.ar`.

## Tests

```
node --test backend/torneos/infra/torneos-gateway-remote/gateway-remote.test.mjs
```

The suite runs offline. It covers:

- the allowlist and bodies;
- the module graph;
- the Production env validated by the **real** `config.ts`: production topology, commerce off, ring = pin, Supabase host and commerce refused;
- the Core public key source;
- the whole B7 probe set against the **real** gateway `handle()`, with Core Production emulated in-process;
- C4 fault injection: a Core contract 5xx → `503 CORE_UNAVAILABLE`, GoTrue down → 503, Core unreachable → 503;
- the session's create → publish-url flow against a fake Deno API: a wrong phrase writes nothing, and the transcript, evidence and pin carry no secret.
