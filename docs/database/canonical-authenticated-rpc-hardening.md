# Canonical authenticated RPC hardening

## Scope

This P0 change is limited to the confirmed `0029` authenticated RPC exposure in
the two active canonical migrations and to the Security Advisor response parser.
It does not change visuals, Storage policies, Edge Function deployments, or any
remote environment.

The active migration path remains:

- `20260727090000_arma2_canonical_baseline.sql`
- `20260727215106_canonical_core_rls_contracts.sql`

All 214 files under `supabase/migrations_history/` remain byte-identical.

## Root cause and catalog result

Supabase's default function privileges granted `EXECUTE` to `authenticated`
after the historical dump had revoked only `PUBLIC` for many functions. A clean
local rebuild therefore exposed backend, cron, queue, and composition functions
through PostgREST even though their definitions were not intended as client
APIs.

The canonical baseline now revokes `PUBLIC`, `anon`, and `authenticated` by exact
signature for all 34 confirmed functions and grants their original signatures
only to `service_role`. The final migration then revokes all authenticated
function execution and rebuilds a versioned exact-signature allowlist.

| Catalog measure | Before | After |
| --- | ---: | ---: |
| `SECURITY DEFINER` functions | 359 | 366 |
| `PUBLIC` executable functions | 0 | 0 |
| `anon` executable functions | 18 | 18 |
| `authenticated` executable functions | 447 | 222 |
| `service_role` executable functions | 450 | 457 |
| Authenticated signatures outside allowlist | — | 0 |
| Anonymous signatures outside allowlist | — | 0 |
| Confirmed service-only functions exposed to clients | 34 | 0 |

The exact 222-signature authenticated allowlist is embedded between the
`BEGIN/END AUTHENTICATED EXECUTE ALLOWLIST` markers in
`20260727215106_canonical_core_rls_contracts.sql`. Its source categories are:

- 206 signatures with a legitimate static frontend RPC consumer.
- 16 helper signatures required by an RLS policy dependency.

Being called by another function is not a reason to receive a client grant.
The 18 historical anonymous signatures are separately asserted by the catalog
test; no new anonymous RPC was added.

## Confirmed functions and disposition

The three critical functions are service-only:

- `claim_push_delivery_batch`
- `claim_targeted_push_delivery_batch`
- `run_push_sender_scheduler_tick`

The 14 high-risk original signatures are also service-only:

- `cancel_partido_with_notification`
- `cleanup_invalid_device_tokens`
- `cleanup_voting_access_state`
- `enqueue_auto_match_notification`
- `enqueue_match_participant_notification`
- `enqueue_partido_notification`
- `finalize_push_delivery_attempt`
- `mark_match_assumed_not_played`
- `prepare_challenge_team_squad`
- `prepare_pending_challenge_partido_for_post_match`
- `purge_old_notification_delivery_logs`
- `purge_old_notifications`
- `send_match_kicked_notification`
- `sync_team_match_to_partido`

The 17 medium-risk original signatures are service-only:

- `_notify_goalkeepers_for_match`
- `auto_match_scheduled_sweep`
- `backfill_auto_match_proposal_members`
- `expire_stale_auto_match_invites`
- `expire_stale_auto_match_proposals`
- `expire_stale_directed_challenges`
- `invite_auto_match_substitutes`
- `process_auto_match_member_exit`
- `process_challenge_result_survey_notifications_backend`
- `process_match_reminder_notifications_backend`
- `process_survey_start_notifications_backend`
- `prune_ineligible_auto_match_members`
- `reconcile_auto_match_proposal_members`
- `reopen_auto_match_vacancies`
- `resolve_auto_match_full_cupo`
- `spawn_next_auto_match_cohort`
- `accept_invite_for_user`

Edge Functions and scheduled jobs continue to call the original signatures with
`service_role`. In particular, a client can no longer claim either push queue,
finalize a delivery, run the sender scheduler, or choose an arbitrary
`p_user_id` for `accept_invite_for_user`.

