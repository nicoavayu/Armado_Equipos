# Core lab — Arma2 Core on this machine

A disposable, local-only Core backend for reviewing security, stability, performance
and UX with real services and QA data. Nothing here can reach Production, Staging or
any remote project: there is no Supabase CLI, no project ref and no product `.env`.

| Piece | Runtime | Notes |
| --- | --- | --- |
| Core schema | `supabase/postgres:17.6.1.143` | every `supabase/migrations/*.sql`, applied as `postgres` |
| Auth | GoTrue `v2.194.0` | magic links land in the local **Mailpit** — no real email is sent |
| REST | PostgREST `v14.15` | anon / authenticated / service_role exactly as hosted |
| Storage | storage-api `v1.67.15` | file backend in a Docker volume |
| Realtime | Realtime `v2.113.4` | `postgres_changes` for the tables the app subscribes to |
| Edge Functions | edge-runtime `v1.74.2` | only user-facing Core functions; `verify_jwt` mirrors `supabase/config.toml`; **push senders are not mounted** |
| API origin | `core-api.mjs` (Kong substitute) | `http://127.0.0.1:58530`, CORS for the lab app origin only |

Only the API origin (`127.0.0.1:58530`) and the Mailpit UI (`127.0.0.1:58531`) are
published, on loopback. Secrets are generated into `.runtime/` (ignored, `0600`) and are
never printed.

## Use

```sh
node integration/core-lab/lab.mjs up        # fresh volume → all Core migrations (~3 min the first time)
node integration/core-lab/lab.mjs seed      # QA fixture (below)
node integration/core-lab/lab.mjs app       # web app on http://127.0.0.1:3110 against the lab
node integration/core-lab/lab.mjs down      # stop, keep data
node integration/core-lab/lab.mjs destroy   # stop and drop every volume
```

`app` goes through `npm run qa:start:local`, which refuses any non-loopback backend.
Core is native-only in Production; on the web it opens only for a non-production,
isolated backend, so the launcher sets exactly those flags (`src/utils/runtimePlatform.js`).

## QA accounts

Sign in at `http://127.0.0.1:3110/login` → **Continuar con email** → open the link in
Mailpit (`http://127.0.0.1:58531`).

| Account | Who | What it has |
| --- | --- | --- |
| `organizador@arma2.lab` | Lucía, habitual organizer | 3 matches (upcoming with spots, full, finished with open survey), 5 friends, a pending friend request, team "Los Pibes FC" (owner) |
| `jugador1…9@arma2.lab` | players | rosters, friendships; `jugador7`/`jugador8` hold a pending match invitation, `jugador4` a team invitation |
| `nuevo@arma2.lab` | brand-new account | nothing — first-run experience |
| `ajeno@arma2.lab` | unrelated account | its own private match only — permission checks |

Lab-only passwords for automation are in `.runtime/qa-users.json`.

## Checks

```sh
node --test integration/core-lab/tests/*.test.mjs   # needs `up` + `seed`
node integration/core-lab/probe-exposure.mjs        # what anon / unrelated / new accounts can read
```
