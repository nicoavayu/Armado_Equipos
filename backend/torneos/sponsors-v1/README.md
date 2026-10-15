# PREMIUM SPONSORS (0020) — backend

Spec: `docs/superpowers/specs/2026-10-15-torneos-premium-sponsors-design.md` (§2.1 database, §2.2 gateway).
State: **prepared and rehearsed on a local lab only. Nothing applied to Staging or Production, nothing deployed.**
Applying 0020, deploying the gateway with the new allowlist, or running `db-0020.mjs` against a remote each need Nico's
explicit GO.

## Files

| File | What |
| --- | --- |
| `backend/torneos/supabase/migrations/00000000000020_premium_sponsors.sql` | the migration (one transaction, fail-closed pre/postconditions) |
| `rollback/00000000000020_premium_sponsors.rollback.sql` | its rollback (restores the 0017 `in_use` body byte for byte; refuses with rows unless forced) |
| `remote/db-0020.mjs` + `remote/sql-catalog-0020.sql` | operator driver (observe / apply / rollback, phrases, sha256, PRE/POST, "nothing else moved") |
| `db-0020.test.mjs` | static guarantees of both files + the driver with fake catalogs (offline) |
| `sponsors-0020.test.mjs` | every rule on a real PostgreSQL, applied by the driver as the hosted installer |
| `sponsors-0020-rollback.test.mjs` | apply → refused re-apply → rollback → re-apply; refusal with rows; force |
| `test/lab.mjs` | the lab: `commerce-production/lab/pg-lab.mjs` (own container), 0000 → 0019, Production's ownership |

`npm run test:torneos:sponsors` runs the three (Docker required; part of `test:ci`).

## What 0020 adds

- `public.tournament_organization_sponsors` — `id, organization_id, name (trimmed 1..60, no control chars), logo_path
  (null or <org>/organizations/<org>/<uuid>.<jpg|png|webp>), sort_order (0..999), created_by, created_at, updated_at,
  archived_at`. RLS on, no policy, no grant to anon / authenticated / service_role.
