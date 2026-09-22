# R5 — hybrid end-to-end certification (real user journey)

Certifies ONE real user journey through the R4-certified hybrid gateway, unchanged: Core staging
`hhyvmhgpapyuzjgxfnqv` (remote, HTTPS through the R4.1 exact-SNI proxy) → local Edge gateway
`127.0.0.1:58431` (R4.1 prepared bundle, memory custody) → Torneos REST/DB of R2 (local). No DB-to-DB,
no Core service role in Torneos, no second login, no fallback, no stale session or cache.

```
node --test backend/torneos/phase3b/r5/journey.test.mjs   # offline (9): plan ⊆ allowlist, journey assembly, fixtures, probes
node backend/torneos/phase3b/r5/rehearsal.mjs             # LOCAL R2: the same flow through direct PostgREST with seeded attestations; count-verified cleanup
bash backend/torneos/phase3b/r5/run-r5.sh                 # OPERATOR (tty, PAT): the certified run → r5-summary-<stamp>.json, verdict R5_HYBRID_E2E_CERTIFIED
```

## What runs (r42/operator.mjs mode `r5` → r5/journey.mjs)

The operator lifecycle is the R4.2 one, byte for byte where it matters: handoff check (R4.1A seal, R4.1B
prepared, R2 identity + catalog, 58431 free, no temporary resources) → Core project/function guards and
`api-keys?reveal=true` (Management API, PAT in memory) → authorization bound to the seal (`start-gateway`,
`smoke` only; no sealed certify for R5) → `runner.mjs preflight` → `audit.mjs start-gateway` → `runner.mjs smoke`
→ **journey** → Core verified read-only (sessions of every QA user, no QA leftover, the Core team fixture gone)
→ `runner.mjs cleanup` → R2 final check → `r5-cleanup-<stamp>.json`, `r5-summary-<stamp>.json`, `r5-terminal-<stamp>.log`.

Journey blocks (REQUIRED_BLOCKS, all must PASS): `core_login` · `exchange` · `shadow_identity` · `workspace` ·
`season` · `tournament` · `collaborator` · `team_registration` · `roster` · `invitation` · `core_team_import` ·
`p0_review` · `cross_user` · `cross_workspace` · `cross_season` · `bearer_invalid` · `bearer_expired` ·
`logout_revocation` · `core_unavailable` · `core_contract_failure` · `torneos_unavailable` · `gated_off` ·
`not_allowlisted` · `no_fallback` · `secret_boundary`; informative: `qa_users`, `core_fixture`, `cleanup`.

Actors: four dedicated Core staging QA users per run (`qa-r5-<run>-<role>-…@accounts.invalid`,
`app_metadata.purpose = phase3b-r5`): owner (organizer), admin (collaborator seated on season A), captain
(invited team manager), outsider (owner of another workspace). Every Core login is a GoTrue password grant;
every Torneos call carries the bridge bearer obtained at `/exchange`.

The owner journey (`flow.mjs`, only staging-v1 allowlisted RPCs — 42 of the 43 are exercised with a 200,
`archive_tournament_team_entry` is the one not reached): workspace → seasons → tournaments (registration open) →
collaborator seat (membership seeded per the Phase 2D contract: staging v1 has no membership RPC; the season
assignment is the RPC) → manual team entry (+ a withdrawn one) → basic roster (provisional players + the
captain's Core-backed identity) → `directory_players` live → invitation accepted live (`verified_email`) →
captain edits and submits → **Core team import**: the owner creates a Core team in Core staging the way the
app does (`POST /rest/v1/teams`, RLS owner-only), `directory_teams` live lists it, `create_tournament_team_entry`
with `p_arma2_team_id` freezes the live `team_snapshot`; a second import is refused; the outsider importing the
owner's team into their own workspace is refused by Core (404 `CORE_DENIED`, zero writes) → roster + invitation +
submit on the imported entry → P0 `review_tournament_team_entry`: changes_requested → fix → resubmit → seated
admin approves the manual entry, owner approves the imported one; denials write nothing.

Negatives, all fail closed with no fallback and no cached verdict: cross-user/workspace/season reads and
writes; forged/invalid bearers; a REAL expired bridge bearer (the run's first one, after its 120 s TTL);
Core `logout(others)` and `logout(local)` → 401 on the very next request; Core Auth transport reset, Core
contract transport reset and Torneos REST `/32` removal (run-owned proxy/gateway namespace only) with a WRITE
attempted during each fault and verified to have landed nowhere; the certified offline outage harness (real
gateway modules, `--network none`) for contract 5xx/timeout/stale/malformed/schema/active:false; the 33 gated
RPCs and a non-allowlisted RPC (`create_tournament_venue`) refused by the gateway before PostgREST.

## Cleanup (always, count-verified)

Owner deletes the Core team (`DELETE /rest/v1/teams`, owner-only RLS) → every QA session logged out
(`scope=global`) → QA users hard-deleted after the identity/purpose guard → the pre-deletion bearer is refused →
every Torneos row of the run removed in one transaction (registry + run slugs) with per-table counts verified
against the pre-run baseline before COMMIT → catalog SHA unchanged → Torneos `auth.users` still 0. The operator
then confirms through the Management API (read-only SQL) that no QA session, no QA user and no Core team remain,
removes the run's gateway/proxy/networks (`runner.mjs cleanup`), the authorization and `run.json`, and checks
port 58431 and R2 against the R4.1A baseline.

## Never persisted

PAT, HMAC, service key, QA passwords, Core access/refresh tokens, bridge bearers, invitation tokens, ring
private keys, DB logins: every evidence write is checked against the run's known-secret registry; the terminal
log is checked by the shell before it is kept.
