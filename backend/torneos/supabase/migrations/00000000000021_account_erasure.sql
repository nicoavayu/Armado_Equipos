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
--   * private.tournament_account_erasures: the erasure ledger (sha256 of the Core user id, the severed identity, the
--     summary, the storage objects left for the operator). No client role can read it.
--   * private.account_erasure_label(kind, identity, organization): the pseudonym.
--   * private.erase_tournament_account(core_user_id, request_id): the erasure, in ONE transaction (all or nothing),
--     idempotent by core user id: { outcome: erased | already_erased | no_identity, … }. EXECUTE only for
--     torneos_core_adapter (the gateway's Core-contract role; the gateway calls it only for a request signed by Core).
-- No existing function body, policy, grant, table or trigger definition changes. The guard triggers that make official
-- history immutable are disabled and re-enabled INSIDE the erasure transaction only, around the anonymising updates
-- (ALTER TABLE … DISABLE/ENABLE TRIGGER needs the table owner = the installer that owns this function); the function
-- refuses to start if any of them is not enabled, and verifies they are all enabled again before it returns.
-- Applies on main (0000 → 0019) and on main + 0020 (sponsors): the sponsors table is handled only if it exists.
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
    OR to_regprocedure('private.account_erasure_label(text,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_PRECONDITION_FAILED: already applied';
  END IF;
END
$pre$;

create table private.tournament_account_erasures (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  request_id uuid not null,
  core_user_sha256 text not null,
  identity_id uuid not null references public.torneos_identity(id) on delete restrict,
  erased_at timestamptz not null default now(),
  summary jsonb not null,
  pending_storage_objects jsonb not null default '[]'::jsonb,
  constraint tournament_account_erasures_identity_unique unique (identity_id),
  constraint tournament_account_erasures_hash_check check (core_user_sha256 ~ '^[0-9a-f]{64}$'),
  constraint tournament_account_erasures_summary_check check (jsonb_typeof(summary) = 'object'),
  constraint tournament_account_erasures_objects_check check (jsonb_typeof(pending_storage_objects) = 'array')
);
create index tournament_account_erasures_hash_idx on private.tournament_account_erasures (core_user_sha256);
alter table private.tournament_account_erasures enable row level security;
alter table private.tournament_account_erasures force row level security;
revoke all on private.tournament_account_erasures from public, anon, authenticated, service_role;
comment on table private.tournament_account_erasures is
  'Account erasures (0021): one row per severed identity. core_user_sha256 = sha256 of the deleted Core user id, kept only to answer a repeated request as already_erased. No client role can read it.';

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
  -- Erasures run one at a time (two people who are each other's successor never race), and fail instead of waiting long.
  perform pg_advisory_xact_lock(hashtextextended('torneos.account_erasure', 21));
  perform set_config('lock_timeout', '5000', true);

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
revoke all on function private.erase_tournament_account(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.erase_tournament_account(uuid, uuid) to torneos_core_adapter;
comment on function private.erase_tournament_account(uuid, uuid) is
  'Account erasure (0021): anonymises / ends / deletes what Torneos holds about one Core user, in one transaction, idempotent by Core user id. Only torneos_core_adapter (the gateway, for a request signed by Core) may call it.';

DO $post$
BEGIN
  IF has_function_privilege('anon', 'private.erase_tournament_account(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.erase_tournament_account(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'private.erase_tournament_account(uuid,uuid)', 'EXECUTE')
    OR NOT has_function_privilege('torneos_core_adapter', 'private.erase_tournament_account(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('torneos_identity_writer', 'private.erase_tournament_account(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'private.account_erasure_label(text,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.account_erasure_label(text,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'private.account_erasure_label(text,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('torneos_core_adapter', 'private.account_erasure_label(text,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED: function grants';
  END IF;
  IF has_table_privilege('anon', 'private.tournament_account_erasures', 'SELECT')
    OR has_table_privilege('authenticated', 'private.tournament_account_erasures', 'SELECT')
    OR has_table_privilege('service_role', 'private.tournament_account_erasures', 'SELECT')
    OR has_table_privilege('torneos_core_adapter', 'private.tournament_account_erasures', 'SELECT')
    OR has_table_privilege('torneos_identity_writer', 'private.tournament_account_erasures', 'SELECT') THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED: ledger grants';
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
