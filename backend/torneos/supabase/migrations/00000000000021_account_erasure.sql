-- Arma2 Torneos — 0021 ACCOUNT ERASURE: what happens in Torneos when a person deletes their Arma2 account.
--
-- Why: the Core `delete-account` function deletes the Core user, but Torneos is a separate project and kept everything
-- (identity mapping, profile, inbox, memberships, organizations without a reachable owner, rosters with the person's
-- name published on public pages, …). 78 of the 91 foreign keys to public.torneos_identity are ON DELETE RESTRICT, so
-- the identity cannot simply be deleted: shared sporting history (match reports, goals, cards, standings, purchases,
-- audit) points at it. Design: docs/superpowers/specs/2026-10-15-torneos-account-deletion-design.md.
--
-- The rule, table by table (the full matrix is in the design document):
--   * DELETED   rows that only serve the person: Torneos profile, inbox notifications, preferences, the Core-contract
--               attestation cache, player-tag relations on photos, the person's season assignments.
--   * ANONYMISED personal content inside shared records: roster names and avatars (public stats), squad / match-report
--               name snapshots, claimed provisional players (name, email, phone), team-manager name and email, the
--               invitation emails the person accepted, availability comments and staff notes about the person,
--               the application message, the person's entry in frozen Core team snapshots. Names become a stable
--               pseudonym per organization: «Jugador eliminado ABC123» / «Responsable eliminado ABC123».
--   * ENDED     access: memberships → removed, team-manager roles and their pending invitations → revoked, photographer
--               assignments and open upload sessions → revoked, media consents → revoked, the person's portraits →
--               delete_pending (the existing two-phase delete; objects are listed for the operator, never purged here).
--   * KEPT      everything else, numbers and states untouched: results, events, standings, statistics, announcements,
--               acknowledgements, audit log, purchases and their events (accounting / consumer law / chargebacks).
--               Their references to the identity stay valid but point to a severed identity: its core_user_id is
--               replaced by a random UUID, so nothing in Torneos links it to the person any more.
--   * ORGANIZATIONS owned by the person: transferred to the longest-standing active admin (joined_at, created_at, id);
--               with no active admin they are archived (an archived organization is not served by any public or
--               member read), their public pages unpublished and catalog listings withdrawn with the WhatsApp contact
--               cleared. Purchases, plans and seasons are never touched. No organization is left active without an
--               active owner (postcondition).
--
-- What it adds, and nothing else:
--   * torneos_erasure_writer: a NOLOGIN NOINHERIT role whose ONLY privileges are USAGE on schema private and EXECUTE on
--     the two erasure functions below (nothing on any table, no other function, member of no role). The gateway reaches
--     it through its own login (torneos_edge_erasure_writer, created out of band with a SCRAM verifier like the other
--     torneos_edge_* logins; its password lives only in the gateway's Secret Manager entry), never through
--     torneos_core_adapter or torneos_identity_writer, which cannot run the erasure.
--   * private.tournament_account_erasures: the erasure ledger, one row per severed identity: sha256 of the Core user id,
--     the deletion request id (Core's idempotency key), the state torneos_erased → core_confirmed, the summary and the
--     storage objects left for the operator. No client role (nor the erasure role) can read it.
--   * private.account_erasure_label(kind, identity, organization): the pseudonym.
--   * private.erase_tournament_account(core_user_id, request_id): the erasure, in ONE transaction (all or nothing),
--     idempotent by core user id: { outcome: erased | already_erased | no_identity, … }. A new ledger row is born
--     torneos_erased.
--   * private.confirm_tournament_account_erasure(core_user_id, request_id): Core's confirmation, AFTER it deleted its own
--     account: sweeps (erases an identity re-created in between, if any) and moves the person's ledger rows to
--     core_confirmed: { outcome: core_confirmed | no_ledger }.
--   * TOMBSTONE: private.refuse_erased_identity() + trigger torneos_identity_refuse_erased (BEFORE INSERT on
--     public.torneos_identity): no identity is ever created again for a Core user the ledger records
--     (TORNEOS_ACCOUNT_ERASED), whatever Core JWT is still valid; it waits on the per-person erasure lock.
--   * Locks: lock_timeout (5 s) is set BEFORE the per-person and the global advisory locks (bounded, retryable).
-- Torneos and Core are two databases: this is NOT atomic across them. Torneos erases first and that is irreversible (the
-- originals are not kept anywhere). If Core then fails, the ledger row stays torneos_erased: the person's retry gets
-- already_erased (a no-op) and lets Core finish; if nobody retries, the operator's read-only reconcile query
-- (backend/torneos/account-deletion-v1/remote/reconcile-0021.sql) lists the rows Core never confirmed.
-- No existing function body, policy, grant, table or trigger definition changes. The guard triggers that make official
-- history immutable are disabled and re-enabled INSIDE the erasure transaction only, around the anonymising updates
-- (ALTER TABLE … DISABLE/ENABLE TRIGGER needs the table owner = the installer that owns this function); the function
-- refuses to start if any of them is not enabled, and verifies they are all enabled again before it returns.
-- Applies on main (0000 → 0019) and on main + 0020 (sponsors) and/or 0022 (moderation), in any order: the sponsors and
-- moderation tables are handled only if they exist when an erasure runs (dynamic SQL; nothing here references them).
BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.torneos_identity') IS NULL
    OR to_regclass('public.tournament_user_profiles') IS NULL
    OR to_regclass('public.tournament_user_notifications') IS NULL
    OR to_regclass('public.tournament_team_applications') IS NULL
    OR to_regclass('public.tournament_catalog_listings') IS NULL
    OR to_regclass('private.core_contract_attestations') IS NULL
    OR to_regclass('private.tournament_team_entry_core_snapshots') IS NULL
    OR to_regprocedure('private.prevent_identity_reassignment()') IS NULL
    OR to_regclass('public.tournament_seasons') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'torneos_core_adapter') THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_PRECONDITION_FAILED: 0000 + 0009 are required';
  END IF;
  IF to_regclass('private.tournament_account_erasures') IS NOT NULL
    OR to_regprocedure('private.erase_tournament_account(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('private.confirm_tournament_account_erasure(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('private.account_erasure_label(text,uuid,uuid)') IS NOT NULL
    OR to_regprocedure('private.refuse_erased_identity()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'torneos_identity_refuse_erased')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'torneos_erasure_writer') THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_PRECONDITION_FAILED: already applied';
  END IF;
END
$pre$;

-- The erasure role: NOLOGIN (the gateway's login is created out of band and made a NOINHERIT member of it), NOINHERIT,
-- member of nothing. Its privileges are exactly the three grants at the end of this file.
create role torneos_erasure_writer nologin noinherit;
comment on role torneos_erasure_writer is
  'Account erasure (0021): may only EXECUTE private.erase_tournament_account and private.confirm_tournament_account_erasure. Reached by the gateway login torneos_edge_erasure_writer (provisioned out of band; its credential lives only in Secret Manager).';

create table private.tournament_account_erasures (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  request_id uuid not null,
  core_user_sha256 text not null,
  identity_id uuid not null references public.torneos_identity(id) on delete restrict,
  state text not null default 'torneos_erased',
  erased_at timestamptz not null default now(),
  core_confirmed_at timestamptz,
  core_confirmed_by text,
  core_confirm_request_id uuid,
  summary jsonb not null,
  pending_storage_objects jsonb not null default '[]'::jsonb,
  constraint tournament_account_erasures_identity_unique unique (identity_id),
  constraint tournament_account_erasures_hash_check check (core_user_sha256 ~ '^[0-9a-f]{64}$'),
  constraint tournament_account_erasures_state_check check (state in ('torneos_erased', 'core_confirmed')),
  constraint tournament_account_erasures_confirmed_check check (
    (state = 'torneos_erased' and core_confirmed_at is null and core_confirmed_by is null and core_confirm_request_id is null)
    or (state = 'core_confirmed' and core_confirmed_at is not null and core_confirmed_by in ('core', 'operator'))),
  constraint tournament_account_erasures_summary_check check (jsonb_typeof(summary) = 'object'),
  constraint tournament_account_erasures_objects_check check (jsonb_typeof(pending_storage_objects) = 'array')
);
create index tournament_account_erasures_hash_idx on private.tournament_account_erasures (core_user_sha256);
create index tournament_account_erasures_unconfirmed_idx on private.tournament_account_erasures (erased_at) where state = 'torneos_erased';
alter table private.tournament_account_erasures enable row level security;
alter table private.tournament_account_erasures force row level security;
revoke all on private.tournament_account_erasures from public, anon, authenticated, service_role;
comment on table private.tournament_account_erasures is
  'Account erasures (0021): one row per severed identity. core_user_sha256 = sha256 of the deleted Core user id (answers a repeated request as already_erased; matches Core in a reconcile); request_id = the deletion request (Core''s idempotency key); state torneos_erased → core_confirmed once Core deleted its own account. No client role can read it.';

create function private.account_erasure_label(p_kind text, p_identity uuid, p_organization uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_kind || ' ' || upper(left(md5(p_identity::text || ':' || coalesce(p_organization::text, '-')), 6));
$$;
revoke all on function private.account_erasure_label(text, uuid, uuid) from public, anon, authenticated, service_role;
comment on function private.account_erasure_label(text, uuid, uuid) is
  'Pseudonym of an erased person inside one organization: stable there (history stays consistent), different across organizations.';

create function private.erase_tournament_account(p_core_user_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- The guard triggers this function may bypass, and only around its own anonymising updates.
  c_guards constant text[] := array[
    'public.torneos_identity|torneos_identity_immutable',
    'public.tournament_organization_members|tournament_organization_members_protect_owner',
    'public.tournament_match_squad_players|tournament_match_squad_players_history_guard',
    'public.tournament_match_squad_players|tournament_squad_player_suspension_guard',
    'public.tournament_match_squad_players|tournament_match_squad_players_scope_guard',
    'public.tournament_match_operation_players|tournament_match_operation_players_completed_guard',
    'public.tournament_match_operation_players|tournament_match_operation_players_history_guard',
    'public.tournament_match_operation_players|tournament_operation_player_suspension_guard',
    'public.tournament_match_availability_responses|tournament_match_availability_scope_guard'
  ];
  c_player constant text := 'Jugador eliminado';
  c_manager constant text := 'Responsable eliminado';
  v_hash text;
  v_identity uuid;
  v_guard text;
  v_owned uuid[];
  v_org uuid;
  v_membership uuid;
  v_successor uuid;
  v_rosters uuid[];
  v_managers uuid[];
  v_transferred uuid[] := '{}';
  v_archived uuid[] := '{}';
  v_objects jsonb := '[]'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  v_pages bigint := 0;
  v_listings bigint := 0;
  v_erasure uuid;
  v_summary jsonb;
begin
  if p_core_user_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_ACCOUNT_ERASURE_INVALID';
  end if;
  v_hash := encode(sha256(convert_to(p_core_user_id::text, 'UTF8')), 'hex');
  -- The wait bound FIRST: lock_timeout also bounds advisory locks (measured on the lab, E25), so a busy erasure fails
  -- in 5 s with 55P03 (retryable: the gateway answers 503, Core keeps the account) instead of waiting unbounded.
  perform set_config('lock_timeout', '5000', true);
  -- This person's key, exclusive: the identity writer's tombstone check (private.refuse_erased_identity) waits on it,
  -- so no identity can be created for this Core user while the erasure runs, and none after it (the ledger row).
  perform pg_advisory_xact_lock(hashtextextended('torneos.account_erasure:' || v_hash, 21));
  -- Then the global key: erasures run one at a time (two people who are each other's successor never race).
  perform pg_advisory_xact_lock(hashtextextended('torneos.account_erasure', 21));

  select identity.id into v_identity
  from public.torneos_identity identity
  where identity.core_user_id = p_core_user_id
  for update;

  if v_identity is null then
    return jsonb_build_object(
      'outcome', case when exists (select 1 from private.tournament_account_erasures e where e.core_user_sha256 = v_hash)
        then 'already_erased' else 'no_identity' end,
      'requestId', p_request_id);
  end if;

  foreach v_guard in array c_guards loop
    if not exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = split_part(v_guard, '|', 1)::regclass and t.tgname = split_part(v_guard, '|', 2) and t.tgenabled = 'O'
    ) then
      raise exception using errcode = '55000', message = 'TORNEOS_ACCOUNT_ERASURE_GUARD_STATE',
        detail = v_guard;
    end if;
  end loop;

  -- 1. Organizations the person owns: transfer to the longest-standing active admin, or archive.
  select coalesce(array_agg(m.organization_id order by m.organization_id), '{}') into v_owned
  from public.tournament_organization_members m
  where m.user_id = v_identity and m.role = 'owner' and m.status = 'active';

  execute 'alter table public.tournament_organization_members disable trigger tournament_organization_members_protect_owner';
  foreach v_org in array v_owned loop
    select m.id into v_membership from public.tournament_organization_members m
    where m.organization_id = v_org and m.user_id = v_identity;
    v_successor := null;
    if exists (select 1 from public.tournament_organizations o where o.id = v_org and o.status = 'active') then
      select m.id into v_successor
      from public.tournament_organization_members m
      where m.organization_id = v_org and m.user_id <> v_identity and m.role = 'admin' and m.status = 'active'
      order by m.joined_at, m.created_at, m.id
      limit 1
      for update;
    end if;
    update public.tournament_organization_members
    set role = 'admin', status = 'removed', updated_at = now()
    where id = v_membership;
    if v_successor is not null then
      update public.tournament_organization_members
      set role = 'owner', updated_at = now()
      where id = v_successor;
      insert into public.tournament_audit_log (organization_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata)
      values (v_org, null, 'system', 'organization.owner_transferred', 'organization', v_org,
        jsonb_build_object('reason', 'account_erasure', 'successorMembershipId', v_successor));
      v_transferred := v_transferred || v_org;
    elsif exists (select 1 from public.tournament_organizations o where o.id = v_org and o.status = 'active') then
      update public.tournament_organizations
      set status = 'archived', archived_at = now(), updated_at = now()
      where id = v_org;
      update public.tournament_public_pages
      set status = 'unpublished', unpublished_by = v_identity, unpublished_at = now(), updated_at = now()
      where organization_id = v_org and status = 'published';
      get diagnostics v_n = row_count;
      v_pages := v_pages + v_n;
      update public.tournament_catalog_listings
      set status = case when status = 'listed' then 'withdrawn' else status end,
          withdrawn_at = case when status = 'listed' then now() else withdrawn_at end,
          withdrawn_by = case when status = 'listed' then v_identity else withdrawn_by end,
          applications_state = 'closed', contact_whatsapp = null, updated_by = v_identity, updated_at = now()
      where organization_id = v_org;
      get diagnostics v_n = row_count;
      v_listings := v_listings + v_n;
      insert into public.tournament_audit_log (organization_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata)
      values (v_org, null, 'system', 'organization.archived', 'organization', v_org,
        jsonb_build_object('reason', 'account_erasure'));
      v_archived := v_archived || v_org;
    end if;
  end loop;
  execute 'alter table public.tournament_organization_members enable trigger tournament_organization_members_protect_owner';
  v_counts := v_counts || jsonb_build_object('organizationsTransferred', cardinality(v_transferred),
    'organizationsArchived', cardinality(v_archived), 'publicPagesUnpublished', v_pages, 'catalogListingsClosed', v_listings);

  -- 2. Every other membership ends; the person's season assignments go.
  update public.tournament_organization_members
  set status = 'removed', updated_at = now()
  where user_id = v_identity and status <> 'removed';
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('membershipsRemoved', v_n + cardinality(v_owned));
  delete from public.tournament_season_member_assignments a
  using public.tournament_organization_members m
  where m.id = a.membership_id and m.user_id = v_identity;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('seasonAssignmentsDeleted', v_n);

  -- 3. Team-manager roles (captain / delegate / assistant): pseudonym, no email, revoked; their invitations too.
  select coalesce(array_agg(id), '{}') into v_managers from public.tournament_team_managers where user_id = v_identity;
  update public.tournament_team_managers
  set display_name = private.account_erasure_label(c_manager, v_identity, organization_id),
      email_normalized = null,
      status = case when status in ('active', 'pending') then 'revoked' else status end,
      revoked_at = case when status in ('active', 'pending') then now() else revoked_at end,
      updated_at = now()
  where id = any(v_managers);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('teamManagersAnonymised', v_n);
  update public.tournament_team_invitations
  set email_normalized = 'eliminado-' || left(md5(v_identity::text || ':' || id::text), 12) || '@cuenta-eliminada.invalid',
      status = case when status = 'pending' then 'revoked' else status end,
      revoked_at = case when status = 'pending' then now() else revoked_at end
  where manager_id = any(v_managers);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('teamInvitationsAnonymised', v_n);
  update public.tournament_organization_invitations
  set email_normalized = 'eliminado-' || left(md5(v_identity::text || ':' || id::text), 12) || '@cuenta-eliminada.invalid'
  where accepted_by = v_identity;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('organizationInvitationsAnonymised', v_n);

  -- 4. Players: claimed provisional players and every roster row of the person get the pseudonym (public stats keep
  --    their numbers, the name changes); squad and match-report snapshots follow; personal notes go.
  update public.tournament_provisional_players
  set display_name = private.account_erasure_label(c_player, v_identity, organization_id),
      normalized_name = lower(private.account_erasure_label(c_player, v_identity, organization_id)),
      contact_email = null, contact_phone = null, updated_at = now()
  where claimed_by_user_id = v_identity;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('provisionalPlayersAnonymised', v_n);
  select coalesce(array_agg(p.id), '{}') into v_rosters
  from public.tournament_roster_players p
  where p.arma2_user_id = v_identity
     or p.provisional_player_id in (select pp.id from public.tournament_provisional_players pp where pp.claimed_by_user_id = v_identity);
  update public.tournament_roster_players
  set display_name = private.account_erasure_label(c_player, v_identity, organization_id), avatar_url = null, updated_at = now()
  where id = any(v_rosters);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('rosterPlayersAnonymised', v_n);

  execute 'alter table public.tournament_match_squad_players disable trigger tournament_match_squad_players_history_guard';
  execute 'alter table public.tournament_match_squad_players disable trigger tournament_squad_player_suspension_guard';
  execute 'alter table public.tournament_match_squad_players disable trigger tournament_match_squad_players_scope_guard';
  update public.tournament_match_squad_players
  set display_name_snapshot = private.account_erasure_label(c_player, v_identity, organization_id), avatar_url_snapshot = null
  where roster_player_id = any(v_rosters);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('squadSnapshotsAnonymised', v_n);
  execute 'alter table public.tournament_match_squad_players enable trigger tournament_match_squad_players_history_guard';
  execute 'alter table public.tournament_match_squad_players enable trigger tournament_squad_player_suspension_guard';
  execute 'alter table public.tournament_match_squad_players enable trigger tournament_match_squad_players_scope_guard';

  execute 'alter table public.tournament_match_operation_players disable trigger tournament_match_operation_players_completed_guard';
  execute 'alter table public.tournament_match_operation_players disable trigger tournament_match_operation_players_history_guard';
  execute 'alter table public.tournament_match_operation_players disable trigger tournament_operation_player_suspension_guard';
  update public.tournament_match_operation_players
  set display_name_snapshot = private.account_erasure_label(c_player, v_identity, organization_id), avatar_url_snapshot = null
  where roster_player_id = any(v_rosters);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('matchReportSnapshotsAnonymised', v_n);
  execute 'alter table public.tournament_match_operation_players enable trigger tournament_match_operation_players_completed_guard';
  execute 'alter table public.tournament_match_operation_players enable trigger tournament_match_operation_players_history_guard';
  execute 'alter table public.tournament_match_operation_players enable trigger tournament_operation_player_suspension_guard';

  execute 'alter table public.tournament_match_availability_responses disable trigger tournament_match_availability_scope_guard';
  update public.tournament_match_availability_responses
  set comment = null,
      manual_reason = case when response_source = 'manual' then 'Dato eliminado con la cuenta' else manual_reason end
  where (user_id = v_identity or roster_player_id = any(v_rosters))
    and (comment is not null or (response_source = 'manual' and manual_reason is distinct from 'Dato eliminado con la cuenta'));
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('availabilityNotesCleared', v_n);
  execute 'alter table public.tournament_match_availability_responses enable trigger tournament_match_availability_scope_guard';

  update public.tournament_team_applications set message = null where applicant_user_id = v_identity and message is not null;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('applicationMessagesCleared', v_n);

  -- 5. Copies of Core data: the person leaves the frozen team snapshots; Core-contract attestations about them go.
  update private.tournament_team_entry_core_snapshots s
  set players = coalesce((
    select jsonb_agg(x.player order by x.position)
    from jsonb_array_elements(s.players) with ordinality as x(player, position)
    where x.player->>'core_user_id' is distinct from p_core_user_id::text), '[]'::jsonb)
  where s.players @> jsonb_build_array(jsonb_build_object('core_user_id', p_core_user_id::text));
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('coreSnapshotsScrubbed', v_n);
  delete from private.core_contract_attestations a
  where a.identity_id = v_identity or strpos(a.response::text, p_core_user_id::text) > 0;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('coreAttestationsDeleted', v_n);

  -- 6. Media (off in phase 1): consents revoked, player tags removed, assignments and open upload sessions revoked,
  --    the person's portraits enter the existing two-phase delete (objects listed for the operator, never purged here).
  update public.tournament_media_consents
  set status = 'revoked', revoked_at = now(), legal_basis = null, updated_at = now()
  where (subject_user_id = v_identity or roster_player_id = any(v_rosters)) and status not in ('revoked', 'denied');
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('mediaConsentsRevoked', v_n);
  delete from public.tournament_media_relations where relation_type = 'player' and roster_player_id = any(v_rosters);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('mediaPlayerTagsDeleted', v_n);
  update public.tournament_media_assignments set status = 'revoked', revoked_at = now()
  where user_id = v_identity and status = 'active';
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('mediaAssignmentsRevoked', v_n);
  update public.tournament_media_upload_sessions set status = 'revoked'
  where requested_by = v_identity and status in ('issued', 'uploaded');
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('uploadSessionsRevoked', v_n);
  select coalesce(jsonb_agg(jsonb_build_object('bucket', p.bucket, 'objectPath', p.object_path) order by p.id), '[]'::jsonb)
  into v_objects
  from public.tournament_player_portraits p
  where p.roster_player_id = any(v_rosters) and p.lifecycle_status in ('active', 'upload_pending', 'delete_pending');
  update public.tournament_player_portraits
  set lifecycle_status = 'delete_pending', publication_consent = 'revoked',
      consent_actor_user_id = v_identity, consent_changed_at = now(), updated_at = now()
  where roster_player_id = any(v_rosters) and lifecycle_status in ('active', 'upload_pending');
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('portraitsMarkedForDeletion', v_n, 'storageObjectsPending', jsonb_array_length(v_objects));

  -- 7. Sponsors (0020, when present): the creator link goes; sponsors are the organization's content.
  if to_regclass('public.tournament_organization_sponsors') is not null then
    execute 'update public.tournament_organization_sponsors set created_by = null where created_by = $1' using v_identity;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('sponsorsDetached', v_n);
  end if;

  -- 7b. Moderation (0022, when present). Reports the person FILED stay (moderation history of the organization and the
  --     platform) without the reporter and without the reporter's free text; their own «created» events lose the actor
  --     too, or the detachment would be undone. Reports ABOUT the person's content follow the content: a player report
  --     carries the pseudonym the roster now shows, an application report loses the message the application lost. The
  --     person's mutes only served them; blocks of the person can never match again (severed identity) and their reason
  --     is text about the person. Staff acts (handled_by, created_by, released_by, other event actors) keep the severed
  --     reference, as tournament_audit_log and the media moderation actions do.
  if to_regclass('public.tournament_content_reports') is not null then
    execute 'update public.tournament_content_report_events e set actor_user_id = null
      from public.tournament_content_reports r
      where e.report_id = r.id and r.reporter_user_id = $1 and e.actor_user_id = $1 and e.event = ''created''' using v_identity;
    execute 'update public.tournament_content_reports set reporter_user_id = null, detail = null, updated_at = now()
      where reporter_user_id = $1' using v_identity;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('reportsDetached', v_n);
    execute 'update public.tournament_content_reports r
      set target_label = left(p.display_name, 200),
          content_snapshot = r.content_snapshot || jsonb_build_object(''playerName'', p.display_name), updated_at = now()
      from public.tournament_roster_players p
      where r.target_kind = ''player'' and r.target_id = p.id and p.id = any($1)' using v_rosters;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('playerReportsAnonymised', v_n);
    execute 'update public.tournament_content_reports r
      set content_snapshot = r.content_snapshot || jsonb_build_object(''message'', null), updated_at = now()
      from public.tournament_team_applications a
      where r.target_kind = ''application'' and r.target_id = a.team_entry_id and a.applicant_user_id = $1
        and r.content_snapshot ->> ''message'' is not null' using v_identity;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('applicationReportsScrubbed', v_n);
    execute 'delete from public.tournament_communication_mutes where user_id = $1' using v_identity;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('communicationMutesDeleted', v_n);
    execute 'delete from public.tournament_applicant_blocks where blocked_user_id = $1' using v_identity;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('applicantBlocksDeleted', v_n);
  end if;

  -- 8. Rows that only served the person.
  delete from public.tournament_user_notifications where recipient_user_id = v_identity;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('notificationsDeleted', v_n);
  delete from public.tournament_notification_preferences where user_id = v_identity;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('notificationPreferencesDeleted', v_n);
  delete from public.tournament_participant_hub_preferences where user_id = v_identity;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('hubPreferencesDeleted', v_n);
  delete from public.user_tournament_context_preferences where user_id = v_identity;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('contextPreferencesDeleted', v_n);
  delete from public.user_workspace_preferences where user_id = v_identity;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('workspacePreferencesDeleted', v_n);
  delete from public.tournament_user_profiles where user_id = v_identity;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('profilesDeleted', v_n);

  -- 9. Sever the identity: a random core_user_id that maps to nobody. History keeps pointing at the same row.
  execute 'alter table public.torneos_identity disable trigger torneos_identity_immutable';
  update public.torneos_identity set core_user_id = pg_catalog.gen_random_uuid() where id = v_identity;
  execute 'alter table public.torneos_identity enable trigger torneos_identity_immutable';

  v_summary := jsonb_build_object('outcome', 'erased', 'requestId', p_request_id, 'counts', v_counts,
    'organizationsTransferred', to_jsonb(v_transferred), 'organizationsArchived', to_jsonb(v_archived));
  insert into private.tournament_account_erasures (request_id, core_user_sha256, identity_id, summary, pending_storage_objects)
  values (p_request_id, v_hash, v_identity, v_summary, v_objects)
  returning id into v_erasure;

  -- Postconditions: any failure rolls the whole erasure back (nothing half-done), and a retry starts over.
  foreach v_guard in array c_guards loop
    if not exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = split_part(v_guard, '|', 1)::regclass and t.tgname = split_part(v_guard, '|', 2) and t.tgenabled = 'O'
    ) then
      raise exception using errcode = '55000', message = 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED', detail = 'guard ' || v_guard;
    end if;
  end loop;
  if exists (select 1 from public.torneos_identity i where i.core_user_id = p_core_user_id) then
    raise exception using errcode = '55000', message = 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED', detail = 'identity';
  end if;
  if exists (select 1 from public.tournament_organization_members m where m.user_id = v_identity and m.status <> 'removed') then
    raise exception using errcode = '55000', message = 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED', detail = 'membership';
  end if;
  if exists (
    select 1 from public.tournament_organizations o
    where o.status = 'active' and (o.id = any(v_owned)) and not exists (
      select 1 from public.tournament_organization_members m
      where m.organization_id = o.id and m.role = 'owner' and m.status = 'active' and m.user_id <> v_identity)
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED', detail = 'orphan organization';
  end if;
  if exists (
    select 1 from public.tournament_roster_players p
    where p.id = any(v_rosters) and (p.avatar_url is not null
      or p.display_name is distinct from private.account_erasure_label(c_player, v_identity, p.organization_id))
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED', detail = 'roster';
  end if;

  return v_summary || jsonb_build_object('erasureId', v_erasure);
end;
$$;
revoke all on function private.erase_tournament_account(uuid, uuid)
  from public, anon, authenticated, service_role, torneos_core_adapter, torneos_identity_writer;
comment on function private.erase_tournament_account(uuid, uuid) is
  'Account erasure (0021): anonymises / ends / deletes what Torneos holds about one Core user, in one transaction, idempotent by Core user id; the ledger row is born torneos_erased. Only torneos_erasure_writer (the gateway''s erasure login, for a request signed by Core) may call it.';

create function private.confirm_tournament_account_erasure(p_core_user_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_sweep jsonb;
  v_n bigint;
  v_total bigint;
begin
  if p_core_user_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_ACCOUNT_ERASURE_INVALID';
  end if;
  v_hash := encode(sha256(convert_to(p_core_user_id::text, 'UTF8')), 'hex');
  -- Core says its own account deletion finished. First the sweep: a Torneos session opened between the erasure and the
  -- Core deletion may have re-created an (empty) identity for this Core user; it is erased now (a no-op otherwise).
  v_sweep := private.erase_tournament_account(p_core_user_id, p_request_id);
  update private.tournament_account_erasures
  set state = 'core_confirmed', core_confirmed_at = now(), core_confirmed_by = 'core', core_confirm_request_id = p_request_id
  where core_user_sha256 = v_hash and state = 'torneos_erased';
  get diagnostics v_n = row_count;
  select count(*) into v_total from private.tournament_account_erasures e where e.core_user_sha256 = v_hash;
  if exists (select 1 from private.tournament_account_erasures e where e.core_user_sha256 = v_hash and e.state <> 'core_confirmed') then
    raise exception using errcode = '55000', message = 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED', detail = 'confirmation';
  end if;
  return jsonb_build_object('outcome', case when v_total = 0 then 'no_ledger' else 'core_confirmed' end,
    'requestId', p_request_id, 'confirmedNow', v_n, 'sweep', v_sweep->>'outcome');
end;
$$;
revoke all on function private.confirm_tournament_account_erasure(uuid, uuid)
  from public, anon, authenticated, service_role, torneos_core_adapter, torneos_identity_writer;
comment on function private.confirm_tournament_account_erasure(uuid, uuid) is
  'Account erasure (0021): Core confirms it deleted its own account. Sweeps (erases an identity re-created in between) and moves the person''s ledger rows torneos_erased → core_confirmed; idempotent. Only torneos_erasure_writer may call it.';

-- TOMBSTONE: the ledger is authoritative. No identity is ever created again for an erased Core user, whatever still
-- holds a valid Core JWT (deleting a Supabase Auth user does not revoke the access tokens it already issued) or a
-- session racing the erasure: the gateway's identity writer (INSERT … ON CONFLICT on torneos_identity) is refused with
-- TORNEOS_ACCOUNT_ERASED. Resolving an existing identity needs (id, core_user_id) to match (private.current_identity_id),
-- which the erasure severed, so a bridge token issued before the erasure resolves to nobody. A NEW Core account (a new
-- core_user_id) is a new person: its identity is created as always.
create function private.refuse_erased_identity()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hash text := encode(sha256(convert_to(new.core_user_id::text, 'UTF8')), 'hex');
begin
  -- Shared on this person's key: waits (bounded by the caller's lock_timeout / statement_timeout) while an erasure of
  -- this Core user runs, never for other people's exchanges; then reads the ledger with a fresh snapshot.
  perform pg_advisory_xact_lock_shared(hashtextextended('torneos.account_erasure:' || v_hash, 21));
  if exists (select 1 from private.tournament_account_erasures e where e.core_user_sha256 = v_hash) then
    raise exception using errcode = '42501', message = 'TORNEOS_ACCOUNT_ERASED';
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_erased_identity()
  from public, anon, authenticated, service_role, torneos_core_adapter, torneos_identity_writer, torneos_erasure_writer;
comment on function private.refuse_erased_identity() is
  'Account erasure (0021) tombstone: refuses (TORNEOS_ACCOUNT_ERASED) any new identity for a Core user the erasure ledger records.';
create trigger torneos_identity_refuse_erased before insert on public.torneos_identity
  for each row execute function private.refuse_erased_identity();

-- The erasure role's privileges, exactly: reach the private schema and run the two erasure functions. Nothing else.
grant usage on schema private to torneos_erasure_writer;
grant execute on function private.erase_tournament_account(uuid, uuid) to torneos_erasure_writer;
grant execute on function private.confirm_tournament_account_erasure(uuid, uuid) to torneos_erasure_writer;

DO $post$
DECLARE
  v_role text;
  v_fn text;
BEGIN
  -- Only the erasure role may run the erasure or the confirmation; nobody may call the pseudonym or touch the ledger.
  FOREACH v_fn IN ARRAY array['private.erase_tournament_account(uuid,uuid)', 'private.confirm_tournament_account_erasure(uuid,uuid)'] LOOP
    IF NOT has_function_privilege('torneos_erasure_writer', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED: % not granted to torneos_erasure_writer', v_fn;
    END IF;
    FOREACH v_role IN ARRAY array['anon', 'authenticated', 'service_role', 'torneos_core_adapter', 'torneos_identity_writer'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED: % may execute %', v_role, v_fn;
      END IF;
    END LOOP;
  END LOOP;
  -- The tombstone guard: present, enabled, BEFORE INSERT on the identity table; nobody may call its function directly.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.torneos_identity'::regclass AND t.tgname = 'torneos_identity_refuse_erased'
      AND t.tgenabled = 'O' AND t.tgfoid = 'private.refuse_erased_identity()'::regprocedure) THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED: tombstone trigger';
  END IF;
  FOREACH v_role IN ARRAY array['anon', 'authenticated', 'service_role', 'torneos_core_adapter', 'torneos_identity_writer', 'torneos_erasure_writer'] LOOP
    IF has_function_privilege(v_role, 'private.refuse_erased_identity()', 'EXECUTE') THEN
      RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED: % may execute the tombstone function', v_role;
    END IF;
  END LOOP;
  FOREACH v_role IN ARRAY array['anon', 'authenticated', 'service_role', 'torneos_core_adapter', 'torneos_identity_writer', 'torneos_erasure_writer'] LOOP
    IF has_function_privilege(v_role, 'private.account_erasure_label(text,uuid,uuid)', 'EXECUTE')
      OR has_table_privilege(v_role, 'private.tournament_account_erasures', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED: % reaches the pseudonym or the ledger', v_role;
    END IF;
  END LOOP;
  -- The erasure role: no login, no inheritance, no attribute, member of no role, and no grant on any other function,
  -- table, view or sequence of public / private / storage.
  IF NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'torneos_erasure_writer' AND NOT r.rolcanlogin AND NOT r.rolinherit
      AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication AND NOT r.rolbypassrls)
    OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = 'torneos_erasure_writer'::regrole) THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED: torneos_erasure_writer attributes';
  END IF;
  IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'private', 'storage')
        AND p.oid NOT IN ('private.erase_tournament_account(uuid,uuid)'::regprocedure, 'private.confirm_tournament_account_erasure(uuid,uuid)'::regprocedure)
        AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 'torneos_erasure_writer'::regrole))
    OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'private', 'storage')
        AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 'torneos_erasure_writer'::regrole)) THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED: torneos_erasure_writer holds another privilege';
  END IF;
  -- The guard triggers the erasure toggles must belong to tables the installer (this function's owner) owns.
  IF EXISTS (
    SELECT 1 FROM unnest(array['public.torneos_identity', 'public.tournament_organization_members',
      'public.tournament_match_squad_players', 'public.tournament_match_operation_players',
      'public.tournament_match_availability_responses']) AS t(rel)
    WHERE (SELECT c.relowner FROM pg_class c WHERE c.oid = t.rel::regclass)
      IS DISTINCT FROM (SELECT p.proowner FROM pg_proc p WHERE p.oid = 'private.erase_tournament_account(uuid,uuid)'::regprocedure)
  ) THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED: the installer must own the guarded tables';
  END IF;
END
$post$;

COMMIT;
