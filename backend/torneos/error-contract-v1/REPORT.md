# ERROR-CONTRACT-V1 — expected Torneos domain errors are 4xx, never an outage

**Verdict: `TORNEOS_DOMAIN_ERROR_MAPPING_LOCAL_CERTIFIED` → STOP.**
Nothing was applied remotely: no writes to Torneos Production (POST_0004, 162/12), Core untouched, Vercel untouched,
Deno untouched, no push, no PR, no remote tooling, no G1, no W1/W2. Base: OFFICIALIZATION-V1 `20bd3222` (on main
`5b786051`), because 0006 replaces one body that 0005 introduces. Source of truth: [`contract.json`](contract.json).

## 1. Root cause (measured in the local lab, PostgREST v14.15)

| layer | behaviour before this phase |
|---|---|
| PostgREST | SQLSTATE `55000` / `54000` (and `55P03`, `P0002`, INTO STRICT) → **HTTP 500** |
| PostgREST | SQLSTATE `40001` → **re-executed inside the same request, without end**; no answer at all |
| gateway | passes the status through; its own 5 s timeout turns the 40001 case into **503** |
| transport | any status ≥ 500 → drops the bridge bearer, throws `TORNEOS_UNAVAILABLE`, loses `rpcError` → «Torneos no disponible» |

The 40001 retry storm is worse than the earlier audit reported: the `pg_stat` counters it used are flushed lazily by
busy backends and undercount by orders of magnitude. Counted exactly from the database ERROR log:

- a deterministic 40001 is re-executed **~4 600 times per second**, keeps running **after the client (and the gateway)
  gave up**, and only ends when the condition changes or the backend is terminated (two probe calls produced 686 134
  executions in ~2.5 minutes until the function was dropped);
- **ghost write, reproduced twice** ([`evidence/node/before.json`](evidence/node/before.json), case
  `fixture: publish the older draft`): "Publicar" on the older of two drafts answered 503 after 5.0 s (7 354
  executions by then, 13 183 three seconds later). The organizer then published the newest draft, and the still-running
  orphaned loop **published the older draft on its own**, superseding the one the organizer had just published;
- `TORNEOS_STANDINGS_SOURCES_CHANGED` was the one case where the retry "worked": the second execution saw stable sources
  and answered 200 without telling anyone the table had been recomputed from different data.

## 2. Changed-error inventory (23 RAISE statements in 18 functions)

Classification of every non-standard raise of the POST_0005 catalog (`contract.json` → `changes` / `unchanged`):
**A** invariant / internal, **B** true transient infrastructure, **C** expected domain / user conflict. Only C changes.

