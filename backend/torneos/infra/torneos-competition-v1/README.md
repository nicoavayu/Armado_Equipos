# COMPETITION-V1 REMOTE — Phase G tooling (G1 read-only, W1 DB, W2 gateway, rollbacks)

Target: Arma2 Torneos `onzpwnqxnvlgsevivngf` and the Deno Deploy app `torneos-gateway` (`5d4f18e9…`). Core, Vercel and
Mercado Pago are out of scope: this tooling has no endpoint for any of them.

## What each step does

| step | kind | exactly |
|---|---|---|
| **G1** | read-only | DB: one `BEGIN TRANSACTION READ ONLY … ROLLBACK` per query, with `PGOPTIONS=-c default_transaction_read_only=on`, as `postgres.<ref>` over the sa-east-1 Session Pooler (`verify-full`, Supabase CA). It checks the state of the 38 functions + the fixed function (grants, owner, definer, body md5) and the counts. It diffs the foundation catalog pin, the gateway-auth / payments delta pins and the COMPETITION-V1 per-state pin. It reads the `anon` statement timeout. Bundles: the previous source is rebuilt from git `bea307a3` (must equal the deploy pin `723c5d39…`) and the candidate is built at HEAD (must equal `pins/competition-v1-gateway-candidate.json`). Deno (session only): app, env names / secret flags / non-secret value digests, and the current revision (must be `3rvq2wx9tyyg`, label `bea307a3`). Probes: B7 + the competition probe set for the **previous** source. |
| **W1** | 1 psql transaction | `00000000000004_competition_v1_rpc_exposure.sql`, re-hashed right before sending (`36e45edd…`). Precondition `PRE_0004` (or `ROLLED_BACK`) with zero drift. Postcondition `POST_0004`: 162 / 12, fixes present, catalog = pin. |
| **W2** | 1 Deno revision | `POST /v2/apps/torneos-gateway/deploy` with **assets + labels only**: env is not part of the request, so it cannot change. Preconditions: DB `POST_0004`, current revision = pin, candidate digest = pin. Postcondition: revision succeeded and live, env identical, candidate probes pass. It then writes `pins/competition-v1-gateway-deploy.json`. |
| **W2 rollback** | 1 Deno revision | Redeploy of the previous source rebuilt from git (digest must equal `723c5d39…`), then the previous probe set. |
| **W1 rollback** | 1 psql transaction | `competition-v1/rollback/…rollback.sql` (`29d84770…`): REVOKE of the 15; the two fixes stay. **Refused while the gateway serves the candidate** (order: W2 rollback first). |

Every write prints `PLAN <id>`, needs the exact phrase for that id, re-observes the state it was planned on, is sent once
(no retry) and is followed by a read-only postcheck. Evidence goes to `backend/torneos/competition-v1/evidence/remote/`;
it is secret-scanned against every value the process holds and written with `wx`.

Phrases:

- `APPLY TORNEOS MIGRATION 0004 COMPETITION-V1 onzpwnqxnvlgsevivngf <plan>`
- `DEPLOY TORNEOS GATEWAY COMPETITION-V1 torneos-gateway <plan>`
- `ROLLBACK TORNEOS GATEWAY torneos-gateway TO bea307a3 <plan>`
- `ROLLBACK TORNEOS MIGRATION 0004 COMPETITION-V1 onzpwnqxnvlgsevivngf <plan>`

## Credentials

| credential | where | used by |
|---|---|---|
| installer password | Keychain `arma2-torneos-dataplane-db` / `postgres` (existing) | G1 DB reads, W1, W1 rollback |
| bridge ring k1 | Keychain `arma2-torneos-prod-bridge` (existing) | probes: tokens minted for RANDOM users only (never reach data) |
| Deno Deploy organization token | typed on the tty by the operator (**a new one**) | G1 Deno leg, W2, W2 rollback |
| Supabase PAT | **not used** | — |

## Commands

```
node backend/torneos/infra/torneos-competition-v1/competition-session.mjs g1            # read-only, no Deno leg
ARMA2_SESSION_DIR=<abs dir, 0700> bash backend/torneos/infra/torneos-competition-v1/run-competition-session.sh
#   then, on $ARMA2_SESSION_DIR/ctl, one line at a time:
#   g1 | db | deno | probes-previous | probes-candidate | w1 | w2 | w2-rollback | w1-rollback | quit
```

After W2, the real-user probe `browser-competition-probe.js` (`torneosCompetitionProbe('candidate')`) runs inside
`https://app.arma2.com.ar` with the operator's session. It only reads, or calls write RPCs with random ids that each
function's guard refuses.

## Tests

```
node --test backend/torneos/infra/torneos-competition-v1/competition-remote.test.mjs   # offline, 7 tests
node backend/torneos/infra/torneos-competition-v1/offline-rehearsal.mjs                 # Docker, real Postgres, 24 checks
```

- The unit tests drive the REAL gateway `handle()` of both sources (bea307a3 extracted from git, and the candidate), with a
  fake Deno API and a fake DB.
- The rehearsal applies 0000–0003 as `postgres` on `supabase/postgres:17.6.1.147` and derives
  `pins/competition-v1-db-delta.json`. It proves 0004, its idempotent re-apply, the rollback (idempotent) and re-apply after
  rollback, all as the non-superuser installer. It then runs G1 → W1 → W2 → W2 rollback → W1 rollback → W1 on the real
  database with the real tooling, including drift and wrong-phrase refusals.
