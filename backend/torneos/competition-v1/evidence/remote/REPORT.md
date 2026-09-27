# COMPETITION-V1 (remote) — TORNEOS_FULL_COMPETITION_REMOTE_CERTIFIED (2026-09-27)

**Scope.** This is the Production backend rollout of the COMPETITION-V1 contract ([`../../REPORT.md`](../../REPORT.md)):

- data plane Arma2 Torneos `onzpwnqxnvlgsevivngf`: migration `00000000000004_competition_v1_rpc_exposure.sql` (W1);
- Deno Deploy app `torneos-gateway` (`5d4f18e9…`): one new revision of the gateway source (W2).

Core Production is read-only, Vercel is untouched (Torneos frontend Production still gated OFF), commerce stays OFF on
the gateway and Mercado Pago LIVE is never configured.

**Tooling.** `backend/torneos/infra/torneos-competition-v1/` at `ee34b2a7` (chain `344f3353..ee34b2a7` on `main`
`ff9f9a77`). Every file in this directory except this report and `SHA256SUMS` was written by that tooling (`wx`,
secret-scanned against every value the process held) and is copied byte for byte from the operator session's working
tree, as is `pins/competition-v1-gateway-deploy.json`. This closeout changes no code.

## Verdict

| Step | Result |
|---|---|
| G1 (read-only, with the Deno leg) | **G1_PASS** — DB `PRE_0004` 147/12, no catalog drift, gateway = deployed source, probes 35/35 |
| W1 (one psql transaction, plan `c3c0977ce529`) | **W1_APPLIED** — `PRE_0004` → `POST_0004`, 147/12 → **162/12** |
| W2 (one Deno revision, plan `7e47a4ff6e8f`) | **W2_DEPLOYED** — `3rvq2wx9tyyg` → **`66we8r12079d`**, live, env 13/13 unchanged, candidate probes **43/43** |
| Real-user probe (`torneosCompetitionProbe('candidate')`) | **9/9 PASS**, 0 data rows written |
| Rollback | **NOT REQUIRED** |

## Evidence files

| File | sha256 (16) | Verdict | Note |
|---|---|---|---|
| `cv1-01-g1-20260927T160730Z.json` | `2643d407ab18c513` | G1_PASS_WITHOUT_DENO_OBSERVATION | first G1, no Deno token (non-interactive `g1`) |
| `cv1-01-g1-20260927T161927Z.json` | `865682d6dbb27612` | G1_FAILED | only failure: the org-apps pin listed the gateway alone; the token also sees `torneos-payments-test` → pin fixed in `de591589` |
| `cv1-01-g1-20260927T162248Z.json` | `edf49b7f27ffdf91` | **G1_PASS** | the gate for W1/W2: Deno leg + DB + bundles + probes, 0 writes |
| `cv1-01-g1-20260927T162739Z.json` | `3cb3dc2dbf4c49a5` | G1_PASS_WITHOUT_DENO_OBSERVATION | re-check right before W1, still `PRE_0004` |
| `cv1-01-w1-20260927T163256Z.json` | `4e22687df15129de` | **W1_APPLIED** | psql code 0, 2195 ms, stderr empty |
| `cv1-01-g1-20260927T163506Z.json` | `04d5d736ca16192a` | G1_FAILED (expected) | post-W1 read-only observation: G1 is the PRE_0004 gate, so its only failure is `DB_STATE_POST_0004` — i.e. it confirms W1; probes (previous) 35/35 because the gateway was still `3rvq2wx9tyyg` |
| `cv1-01-w2-20260927T164533Z.json` | `ff208335f6cc0d79` | **W2_DEPLOYED** | one `write:deploy` (202), every other Deno request a GET |
| `../../../infra/torneos-competition-v1/pins/competition-v1-gateway-deploy.json` | `05125ae74977f94a` | — | public facts of the live revision (source files + digests, env names / digests, no values) |

`SHA256SUMS` in this directory binds every file above.

## W1 — Torneos DB (`onzpwnqxnvlgsevivngf`)

- Migration sha256 `36e45eddf57690470d80a0284f454a74ebfe4135cf89cbc0f4274ffdf41e3729`, re-hashed right before sending;
  transport psql over the sa-east-1 Session Pooler, `verify-full`, as the installer (`postgres`).
- State `PRE_0004` → `POST_0004`; `authenticated` EXECUTE on public functions 147 → 162, `anon` 12 → 12.
- Function body transitions (md5):
  - `update_draft_fixture(uuid,uuid,text,jsonb)` `390a1e4cae6af1973ead63563a71b08f` → `53fd2b4bc95a86434c7e5b8e1e938275`
    (season authorization);
  - `publish_tournament_document_version(uuid)` `1000277b885896c3311b04ad960cf4b9` → `6830b726fc3aa23342ab7fed2b1d5348`
    (permission check before any lookup).
