# R4.2 — hybrid gateway certification (matrix producer + operator)

Certifies the REAL hybrid gateway: Core staging `hhyvmhgpapyuzjgxfnqv` (remote, HTTPS through the
R4.1 exact-SNI proxy) ↔ Edge gateway `127.0.0.1:58431` (R4.1 prepared bundle, memory custody) ↔
Torneos REST/DB of R2 (local, unchanged). `r4/` must match the latest R4.1 seal (reseal after source changes); the matrix is validated by the sealed runner (`runner.mjs certify` → `certification.mjs`).

```
node --test backend/torneos/phase3b/r42/r42.test.mjs      # offline unit tests (11)
node backend/torneos/phase3b/r42/outage.mjs               # offline: real gateway modules, --network none, stubbed Core (29)
node backend/torneos/phase3b/r42/rehearsal.mjs            # LOCAL: fixtures + count-verified cleanup on R2, no Core, no gateway (9)
node backend/torneos/phase3b/r42/abort-rehearsal.mjs      # LOCAL: fixture aborted mid-way → cleanup restores the exact baseline (6)
bash backend/torneos/phase3b/r42/run-r42.sh minimal       # OPERATOR (tty): post-fix clock-skew reproduction, 0 fixtures
bash backend/torneos/phase3b/r42/run-r42.sh               # OPERATOR (tty): the certified run
```

## After R4_FAIL 20260918T224221Z (2026-09-19)

* **Freshness / clock skew.** `torneos-gateway/core-client.ts` accepted a time-bound verdict only when
  `0 ≤ now − checked_at ≤ 3`; Core staging's clock sits ≈0.15 s ahead of the local gateway and `checked_at`
  is truncated to the second, so a verdict whose second had already ticked on Core was "in the future" and
  became 503 `CORE_UNAVAILABLE` (3 of ~59 verdicts). The window is now `−5 s ≤ age ≤ 3 s`
  (`MAX_RESPONSE_AGE_SECONDS` / `MAX_FUTURE_SKEW_SECONDS`, `isFreshObservation()`): same past bound, fail
  closed, no cache, one live verdict per request; the future bound equals the certified token clock
  tolerance and the attestation table's `observed_at ≤ created_at + 5 s`. Boundaries are unit-tested in
  `phase3b/gateway-port.test.mjs` and, on the real modules in the certified Edge runtime, in
  `outage-harness/` (`core_contract_skew_*`). The R4.1A seal covers the gateway sources: re-run
  `r4/audit.mjs` → `runner.mjs prepare` → `runner.mjs preflight` before any R4.2 command.
* **Cleanup scope.** `buildFixtures()` aborted mid-way, the aggregate `F` stayed `null`, cleanup ran with
  `orgs = []`, the count verification raised and rolled everything back (98 rows / 21 tables left). Every
  resource is now journaled in a run registry (`createRunRegistry`, `fixtures.mjs`) the moment its creating
  call returns; `cleanupFixtures()` scopes by the registry and by the run tag (`orgsBySlug`), never by `F`.
  `abort-rehearsal.mjs` reproduces the old failure as a negative control and proves the fix on R2.
* **Minimal reproduction.** `run-r42.sh minimal` → `operator.mjs` mode `minimal` → `minimal.mjs`: one QA
  user, one exchange, 20 immediate re-exchanges, 40 session-bound RPC calls (each a live `/v1/session`
  verdict), zero fixtures, QA/sessions/rows cleaned and count-verified; evidence `r4-minimal-<stamp>.json`.
  Verdict `R4_MINIMAL_PASS` requires zero `CORE_UNAVAILABLE`.

## Operator flow (`run-r42.sh` → `operator.mjs`, one process, credentials in memory only)

1. Keychain `arma2-torneos-nonprod-core/contract-secret` (nonce-replay probe) and the PAT from
   `/dev/tty`; both reach node on stdin through the `printf` builtin.
2. Handoff check (R4.1A seal, R4.1B prepared/preflight, R2 identity + catalog SHA, port 58431 free,
   no temporary resources) — any difference stops before anything starts.
3. Management API (read-only): project `arma2-torneos-staging` ACTIVE_HEALTHY, `torneos-core-contract`
   ACTIVE, `api-keys?reveal=true` → public anon/publishable key (gateway) and service key (QA admin only).
4. `.runtime/authorization.json` for `start-gateway|smoke|certify`, bound to the R4.1A seal, 120 min,
   carrying only the public Core key; removed at the end.