| function | message | SQLSTATE | HTTP | reachable flow |
|---|---|---|---|---|
| `publish_tournament_fixture` | `TORNEOS_STALE_FIXTURE_VERSION` | 40001 → PT409 | 409 | "Generar borrador" ×2, publish the older one |
| `rebuild_tournament_standings` | `TORNEOS_STANDINGS_SOURCES_CHANGED` | 40001 → PT409 | 409 | an official result changes during the rebuild |
| `publish_tournament_announcement` | `TORNEOS_CORRECTION_ALREADY_SUPERSEDED` | 40001 → PT409 | 409 | two corrections of one announcement |
| `publish_tournament_announcement` | `TORNEOS_PUBLISH_RATE_LIMITED` | 54000 → PT429 | 429 | 21st publication in an hour |
| `publish_tournament_announcement` | `TORNEOS_RECIPIENT_LIMIT_REACHED` | 54000 → PT422 | 422 | audience > 5 000 |
| `create_tournament_announcement_draft` | `TORNEOS_DRAFT_LIMIT_REACHED` | 54000 → PT422 | 422 | 101st open draft of the author |
| `set_tournament_announcement_link` | `TORNEOS_LINK_LIMIT_REACHED` | 54000 → PT422 | 422 | 6th link |
| `set_tournament_announcement_audience` | `TORNEOS_AUDIENCE_LIMIT_REACHED` | 54000 → PT422 | 422 | 13th criterion (PostgREST; not allowlisted in the gateway) |
| `resolve_tournament_qualification` | `TORNEOS_QUALIFICATION_INCOMPLETE` | 55000 → PT409 | 409 | table published mid-phase |
| `resolve_tournament_qualification` | `TORNEOS_QUALIFICATION_AMBIGUOUS` ×2 | 55000 → PT409 | 409 | tied table / undeterminable source |
| `resolve_tournament_qualification` | `TORNEOS_QUALIFICATION_MANUAL_LOCKED` | 55000 → PT409 | 409 | slot resolved manually |
| `review_tournament_match_operation` | `TORNEOS_MATCH_REVIEW_NOT_OPEN` | 55000 → PT409 | 409 | second approval from another tab (the audit called it an invariant; it is reachable: approval keeps `under_review`) |
| `save_match_squad` | `TORNEOS_MATCH_SQUAD_LOCKED` | 55000 → PT409 | 409 | save after submitting |
| `protect_tournament_match_squad_players` (trigger) | `TORNEOS_MATCH_SQUAD_LOCKED` | 42501 → PT409 | 409 (was 403) | one code, one status |
| `create_tournament_match_correction` | `TORNEOS_MATCH_CORRECTION_EXISTS` | 55000 → PT409 | 409 | create the correction twice |
| `request_tournament_match_correction` | `TORNEOS_MATCH_CORRECTION_EXISTS` | 55000 → PT409 | 409 | request twice |
| `protect_active_tournament_fixture_draft` (trigger, 11 RPCs) | `TORNEOS_FIXTURE_DRAFT_READ_ONLY` | 55000 → PT409 | 409 | edit a draft after the start |
| `append_tournament_playoff_phase` | `TORNEOS_COMPETITION_READ_ONLY` | 55000 → PT409 | 409 | finished competition |
| `protect_tournament_completed_competition` (trigger) | `TORNEOS_COMPETITION_READ_ONLY` | 22023 → PT409 | 409 (was 400) | one code, one status |
| `set_tournament_match_dual_control` (0005) | `TORNEOS_COMPETITION_READ_ONLY` | 22023 → PT409 | 409 (was 400) | one code, one status |
| `mark_tournament_suspension_served` (closed) | `TORNEOS_SUSPENSION_NOT_ACTIVE` | 55000 → PT409 | 409 | not client-reachable today |
| `record_manual_match_availability` (closed) | `TORNEOS_MATCH_AVAILABILITY_SELF_AUTHORITATIVE` | 55000 → PT409 | 409 | not client-reachable today |

**Unchanged on purpose:** A — `make_tournament_match_official` `REVIEW_OPEN` / `CORRECTION_STALE`, media storage path,
the 5 INTO STRICT reads (a miss is corrupted data → a genuine 500); B — media pipeline readiness, and the engine's own
40001 / 40P01 / 55P03 (no Torneos function raises them explicitly after 0006); commerce — 14 functions stay as certified
(commerce is OFF, has its own gateway route mapping, and `unordered_tournament_payment_reversal` catches 55000, so that
SQLSTATE is load-bearing); `set_tournament_organization_subscription` 0A000 is already 400.

## 3. Migration `00000000000006_domain_error_contract.sql`

sha256 `767d57e8fb96ca69cd9d3b9379c0c3135652c8cb7bc07d83d81d1d815e0f3cc3`; rollback
[`rollback/00000000000006_domain_error_contract.rollback.sql`](rollback/00000000000006_domain_error_contract.rollback.sql)
sha256 `30c15af17f952cc4b341c54168f6b01ee0a37066fe1d5a8f81fe4cfe4ac80f1b`. 0000–0005 byte-identical.

- **Generated**, not hand-written: [`build-migration.mjs`](build-migration.mjs) reads `pg_get_functiondef` + `prosrc` of the 18
  functions from the lab catalog and changes, inside each RAISE that carries a contract message, **only the errcode
  literal**. The diff between the migration's bodies and the rollback's bodies is exactly 23 literals. `--check`
  regenerates migration, rollback and pins byte for byte (from POST_0005 or, by the exact reverse edit, from POST_0006).
