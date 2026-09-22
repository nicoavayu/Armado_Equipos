# Core → Torneos v1: isolated contract design and PoC

Status: **implemented and tested as a synthetic local PoC; NOT certified against the historical RPCs or the real Core authority**. No production adapter, deployment, browser credential, Core migration, physical FK, or cross-database SQL is introduced.

## Architecture and authority

Browser → certified identity gateway → Torneos server → explicit Core endpoint. Only identity/session is inherited from Phase 1.5. No email, verification, membership, visibility, profile or team authorization claim is inferred from its token. The PoC gateway is a fixture registry of opaque session handles, **not** a replacement or recertification of the SSO implementation.

The three Core endpoints use POST. Torneos first authorizes the operation locally. Core independently validates an active, non-deleted user, an unexpired, non-revoked session belonging to that user, and service authentication. The future gateway must derive Core subject/session from its verified identity mapping; browser body fields may not override them. The PoC deliberately has no public HTTP gateway.

`CoreAuthority` owns synthetic users, sessions, discoverability and import permissions. These are explicit test fixtures, not claims that those fields or a matching API already exist in Core. `TorneosPOC` owns a separate synthetic invitation and competition store. No shared DB or distributed transaction exists. The only wire connection is HTTP bound to `127.0.0.1` on an ephemeral port. Requests are capped at 16 KiB, responses at 256 KiB, and client timeout is 2 seconds. External Core URLs are rejected.

Local service authentication uses an ephemeral HMAC-SHA256 key generated in the test process. Headers: `X-Time` (Unix seconds decimal), `X-Nonce` (32 hex characters), `X-Signature` (hex HMAC over exact UTF-8 `path + "\n" + X-Time + "\n" + X-Nonce + "\n" + body`). Acceptance window ±30 seconds, each nonce accepted once and retained 61 seconds. There are no service keys in browser code or environment files. This is **local test transport only**; TLS/mTLS or equivalent narrowly scoped service credentials and distributed replay/rate-limit storage would need independent implementation before any remote use.

## Exact schemas

[schemas.json](schemas.json) is the closed JSON Schema 2020-12 definition: every declared property is required, `additionalProperties=false`; nullable fields are present as JSON null. Canonical UUID strings are lowercase. Requests use `Content-Type: application/json`; all responses have `Cache-Control: no-store`. [schema_validation.py](schema_validation.py) enforces the response schema subset used here; the Core handler additionally validates requests and session/authorization semantics.

| POST route | Request definition | 200 response definition |
|---|---|---|
| `/v1/verified-email` | `verifiedEmailRequest` | `verifiedEmailResponse` |
| `/v1/directory`, kind=players | `directoryRequest` | `playersResponse` |
| `/v1/directory`, kind=teams | `directoryRequest` | `teamsResponse` |
| `/v1/team-snapshot` | `teamSnapshotRequest` | `teamSnapshotResponse` |

Every request includes `core_user_id: UUID` and `session_id: UUID` derived server-side. Exact additional fields:

- Verified email: `expected_email: string(3..254)`.
- Directory: `kind: "players"|"teams"`, `query: string(2..100)`, `limit: integer(1..12)`, `cursor: string|null` (max 2048).
- Team snapshot: `core_team_id: UUID`.

Exact successful responses:

```json
{"verified":true,"matches":true,"checked_at":1789400000}
```

```json
{"items":[{"core_user_id":"00000000-0000-0000-0000-000000000001","display_name":"Player Test","avatar_url":null,"positions":["goalkeeper"]}],"next_cursor":null}
```

```json
{"items":[{"core_team_id":"00000000-0000-0000-0000-000000000002","name":"Player Team","crest_url":null}],"next_cursor":null}
```

```json
{"core_team_id":"00000000-0000-0000-0000-000000000002","name":"Player Team","crest_url":null,"players":[{"core_user_id":"00000000-0000-0000-0000-000000000001","display_name":"Player Test","avatar_url":null,"positions":["goalkeeper"]}],"source_revision":1,"captured_at":1789400000}
```

Names are 2..100 characters; URLs are null or HTTPS strings up to 2048 characters; positions are up to eight strings of 1..32 characters. A snapshot contains at most 80 players. Over-limit teams are rejected, never silently truncated. No URL is fetched by this PoC.

Errors contain only `{"error":"CODE"}`: 400 invalid request/cursor, 401 service authentication/replay, 403 invalid user/session, 404 unknown route or inaccessible/missing/deleted team, 409 oversized snapshot, 429 rate limit, 503 Core unavailable. The Torneos client intentionally maps downstream errors to sanitized `CORE_DENIED`/`CORE_UNAVAILABLE`, not raw response bodies. Invalid/stale/oversized responses fail closed. The outer Torneos errors additionally include `AUTH_REQUIRED`, `FORBIDDEN`, and `IDEMPOTENCY_CONFLICT`. HTTP retry headers are not implemented.

## Contract 1: B — Core server-side endpoint

**Choose B.** Core is the source of truth for the current email and its current verification state. At invitation acceptance Torneos sends the invitation's existing normalized target; Core returns only verified/matches and observation time. The user's actual email, verification timestamp and old emails never cross the boundary. The email claim of any token is ignored.

Normalization: ASCII address, exactly one `@`, non-empty local/domain parts, no whitespace anywhere, max 254 characters; lowercase both parts. No plus/dot alias rewriting or inferred equivalence. Leading/trailing whitespace is rejected rather than trimmed, preserving the historical rejection and extending it to Unicode whitespace. Non-ASCII addresses fail closed; internationalized email requires an explicit extension, not silent normalization. This is matching policy, not a full email-deliverability parser.