- `private.tournament_sponsors_entitled(org, season, tournament)` — the one entitlement rule (no API role):
  - with a season: `resolve_effective_tournament_season_entitlements_at(org, season, now(), false, tournament)` →
    `capabilities.sponsors` (the tournament's overrides apply when given, as in 0008);
  - without a season (organization level): **any season of the organization** has it. Only seasons with an effective plan
    grant (`is_tournament_season_plan_grant_effective`) are evaluated, unless the catalog ever enables `sponsors` for
    FREE: that is exactly the resolver's own plan rule, so the result equals "exists a season whose resolver says
    sponsors", evaluated on the few seasons that can pass.
  - Not `has_tournament_capability` (a role check, never an entitlement). Season closure (0018's six months) is not
    part of the rule, as for `social_studio.premium` in 0008; a suspended or revoked grant stops counting at once.
- Four RPCs, `EXECUTE` to `authenticated` only, identity = `private.current_identity_id()`; access is always checked
  before any input is judged, and another organization's sponsor is indistinguishable from one that does not exist.
- `private.tournament_branding_object_in_use` also counts an **active** sponsor's `logo_path` (CREATE OR REPLACE: same
  signature, owner, ACL and attributes; the 0017 body is pinned before, the new one after).

## RPC contract (for the frontend half)

All through the gateway's authenticated route (`POST /torneos/rest/v1/rpc/<name>`, BRANDING-V1 on). The two reads are
signed: every `logoPath` inside `sponsors[]` gets a sibling `logoUrl` (null when the caller may not read it — see risks).

1. `get_tournament_organization_sponsors({ p_organization_id, p_season_id? })` — any active member; with a season, also
   that season's access. → `{ schemaVersion: 1, organizationId, seasonId, canManage, entitled,
   limits: { maxActive: 20, maxPerExport: 3, nameMaxLength: 60 }, sponsors: [{ id, name, logoPath, logoUrl, sortOrder }] }`
   (active only, by `sortOrder`, then creation). `entitled` = the organization's (no season: Configuración) or that
   season's (with a season: Estudio Social). The list is returned even when not entitled (rows are kept).
2. `upsert_tournament_organization_sponsor({ p_organization_id, p_sponsor_id: null|uuid, p_name, p_logo_path: null|path,
   p_sort_order?: null|int })` — `organization.update` (owner, admin) + organization entitlement. Full replacement of
   name and logo (pass the current `logoPath` to keep it, `null` removes it); `p_sort_order` null = append on create,
   keep on edit. → `{ sponsor: { id, name, logoPath, sortOrder }, previousLogoPath }` (`previousLogoPath` only when the
   logo changed: the client then deletes it through the existing `DELETE /torneos/branding/v1/object/<path>`; the media
   store refuses while it is referenced anywhere).
3. `archive_tournament_organization_sponsor({ p_organization_id, p_sponsor_id })` — `organization.update`, **no**
   entitlement. Logical (`archived_at`), clears `logo_path`. Idempotent. → `{ sponsorId, archived: true,
   alreadyArchived, previousLogoPath }` (delete `previousLogoPath` afterwards when not null).
4. `authorize_tournament_social_sponsors({ p_season_id, p_tournament_id, p_theme, p_sponsor_ids: uuid[] })` — same access
   as the export (0008: `social.export` + season access). Theme `heritage | street | scoreboard | editorial`; ≤ 3
   distinct ids, all active, with a logo, of the tournament's organization; the season's effective `sponsors`.
   → `{ authorized: true, organizationId, seasonId, tournamentId, theme, capability: 'sponsors',
   sponsors: [{ id, name, logoPath, logoUrl }] }` in the order requested. An **empty** selection is a no-op (any known
   theme, no entitlement needed) → `sponsors: []`. The export must draw only this list.

Uploads reuse the existing route: `POST /torneos/branding/v1/object/<org>/organizations/<org>` (organization kind) →
`{ path }`, then `upsert_…` with that path; if the RPC fails, delete the uploaded object.

### Errors (`{ code, message, details }` from PostgREST; `message` is the token)

| SQLSTATE (HTTP) | message | when |
| --- | --- | --- |
| 42501 (403) | `TORNEOS_AUTH_REQUIRED` | no bridge identity |
| 42501 (403) | `TORNEOS_SPONSORS_FORBIDDEN` | not a member (read) / no `organization.update` (write) / season not accessible |
| 42501 (403) | `TORNEOS_SOCIAL_EXPORT_FORBIDDEN` | authorize without `social.export` or season access, or a season/tournament pair that does not match |
| 42501 (403) | `TORNEOS_SPONSORS_PREMIUM_REQUIRED` | upsert without organization entitlement; authorize without the season's |
| 22023 (400) | `TORNEOS_SPONSOR_INVALID` | `details`: `name` \| `logo_path` \| `sort_order` \| `sponsor_id` |
| 22023 (400) | `TORNEOS_SOCIAL_THEME_UNKNOWN` | null or unknown theme |
| 22023 (400) | `TORNEOS_SPONSORS_THEME_UNSUPPORTED` | `base` with a non-empty selection |
| 22023 (400) | `TORNEOS_SPONSORS_SELECTION_INVALID` | null array, null id, more than 3, duplicates |
| PT409 (409) | `TORNEOS_SPONSOR_NOT_FOUND` | upsert/archive of an id that is not (active, for upsert) in this organization |
| PT409 (409) | `TORNEOS_SPONSORS_SELECTION_UNAVAILABLE` | a selected id archived, without logo, unknown or of another organization |
| PT422 (422) | `TORNEOS_SPONSOR_LIMIT_REACHED` | a 21st active sponsor |

## Operator (prepared, never run without GO)

```
node backend/torneos/sponsors-v1/remote/db-0020.mjs observe
node backend/torneos/sponsors-v1/remote/db-0020.mjs apply-0020    APPLY TORNEOS 0020 onzpwnqxnvlgsevivngf <sha12 of 0020>
node backend/torneos/sponsors-v1/remote/db-0020.mjs rollback-0020 ROLLBACK TORNEOS 0020 onzpwnqxnvlgsevivngf <sha12 of rollback>
node backend/torneos/sponsors-v1/remote/db-0020.mjs rollback-0020 ROLLBACK TORNEOS 0020 onzpwnqxnvlgsevivngf <sha12> DISCARD SPONSOR ROWS
```

States: `PRE_0020` (= POST_0017 `in_use`, nothing of 0020) → `POST_0020` (six bodies pinned by md5, four RPCs
authenticated-only, table RLS/no grant/no policy) and back; EXECUTE counts move by exactly +4 / −4 authenticated, +0
anon; every other function, relation, policy and the branding bucket must not move. The rollback refuses (driver before
any write, file inside its transaction) while any sponsor row exists; the force phrase sets
`torneos.sponsors_rollback_force = 'DISCARD SPONSOR ROWS'` in the same session. Order: frontend sponsors UI off →
gateway without the four RPCs (or BRANDING off) → rollback.

Interplay with earlier drivers: after 0020, `media-store-v1/remote/db-0017.mjs` observes DRIFT (its `in_use` pin is the
0017 body), so `rollback-0017` is refused until 0020 is rolled back (tested). `media-v1/remote/db-0012.mjs` knows the
0020 delta (`SPONSORS_DELTA = [4, 0]`, catalog flag `sponsors`), so the media mode switch keeps working.

## Rehearsal (local lab, hosted topology, as `postgres`)

`evidence/db-0020-lab.jsonl`: apply `APPLY_0020_DONE` (PRE→POST, nothing else moved) → re-apply refused
(`PRE_STATE_POST_0020`, and the file's own precondition) → rollback `ROLLBACK_0020_DONE` with the catalog, ACLs,
constraints, policies and bucket identical to before → re-apply → with one row: refused by driver and file, then
`--force` `ROLLBACK_0020_DONE` → re-apply (final POST_0020, no rows).