- **One transaction, fail-closed.** Precondition: 0005 in force; every body is exactly its POST_0005 md5 or its 0006 md5
  (re-apply is a no-op; a third state aborts with `TORNEOS_ERROR_CONTRACT_V1_PRECONDITION_FAILED` before any change).
  Postcondition: the 18 md5 pins; owner / ACL / SECURITY DEFINER / config / signature of each function unchanged; client
  catalog unchanged (171 / 12); catalog sweep: every contract message raised the expected number of times and only with
  its PTxyz, **no function raises 40001**.
- **Remote order** (not executed): POST_0004 → 0005 → 0006. 0006 cannot precede 0005 (it pins
  `set_tournament_match_dual_control`). Re-running 0005 alone after 0006 would roll that one body back; the
  officialization suite now re-applies the tail after its re-apply check.
- **Rollback** restores the 18 POST_0005 bodies (md5-pinned), nothing else; it has its own temp tables so it can be
  proven in the same transaction as the migration. After a rollback the 40001 storm returns; the gateway defense still
  maps the 55000 / 54000 cases.

### Function body pins (md5 of `prosrc`, POST_0005 → 0006)

| function | POST_0005 | 0006 |
|---|---|---|
| `public.append_tournament_playoff_phase(uuid,uuid,uuid,uuid,integer,boolean,uuid)` | `996cb4f6fc49524fbda06f16227bc472` | `1166ca6ba0811a83c688ed8c6d8c828c` |
| `public.create_tournament_announcement_draft(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone,uuid,text,uuid)` | `02eaa14aef6b3a9e709935e28232fe1b` | `f2f2dd910245f8ebb0c8ca2fd8448f19` |
| `public.create_tournament_match_correction(uuid,uuid)` | `e951e5be55e80835906f355360398590` | `d0e27384efd5b70f5ef1baf9893ecf30` |
| `public.request_tournament_match_correction(uuid,uuid,text)` | `6cbfbe91fb54eafca64520456e700a1a` | `ea194c20129c58a1581ff0804ca362dd` |
| `public.mark_tournament_suspension_served(uuid,uuid,text)` | `179376cfb1cd940d64ffa7dc34c40dc6` | `0ca29ae1d9e55671dc3cdd9d18d83efd` |
| `public.protect_active_tournament_fixture_draft()` | `c067a91075ab2dd5f6b0d114b694286f` | `4aef5269146750bfe579910f7772447f` |
| `public.protect_tournament_completed_competition()` | `94012caa5505b8845a21ea247d26a496` | `f3f77a153eab65aef37046c65b891698` |
| `public.protect_tournament_match_squad_players()` | `d6a8eb923c378bbe47ceb4ee77a4f164` | `517664b2b2e325b42af98731f5ec4366` |
| `public.publish_tournament_announcement(uuid,integer)` | `7b5de1040a89810b8a09055087d56519` | `e5e6d5e9c2e0acf73548209a0e265c80` |
| `public.publish_tournament_fixture(uuid,uuid)` | `b730e3eda644554c36dca95eafb6bbce` | `2c64761a38d28e5fbdcd5735fb0a76b2` |
| `public.rebuild_tournament_standings(uuid,uuid,uuid,uuid,uuid,text,uuid)` | `647d3a01d3489af7111afa6017e9dba3` | `1cd1dbdabeae82ea7d6e0c9a7fce37c0` |
| `public.record_manual_match_availability(uuid,uuid,uuid,text,text,text)` | `63f7fb5c744586172f56043487225ca7` | `1acdb4e53b05f3a8cb3c5a9b98bdfb3b` |
| `public.resolve_tournament_qualification(uuid,text)` | `3f1af0ba733eacf51bc868542c150c73` | `193a69bf4fb8e95047015a9b9da3e9cd` |
| `public.review_tournament_match_operation(uuid,uuid,text,text)` | `6f5912e4cf6601ad1d8301ed61bf7adc` | `840710c77dc6343c2232b4c6590c946f` |
| `public.save_match_squad(uuid,uuid,uuid,jsonb)` | `b95278f07e0ce51fc297f3324ef1600a` | `931d2820b0711135eb2365b50e95f303` |
| `public.set_tournament_announcement_audience(uuid,text,uuid,uuid,uuid,uuid)` | `9d00a52f2abea44a7d020f3db7a9ffe7` | `7d7bbe6ba33b95a9fb601b3129b902d9` |
| `public.set_tournament_announcement_link(uuid,text,uuid,text,text,integer)` | `b20a2f8a60d793fd8ab09ede3f7d7b4c` | `8ff92a71f5efa6167556e5297f8b5cf1` |
| `public.set_tournament_match_dual_control(uuid,uuid,boolean)` | `0379096408e86030361fa2390fcf02b1` | `631be35793594b6641529ded5b91c055` |