`verified=true` requires a valid current email and explicit current verification. Missing, unverified, invalid, inactive or deleted identities never authorize an invite. A changed address will mismatch an old invitation even if the old token still exists. The endpoint does not return the changed address. A new invite may target the new verified address.

No cache. Every acceptance performs a fresh read; client rejects observations older than 3 seconds (2-second HTTP timeout plus integer timestamp rounding). The PoC locks the local invitation during verification/mutation. It retains only accepted state and actor; Torneos may keep the invitation target it already owns, local accepting identity and local audit time. It must not store Core verification state as enduring authority. In the PoC `accepted_by` is an external Core ID; historical SQL must instead use the validated local identity mapping.

Without a distributed transaction, Core can change after its response: authorization means **verified/matching at the successful Core observation**, not a promise that Core cannot change before local commit. A delayed commit needs another check. The final SQL integration must validate freshness again at mutation and recheck invitation expiry/status/scope under local locks. The PoC is not evidence that historical invitation expiry/manager lifecycle checks have already been integrated.

## Contract 2: directory

Local authorization requires an authenticated actor and the specific organization/tournament capability: player lookup maps to historical `roster_players.read` or authorized editable team entry within the same tournament; team lookup maps to `team_entries.create`. Both must enforce season access. The PoC's scope map (`search.players`, `search.teams`) represents those grants as explicit fixtures; it does not execute their historical SQL predicates.

Core only returns active, non-deleted, explicitly discoverable players. Missing discoverability means hidden. Teams additionally require explicit current owner/admin import authority and discoverability; hidden teams are excluded from search. A hidden team can still be imported by its authorized owner/admin using its known ID; hiding from discovery does not transfer ownership or revoke that permission. Unknown and inaccessible team IDs have identical 404 responses.

Search uses casefolding and accent-insensitive substring matching. There is no email/phone/identifier lookup and no arbitrary filter/sort projection. No SQL or direct Core table access exists. Output is the strict allowlist above; no emails, phone, birthday, documents, account status, password, session, membership list, role, or private note. Core IDs remain external; they are not interchangeable with `torneos_identity.id`. Mapping to historical `userId` is a pending server adapter responsibility.

Limit 1..12 (outer PoC default 8); cursor pagination uses stable UUID keyset order. Cursors bind user, Core session, kind, normalized query, page size and last UUID, are HMAC protected, and expire in 60 seconds. Visibility/status is re-evaluated on each page. Results are not a frozen directory snapshot and concurrent edits may change membership between pages; no total count is returned. Cursor payload is authenticated, not encrypted, and may contain the caller's own query/IDs; keep it out of URLs/logs.

Core enforces 30 requests per actor per rolling 60 seconds across both kinds, atomically under the local mock lock; pagination counts toward the same limit. Torneos authorizes scope before calling Core. An outage, expired cursor, revoked session or rate limit returns no cached results. There is no directory persistence in Torneos.

## Contract 3: frozen competition snapshot

**Choose frozen snapshot, no sync and no in-place reimport.** Core keeps ownership, team management and its roster. A current Core owner/admin **and** an authorized Torneos operator in the destination organization/tournament are required. Organization/tournament and category/season validity must also be checked by the historical adapter; the PoC models organization/tournament capability only.

Torneos owns its competition representation, including external `core_team_id`, captured name/crest reference, visible active players, source revision, capture time and importing actor. It does not own the original Core team, assign Core membership, or copy credentials. A snapshot's players are candidate data: importing them does not silently accept invitations, attach a login, enroll a player in a match, or bypass local eligibility/consent. The PoC stores candidates in snapshot JSON and does not populate the historical roster tables.

Idempotency key is a UUID, bound to actor + organization + tournament + Core team. Reuse for another request returns 409. Unique representation is organization + tournament + Core team; another key for the same representation returns its original snapshot. Both checks are atomic in the mock store, including concurrent imports. Retries always revalidate local permission and current Core authorization first: no outage/deletion/revocation bypass through the idempotency cache.

Core team deletion blocks new imports/retries but does not erase existing competition results. Removing a Core player before initial import excludes them; removal afterwards does not rewrite the frozen snapshot. Subsequent Core edits do not change the captured name, crest reference or candidates. Local permitted edits may diverge; source metadata remains immutable. Another competition can capture a fresh version. There is no update/reimport endpoint in v1.

Snapshot retention is a separate local competition data responsibility. Freezing data does not eliminate deletion/privacy obligations; an authorized local redaction workflow and asset retention policy remain unimplemented. A remote crest reference is not an immutable binary: if the original disappears, the competition UI needs a fallback. Copying crest binaries, storage authorization, live sync and automatic identity provisioning are outside this PoC.

## Isolation and implementation boundary

During Core failure, verification/search/import fail closed. Existing local snapshots remain readable; other Torneos workflows retain their independent SQL. There is no scheduled job, payment integration or remote project. No password/session duplication.

Before the blocked historical functions can be enabled, add a narrowly privileged server-to-SQL adapter that binds verified responses to the authenticated local identity, Core session, exact request/scope and local transaction. Do not implement that bridge as a client-settable GUC, a request body boolean, an email JWT claim, or a browser-accessible table of attestations. Revalidate the local permission at commit. No such adapter is claimed as implemented by this PoC.

The 63 tests cover the mock protocol and its adverse cases. They do not certify the real Core API, Phase 1.5 browser/gateway routing, historical invitation state machine, local identity allocation, roster integration, or every privileged SQL function. Those remain explicit gates in [REPORT.md](REPORT.md).