5. `runner.mjs preflight` → `audit.mjs start-gateway` (the provisioning the runner delegates to;
   invoked directly to avoid the runner's 45 s child SIGKILL) → `runner.mjs smoke`.
6. `matrix.mjs` (in-process): QA users, fixtures, the whole matrix, isolation, cleanup of QA/fixtures/sessions.
7. Core `auth.sessions` verified read-only per QA user (`core-session-exists`, `core-qa-users`) →
   `r4-matrix-<stamp>.json` → `runner.mjs certify` → `runner.mjs cleanup` → R2 final check →
   `r4-cleanup-<stamp>.json`, `r4-summary-<stamp>.json`, `r4-terminal-<stamp>.log`.

## Matrix blocks (REQUIRED_CASES of the sealed validator)

exchange_valid · token_valid · wrong_issuer · wrong_audience · wrong_kid (unknown + standby p3b-k2) ·
expired · wrong_ttl (121/60/nbf/iat) · claim_validation (role/alg none/typ/uuid/missing) ·
session_identity_binding · request_binding (hash/session/contract/time, single use) · replay
(attestation + Core nonce) · logout_revocation · core_session_inactive (nonexistent, revoked via
scope=others, logged-out id) · core_contract_unavailable · core_response_stale · core_auth_unavailable ·
torneos_rest_unavailable · allowlist (43 dispatched) · gated (33 × gateway POST/GET, direct anon/auth,
catalog) · p0_review_tournament_team_entry (deny matrix, invalid payload, invalid roster, approve /
changes_requested / reject, seated admin, audit) · cross_user · cross_workspace · cross_season ·
no_cache · secret_boundary · isolation.

Outages: Core Auth / contract transport failures = path-scoped connection resets in the run-owned
proxy, controlled only by the operator through `/fault/mode` on a 64 KiB tmpfs (no HTTP control).
The ingress and Auth health remain reachable during a contract fault. REST unreachability = `/32`
route removal inside the run-owned gateway namespace (NET_ADMIN helper, same image as R4.1), restored
and re-verified. The route helpers (`route-fault.mjs`) run their docker children off the event loop
(`dAsync`): a `spawnSync` helper between the last response and the next dispatch let the ingress proxy
close the pooled socket (6 s idle) unseen → `UND_ERR_SOCKET` (run 20260920T230313Z; targeted diagnosis
`run-transport.mjs route | route-loaded`, post-fix validation `route-postfix`). Recovery is checked once, without retries; contract-specific 5xx / timeout /
stale / malformed / schema / active:false and DB-unreachable cases run on the real gateway modules
in the certified Edge image with `--network none` and no secret (`outage-harness/`).

## QA and fixtures

Five synthetic users per run on Core staging (`qa-r42-<run>-<role>-…@accounts.invalid`,
`app_metadata.purpose = phase3b-r42`), created and hard-deleted by the run after an identity guard;
never a real or pre-existing account. Local fixtures follow Phase 2D §6 through the allowlisted RPCs
with real sessions; the manager acceptance runs through the live `verified_email` contract. Cleanup
deletes only run-scoped rows in one transaction (`session_replication_role = replica` for the
append-only audit log) and refuses to commit unless every table is back at its pre-run count.

## Never persisted

PAT, HMAC, service key, QA passwords, Core access/refresh tokens, bridge bearers, ring private keys,
DB logins. Every evidence write is checked against the run's known-secret registry; the terminal
log is checked by the shell for the PAT and the HMAC before it is kept.

## Final blockers from run 20260920T165201Z

The Core route-removal fault also removed the gateway's return route to the ingress proxy.
The historical Auth outage's 503 body `UNAVAILABLE` came from the proxy, not the gateway; its
three responses explain the exact no-store violations. The contract live probe then failed at
Node fetch before obtaining an HTTP response. Its historical errno was not recorded and cannot
be recovered from the message alone. A dedicated synthetic Docker diagnostic reproduces the
unreachable return route and proxy-owned 503 without Core/R2/credentials.

The proxy now sets no-store at ingress entry and enforces it when copying upstream headers,
covering success, passthrough errors, local 403 and local 503. Gateway response code is unchanged.
Core faults preserve ingress, separate Auth from contract, and require gateway JSON errors;
the contract case requires 503 CORE_UNAVAILABLE. Torneos REST unavailability retains its existing
wire error `access denied` (503); TORNEOS_UNAVAILABLE is the scenario, not a newly introduced code.
Matrix evidence records cache headers per path/status/error, safe fetch cause codes, and explicit
coverage for each required response class. A failed matrix check stops testing and runs cleanup.