- The 15 new grants go to `authenticated` only: `anon`, `PUBLIC` and server roles unchanged; the 17 kept-revoked and 6
  service-only functions stay closed; owner `postgres`, `SECURITY DEFINER`, pinned `search_path` on all of them.
- `anon` statement timeout 3 s unchanged; foundation catalog, gateway-auth and payments delta pins: no drift.

## W2 — gateway (`torneos-gateway`)

- Previous revision `3rvq2wx9tyyg` (label `bea307a3`, bundle `723c5d3928741af906771923fab8ac9c54dd9eee58d266cec3a7fa4cd3fa5514`, 14 files).
- New / live revision **`66we8r12079d`** (labels `custom.git_head=ee34b2a7…`,
  `custom.bundle_digest=75e3535acc3fba99c871ee820d1927e1c695eba4c10044ec4e6ffda38b59afc7`), 16 files, status succeeded,
  deployed 2026-09-27T16:45:33Z, production timeline only.
- The deploy request carries assets + labels only: env 13/13 identical before and after (non-secret values by digest,
  the 4 secrets by name / flag — values never returned).
- Candidate probes 43/43: `/config`, `/health`, JWKS (k1 active + k2 standby, no private member), CORS (exact origin;
  foreign / null / look-alike → 403), `/exchange` refusals, token contract, commerce OFF (commerce RPC and checkout RPC →
  403 `rpc not enabled`, `/commerce/v1/season-checkout` → 404), and the COMPETITION-V1 route set.
- The candidate digest is reproducible from this branch: building the gateway bundle at the PR head gives
  `75e3535a…` (the closeout adds no gateway file).

## Real-user browser probe (after W2)

`browser-competition-probe.js`, `torneosCompetitionProbe('candidate')`, run in the operator's own browser on
`https://app.arma2.com.ar` (the only allowed origin) with the operator's existing Core Production session, 2026-09-27
16:56Z. The result object carries statuses and error codes only; it is not a tooling file, so it is recorded here:

| # | Check | Observed |
|---|---|---|
| 1 | `POST /exchange` with the Core session | 200 |
| 2 | staging v1 `get_my_tournament_memberships` (unchanged) | 200 |
| 3 | service-only `archive_tournament_fixture` | 403 `rpc not enabled` |
| 4 | OFF feature `lock_tournament_roster` | 403 `rpc not enabled` |
| 5 | `get_player_tournament_matches` (self-scoped) | 200 `array(0)` |
| 6 | `get_managed_tournament_matches` (self-scoped) | 200 `array(0)` |
| 7 | `publish_tournament_fixture` (granted by 0004), random ids | 403 `42501` `TORNEOS_RESOURCE_FORBIDDEN` (function guard — grant live, no write) |
| 8 | `publish_tournament_document_version` (guard-order fix), random version | 403 `42501` `TORNEOS_DOCUMENT_FORBIDDEN` |
| 9 | public route, unknown slug, no credential | 200 `null` |

**9/9 PASS.** Every write RPC was called with random ids that its own guard refuses; `/exchange` reused the operator's
existing shadow identity. Real data rows written: **0**. The probe ran twice because the first console output was
truncated; the table is the second, complete output. The Deno session was then closed (`quit`).

## Post-certification read-only pin check (PR precheck, 2026-09-27 ~17:10Z)

From the PR branch, no Deno token, no evidence write: DB `POST_0004`, 162/12, fix md5s `6830b726` / `53fd2b4b`, 15/15
grants `authenticated` only; gateway candidate probe set 43/43 (health, JWKS, CORS, commerce OFF, public route). The
Deno revision id is not observable without an operator-typed Deno token; the live behavior matches the candidate source
and not the previous one (the previous source has no public route and no competition RPCs).

## Rollback (not required; documented)

Order: **W2 rollback first, then W1 rollback** (the tooling refuses W1 rollback while the gateway serves the candidate).

- W2 rollback: redeploy the previous source rebuilt from git `bea307a3` (digest must equal `723c5d39…`), then the
  previous probe set. Phrase `ROLLBACK TORNEOS GATEWAY torneos-gateway TO bea307a3 <plan>`.
- W1 rollback: `competition-v1/rollback/00000000000004_competition_v1_rpc_exposure.rollback.sql`
  (sha256 `29d84770d6f886f3bec19e2f6a87d1185a7fa7968755a9c94e53653103885c82`) REVOKEs the 15 grants; **the two security
  fixes stay**. Phrase `ROLLBACK TORNEOS MIGRATION 0004 COMPETITION-V1 onzpwnqxnvlgsevivngf <plan>`.

## Not done / out of scope

- Vercel: no env change; `REACT_APP_TORNEOS_PRODUCTION_ENABLED` is not set in Production, so Torneos stays fail-closed.
- Commerce / billing OFF; Mercado Pago LIVE not configured; media and Social Studio closed.
- No Core change; no Supabase CLI; no PAT.