## 4. HTTP mapping (PostgREST custom status `PTxyz`, measured: HTTP xyz, body `{code:"PTxyz", message, details, hint}`)

| status | meaning | codes |
|---|---|---|
| 400 | invalid domain input | unchanged (P0001 / 22023 / 23514) |
| 403 | permission / domain authorization | unchanged (42501) |
| 404 | only without existence leak | none introduced |
| 409 | stale state / conflict / exists / read-only lifecycle | 13 codes |
| 422 | valid request refused by a domain limit | DRAFT / RECIPIENT / LINK / AUDIENCE limits |
| 429 | rate limit | PUBLISH_RATE_LIMITED |
| 500 | genuine server error | unchanged: invariants, INTO STRICT, anything unstructured |
| 503 | outage / timeout | unchanged: gateway timeout, Core / REST down |

## 5. Transport (`src/features/torneos/foundation/torneosTransport.js`)

- 409 / 422 / 429 with a PostgREST body → `TORNEOS_RPC_ERROR` with `rpcError` intact (already the 4xx path); the UI shows
  the product copy (`ERROR_MESSAGES`, +2 entries: `STALE_FIXTURE_VERSION`, `CORRECTION_ALREADY_SUPERSEDED`).
- **500 whose `message` is exactly a Torneos functional code** (`^TORNEOS_[A-Z0-9_]+$`, not an outage code) →
  `TORNEOS_RPC_ERROR`, **bearer kept**, no retry (a database before 0006, or an invariant).
- Everything else stays fail-closed as before: 503 (even with a domain body), 502, an unstructured 500 (`P0002`, a
  prefixed message, a gateway `{error}` body, non-JSON), network failure and timeout → bearer dropped,
  `TORNEOS_UNAVAILABLE`. 401 → one silent re-exchange, then `TORNEOS_SESSION_INVALID`; 403 → no retry. No new retry loop.

## 6. Gateway (`torneos-gateway/competition.ts`, used by the Edge `index.ts` and the Node lab `gateway.mjs`)

`domainErrorStatus(status, body)`: only an upstream **500** whose JSON body has `code ∈ {55000, 54000}` **and**
`message` = a contract code is answered with the contract status (409 / 422 / 429); the body is forwarded byte for byte.
Anything else keeps its status: a genuine 500 (other SQLSTATE, other message, non-JSON, > 4 KiB), 502, 503, and the
gateway's own 503 on timeout. This makes deploying the gateway before 0006 safe and already removes the 55000/54000
outages ([`evidence/node/before.json`](evidence/node/before.json): 12 cases answered 409/422/429 through the gateway
while direct PostgREST still answered 500). It cannot fix 40001: PostgREST never answers it — only the database change
removes the storm. Bundle: still 17 files (no new file).

## 7. Certification (LOCAL)

Fresh lab (0000→0006 of this tree), Core real, Node + Edge gateways, one strictly sequential final run, **0 skips**.
Full record: [`evidence/regression.json`](evidence/regression.json).

**`error-contract.test.mjs`: 28/28 checks on the Node gateway and 28/28 on the Edge gateway**
([`evidence/node/after.json`](evidence/node/after.json), [`evidence/edge/after.json`](evidence/edge/after.json)).

- **A — install (6):** 0006 applied last, 0000–0005 byte-identical; 18 md5 pins + `build-migration.mjs --check` byte for
  byte; catalog sweep (no 40001, each message only with its PTxyz, invariants / readiness / commerce untouched, 171/12,
  ACL + definer per function); re-apply no-op, third body state and no-0005 refused before any change; rollback in a
  rolled-back transaction restores the 18 POST_0005 md5, then 0006 intact; gateway map = contract, and 13 negative
  inputs (genuine 500, invariant 500, other SQLSTATE, non-JSON, 502, 503, oversize …) pass through untouched.
