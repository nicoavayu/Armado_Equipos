> Superseded by Phase 2B: the Core adapter, the four historical RPC paths, the systematic season-scope fix and the 305/305 SECURITY DEFINER disposition are in [../phase2b/REPORT.md](../phase2b/REPORT.md).

# Phase 2A — B) BLOCKED (historical)

The requested final certification is **not complete**. There is useful isolated implementation and new passing evidence, but the Core contract PoC is not wired to the four historical RPC paths and the 304 SECURITY DEFINER functions do not all have completed semantic review. **Do not label this candidate PASS.**

## Delivered

- Concrete architecture: Core server-side current verified-email matching; restricted Core directory; frozen competition team snapshots. Exact request/response schemas and ownership rules: [CONTRACTS.md](CONTRACTS.md), [schemas.json](schemas.json).
- Executable local Core HTTP mock and separate Torneos mock store with signed request/replay defense, current session checks, privacy projections, pagination, atomic rate limiting, authorization, outage handling and concurrent idempotency.
- **63/63 mock contract tests PASS** ([tests.txt](tests.txt)); keys are ephemeral test-process bytes, no Core service role or remote database connection.
- A real security fix in the existing candidate: `create_tournament_team_entry` now verifies destination season access before its idempotency lookup and before inserting. Previously an admin without season access could create an entry there. Reproduced on the prior candidate with rollback; fixed and tested ([season-boundary.json](season-boundary.json)). The generator retains this narrow fix without rebuilding from scratch.
- Baseline installed from an empty local `template0` database; original **58/58 checks PASS** again. Those checks still include denials for pending Core contracts; they are not positive acceptance/import certification.
- Repeated historical comparison: 358 domain functions remain present, 354 equivalent after existing identity normalization and four intentional Core-boundary differences; 103 domain tables, 367 domain indexes, 61 historical policies and 110 historical triggers remain. The additional season authorization change is intentional within the already-different team-entry function. **10/10 seed catalogs equivalent.**
- Complete 362-function executable inventory with live owner/effective grants, including all **304 DEFINER** functions. **362/362 ACL/owner/search-path checks PASS**. Each row has a test ID, candidates for delegated checks and explicit semantic status: [FUNCTIONS.md](FUNCTIONS.md), [function-inventory.json](function-inventory.json).

## Final grants and privileged-function review

No EXECUTE grant changed. Live inventory lists exact signatures and effective `anon`, `authenticated`, and `service_role` privileges plus owner ACLs. All local function owners are `supabase_admin`; the inventory records superuser/bypass attributes. All 304 DEFINER functions have fixed empty search path and no PUBLIC EXECUTE. These properties do **not** prove authorization, RLS correctness or necessity of DEFINER. No function was mechanically downgraded merely because it lacked a direct table reference; wrappers can require execute rights on delegated private helpers.

The requested function-by-function necessity, input validation, RLS/caller authorization, SQL injection, escalation and cross-workspace certification is **still incomplete**. The inventory does not turn regex findings or ACL tests into a semantic PASS. The concrete team-entry season gap was fixed, but its existence makes it particularly inappropriate to assume all historical predicates are sufficient.

`rank_tournament_standings` (INVOKER, callable under a DEFINER caller) and `rebuild_tournament_standings` reuse pre-existing `pg_temp` work tables. Adversarial relation/trigger ownership and full standings fixtures need testing; no exploit of those paths is claimed here. Static PL/pgSQL analysis still reports 81 diagnostics, including 26 error-level findings in temporary-table/Storage/shared-trigger contexts. They remain unresolved, not waived.

## Historical functions unblocked

**None yet.**

| Historical function | Current state |
|---|---|
| `accept_tournament_team_invitation(text)` | Explicit Core-contract denial remains |
| `search_tournament_players(uuid,uuid,text,integer,uuid)` | Explicit Core-contract denial remains |
| `search_tournament_arma2_teams(uuid,uuid,text,integer)` | Explicit Core-contract denial remains |
| `create_tournament_team_entry(...)` | Manual/provisional path retained and season access hardened; Core import still denied |

Enabling them requires the local server/SQL response-binding adapter, mapping of external Core user IDs to local identities, destination/category/season reauthorization, historical invitation expiry/state locks, and positive/negative integration tests against this installed baseline. The synthetic session/scope/visibility/import fixtures are not a claim that those semantics have been certified in the existing Core implementation.

## Files and reproduction

Branch: `codex/torneos-clean-baseline-phase2`.
Worktree: `/Users/nicoavayu/Downloads/arma2/arma2-torneos-clean-baseline-phase2`.
Starting HEAD: `07ab9cdd3ade57b9f509e2716ffe21be56912d1f`.
The delivery commit is reported separately; use `git rev-parse HEAD` to identify it.

Changes are confined to `backend/torneos/`: the existing baseline's team-entry body; its generator; refreshed local installation/test/catalog/equivalence evidence; Phase 2A mock, schemas, tests, inventory and reports. See [changed-files.txt](changed-files.txt) for the tracked delivery list. The historical reconstruction and Core source migrations were preserved. No full baseline regeneration was executed.

From this worktree:

```sh
python3 backend/torneos/phase2a/run.py
```

This explicitly recreates only the fixed, labelled, network-disabled **local** baseline DB and its test fixtures. It neither selects a target from environment variables nor connects to Core. The loopback mock server is closed by its tests. The Docker lab is stopped after the runner finishes. Historical reference DB is retained for comparison.

## Remaining gates

1. Complete the Core→SQL adapter and positive historical-flow integration listed above; authenticate subject/session using the certified gateway rather than synthetic handles.
2. Complete the individual functional review and meaningful adversarial tests for all privileged functions, including delegated INVOKER execution, season scope and temp relations; remove unnecessary DEFINER with regression evidence.
3. Re-run clean installation, the original checks with positive contract coverage, new integration tests and historical equivalence after those changes. Document any additional intentional differences.

**Baseline candidate cannot yet be certified. Conclusion: B) BLOCKED.** No Production, deploy, Supabase project, Mercado Pago, production cron or Phase 3 was created or touched.