## Safe frontend replacements

Seven narrow `SECURITY DEFINER` wrappers preserve legitimate product flows:

- `cancel_partido_as_admin(bigint,text)`
- `cleanup_voting_access_state_as_admin(bigint)`
- `enqueue_partido_notification_as_actor(bigint,text,text,text,jsonb)`
- `enqueue_match_participant_notification_as_actor(bigint,text,text,text,jsonb,uuid,boolean)`
- `prepare_challenge_team_squad_as_actor(uuid,boolean)`
- `send_match_kicked_notification_as_admin(uuid,bigint)`
- `sync_team_match_to_partido_as_actor(uuid)`

Each wrapper derives the actor from `auth.uid()`, verifies the relevant match,
team, challenge, join request, captaincy, or administration relationship, and
constrains caller-provided content. They do not accept a caller-supplied actor as
authorization. The previous opportunistic frontend call to the global
`expire_stale_directed_challenges` job was removed; the scheduled backend job
remains authoritative.

## Verification and fail-closed behavior

`scripts/db-integration/authenticated-rpc-grants.mjs` checks the real local
PostgreSQL catalog and executes negative calls as the actual `authenticated`
role. It fails on:

- a missing or non-executable allowlisted signature;
- any new authenticated or anonymous executable signature;
- any of the 34 confirmed functions executable by a client;
- a confirmed function that is not executable by `service_role`;
- successful execution of representative backend, cron, queue, cleanup,
  notification, invitation, or composition functions as an authenticated user.

It also exercises service-role calls and an authorized match-administrator
wrapper with synthetic fixtures inside transactions that roll back.

The Security Advisor parser accepts only `response.result.lints` with an array.
Unknown wrappers, missing or incorrectly typed `lints`, malformed JSON,
incomplete lint records, non-2xx responses, and authentication failures all fail
closed. A valid empty `lints` array remains a valid zero result.

## Rollback

Before any remote application, rollback is simply reverting this commit and
rebuilding the local database. After a future controlled staging application,
rollback must use a new reviewed migration that restores only the previously
approved exact signatures; never restore broad default function privileges.
If application validation fails, discard and recreate the empty synthetic
staging project rather than mutating production or reusing an uncertain state.

## Deferred `0008` and Storage work

The 28 `0008` table findings and Storage hardening are intentionally excluded.
A separate review must:

- remove accidental public bucket listing;
- review SVG handling;
- reduce information encoded in object filenames;
- revoke redundant grants from fail-closed tables;
- evaluate moving token-bearing tables into a private schema.

Multimedia Upload and Estudio Social remain disabled.

## Future staging reconstruction and recertification

Only after this draft PR is reviewed and merged into its protected base:

1. Reconfirm the approved commit, two active migrations, 214 unchanged
   historical SQL files, and an empty synthetic staging target.
2. Recreate staging in the approved region and plan; do not reuse a partially
   migrated database.
3. Apply only the two canonical migrations with the normal controlled pipeline.
4. Deploy no Edge Function until its service-role configuration and secrets are
   independently verified.
5. Run the authenticated/anonymous catalog allowlist and negative RPC suite
   against staging with synthetic identities.
6. Fetch Security Advisor through the strict `result.lints` parser and record
   counts by code and level. Require the confirmed critical, high, and
   medium-backend `0029` exposures to be zero; do not require unrelated global
   warnings to be zero.
7. Exercise match administration, invitations, auto-match, challenges,
   post-match notifications, Torneos, and tenant isolation with synthetic data.
8. Verify no queue payload, delivery state, scheduler action, Vault capability,
   or cross-user invitation is reachable from a user JWT.
9. Remove all synthetic data and confirm a zero-residue catalog before any
   promotion decision.
10. Record the staging project identity and evidence in the release audit. Any
    mismatch stops the process; nothing is promoted to production or Vercel.