- **C0 — mechanism:** a throwaway function raising 40001 through PostgREST: no answer in 3 s, ~14 450 executions and
  still running after the client left (ended by dropping the function); the same RAISE as PT409: 409 in ~30 ms, 1 execution.
- **B — product flows through the gateway (16 + 1 PostgREST):** each answers its contract status + `PTxyz` + message in
  **exactly one database execution** (counted from the ERROR log), nothing running 3 s later, in milliseconds (the
  concurrent-rebuild case right after the 3 s lock), and **the same bearer keeps working**:

| case | status | ms (node / edge) |
|---|---|---|
| publish the older fixture draft (was 503 + storm + ghost publish) | 409 | 22 / 42 |
| edit a draft fixture after the start (trigger) | 409 | 19 / 43 |
| save a submitted squad | 409 | 14 / 40 |
| approve an acta twice | 409 | 16 / 40 |
| resolve qualification mid-phase | 409 | 14 / 37 |
| rebuild while an official score changes (was a silent retry) | 409 | 1922 / 1940 (lock) |
| request a correction twice / create it twice | 409 / 409 | 13, 9 / 31, 39 |
| publish to 5 001 recipients | 422 | 60 / 62 |
| publish a second correction (was 503 + storm) | 409 | 67 / 102 |
| 6th link | 422 | 7 / 42 |
| 13th audience (direct PostgREST) | 422 | 120 / 138 |
| 21st publication in an hour | 429 | 18 / 40 |
| 101st draft | 422 | 24 / 41 |
| tied table (natural 0-0) | 409 | 12 / 41 |
| finished competition: append playoffs (was 500) / dual-control policy (was 400) | 409 / 409 | 10, 9 / 30, 29 |

- **D — unchanged:** a genuinely corrupted tournament (INTO STRICT) → unstructured **500 P0002** passed through; Torneos
  REST frozen → **503** `access denied` after the 5 s budget, then recovery; no bearer / forged bearer → 401; RPC outside
  the allowlist → 403 `rpc not enabled`; other workspace → 403 42501; every domain error kept the bearer; 354/354
  responses `no-store`.

**Regression (same fresh lab, sequential):** OFFICIALIZATION-V1 40/40 Node and Edge · COMPETITION-V1 40/40 Node and Edge
· Phase 3A E2E 41/41 Node and Edge · ACL 17/17 · exposure 19/19 Node and Edge · equivalence Node≡Edge 8/8 · D1 session
authority 6/6 · Deno 2.1.4 compat 8/8. Displacements, all by the 0006 delta and nothing else: migration lists (+0006);
officialization A5 re-applies the tail after re-applying 0005; the finished-competition policy refusal is 409/PT409
(was 400/22023).

**Offline:** frontend foundation / transport (+T15–T18) / adapter / competition / officialization / **error-contract**
(new: contract = gateway map = UI copy = migration) / commerce 76/76 · static guard + quality gate 257/257 ·
competition-remote 7/7 · gateway-remote 8/8 (bundle still 17 files) · torneos-foundation 53/53 · gateway-auth 44/44 ·
core-prod 41/41 · reconcile 2/2 · Deno hardening 30/30 · **Jest 335 suites / 3254 tests** · `react-scripts build` OK ·
B04 call map regenerated (line numbers only) · secret / Production-host scan of the 7 901 added lines: 0 hits.
Historical suites' own tracked evidence restored byte-identical.

## 8. Plan for Production (NOT executed)

Order: (1) gateway revision with this `competition.ts` (safe on POST_0004: only remaps 55000/54000 domain errors) →
(2) 0005 per the OFFICIALIZATION-V1 plan → (3) 0006 in one psql transaction as the installer role (G1 read-only
first: the 18 POST_0005 md5 pins, 171/12) → (4) frontend with the transport change. The remote tooling for 0005/0006
(`--apply` + pins) needs its own offline increment. Rollback: 0006 rollback script (DB) independently of the gateway.
