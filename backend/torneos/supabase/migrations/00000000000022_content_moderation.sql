-- Arma2 Torneos — 0022 CONTENT MODERATION: report user-generated content, review it (the organization for team and player
-- names of its tournaments, the Arma2 platform for everything else and for escalations), and block (a participant mutes an
-- organization's communications; an organization blocks an applicant). Spec: docs/superpowers/specs/
-- 2026-10-15-torneos-moderation-design.md. Apple App Review 1.2 / Google Play UGC for the phase-1 native build and the web.
-- Applies after 00000000000019 (main) and also after 00000000000020 / 00000000000021 in any order: it REPLACES NO EXISTING
-- FUNCTION (proved below); it only adds tables, functions and three triggers on existing tables.
-- Rollback (documented, never automatic): backend/torneos/moderation-v1/rollback/00000000000022_content_moderation.rollback.sql
-- Operator driver (prepared, never run without GO): backend/torneos/moderation-v1/remote/db-0022.mjs
--
-- What it adds, and nothing else:
--   * public.tournament_content_reports, public.tournament_content_report_events, public.tournament_communication_mutes,
--     public.tournament_applicant_blocks and private.tournament_moderation_holds. RLS on and NO grant to any API role.
--   * Seven RPCs, EXECUTE to authenticated only (never anon, PUBLIC or service_role), identity = private.current_identity_id():
--       report_tournament_content(kind, public_slug, target_id, target_label, reason, detail, idempotency_key)  anyone signed in
--       get_tournament_content_reports(organization_id, status)                     owners / admins of the organization
--       handle_tournament_content_report(report_id, status, action, note)           owners / admins, organization-scope reports
--       block_tournament_applicant(organization_id, team_entry_id, reason)          owners / admins
--       unblock_tournament_applicant(organization_id, block_id)                     owners / admins
--       set_tournament_communications_muted(organization_id, announcement_id, muted) a recipient of the organization
--       get_my_tournament_communication_mutes()                                     the caller's own mutes
--   * Two platform functions with NO grant to any API role (not even service_role): the operator runs them as the
--     installer through db-0022.mjs. platform_list_tournament_content_reports(status, limit),
--     platform_handle_tournament_content_report(report_id, status, action, note). The gateway refuses every platform_* name.
--   * Triggers (new functions): a page under a platform hold cannot be published; an applicant blocked by an organization
--     cannot apply to it; a delivery to a recipient who muted the organization is born archived (never `emergency`).
--   Errors (SQLSTATE → HTTP through PostgREST, body { code, message, details }): 42501 TORNEOS_AUTH_REQUIRED,
--   22023 TORNEOS_REPORT_INVALID (details: the field), 22023 TORNEOS_REPORT_TARGET_INVALID,
--   PT429 TORNEOS_REPORT_RATE_LIMITED, PT409 TORNEOS_REPORT_NOT_FOUND, PT409 TORNEOS_REPORT_ALREADY_CLOSED,
--   22023 TORNEOS_REPORT_ACTION_INVALID, 42501 TORNEOS_MODERATION_FORBIDDEN, 42501 TORNEOS_APPLICATION_BLOCKED,
--   42501 TORNEOS_PUBLIC_PAGE_MODERATION_HOLD, 42501 TORNEOS_COMMUNICATIONS_MUTE_FORBIDDEN, PT409 TORNEOS_BLOCK_NOT_FOUND.
--   Access is always checked first; another organization's report, target or block is indistinguishable from none.
BEGIN;

CREATE TEMPORARY TABLE torneos_0022_functions (sig text PRIMARY KEY, state text NOT NULL) ON COMMIT DROP;
CREATE TEMPORARY TABLE torneos_0022_relations (rel text PRIMARY KEY, state text NOT NULL) ON COMMIT DROP;
CREATE TEMPORARY TABLE torneos_0022_triggers (tg text PRIMARY KEY, state text NOT NULL) ON COMMIT DROP;
CREATE TEMPORARY TABLE torneos_0022_counts (authenticated integer NOT NULL, anon integer NOT NULL, service integer NOT NULL,
  policies text NOT NULL) ON COMMIT DROP;

-- ============================================================================================ 1. preconditions
DO $pre$
DECLARE
  -- md5(prosrc) of every existing function 0022 calls.
  v_pins constant jsonb := jsonb_build_object(
    'private.current_identity_id()', '4fc320dde15823ae4e7f31c6e670f08e',
    'public.platform_remove_tournament_catalog_listing(uuid,text)', '57a9a930ffd7d1735b0bfc5351d87e60'
  );
  v_key text;
  v_md5 text;
BEGIN
  IF to_regclass('public.tournament_content_reports') IS NOT NULL
    OR to_regclass('public.tournament_content_report_events') IS NOT NULL
    OR to_regclass('public.tournament_communication_mutes') IS NOT NULL
    OR to_regclass('public.tournament_applicant_blocks') IS NOT NULL
    OR to_regclass('private.tournament_moderation_holds') IS NOT NULL
    OR to_regprocedure('public.report_tournament_content(text,text,uuid,text,text,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'TORNEOS_0022_PRECONDITION_FAILED: already applied';
  END IF;
  IF to_regclass('public.tournament_team_applications') IS NULL
    OR to_regprocedure('private.tournament_season_media_open(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_0022_PRECONDITION_FAILED: 00000000000009 and 00000000000018 must be in force';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_pins) LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_key);
    IF v_md5 IS DISTINCT FROM v_pins->>v_key THEN
      RAISE EXCEPTION 'TORNEOS_0022_PRECONDITION_FAILED: % is not the expected body (%)', v_key, v_md5;
    END IF;
  END LOOP;
  -- "Nothing else moved": every function and relation of public/private(/storage), every trigger and every policy.
  INSERT INTO torneos_0022_functions
  SELECT p.oid::regprocedure::text, concat_ws('|', md5(p.prosrc), coalesce(p.proacl::text, '-'), pg_get_userbyid(p.proowner),
         p.prosecdef, p.provolatile, coalesce(p.proconfig::text, '-'), pg_get_function_result(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'private');
  INSERT INTO torneos_0022_relations
  SELECT n.nspname || '.' || c.relname, concat_ws('|', c.relkind, c.relrowsecurity, coalesce(c.relacl::text, '-'), pg_get_userbyid(c.relowner))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'private', 'storage') AND c.relkind IN ('r', 'v', 'm', 'p', 'f', 'S');
  INSERT INTO torneos_0022_triggers
  SELECT t.tgrelid::regclass::text || '.' || t.tgname, concat_ws('|', t.tgenabled, t.tgfoid::regprocedure::text, t.tgtype)
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'private');
  INSERT INTO torneos_0022_counts
  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('service_role', p.oid, 'EXECUTE')),
         (SELECT md5(coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '-')
            || ':' || coalesce(with_check, '-') || ':' || roles::text, ',' ORDER BY schemaname, tablename, policyname), ''))
          FROM pg_policies WHERE schemaname IN ('public', 'private', 'storage'))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
END $pre$;

-- ============================================================================================ 2. tables
create table public.tournament_content_reports (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.tournament_organizations(id) on delete cascade,
  tournament_id uuid,
  target_kind text not null,
  target_id uuid not null,
  target_label text not null,
  content_snapshot jsonb not null default '{}'::jsonb,
  review_scope text not null,
  -- SET NULL: deleting an identity (account deletion) keeps the moderation record without the reporter.
  reporter_user_id uuid references public.torneos_identity(id) on delete set null,
  reason text not null,
  detail text,
  status text not null default 'open',
  action_taken text,
  resolution_note text,
  handled_by uuid references public.torneos_identity(id) on delete set null,
  handled_by_platform boolean not null default false,
  handled_at timestamptz,
  escalated_at timestamptz,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_content_reports_tournament_fk
    foreign key (organization_id, tournament_id) references public.tournaments(organization_id, id) on delete cascade,
  constraint tournament_content_reports_kind_check check (target_kind in (
    'organization', 'tournament', 'catalog_listing', 'announcement', 'team', 'player', 'application')),
  constraint tournament_content_reports_tournament_check check (target_kind = 'organization' or tournament_id is not null),
  constraint tournament_content_reports_label_check check (
    target_label = btrim(target_label) and char_length(target_label) between 1 and 200 and target_label !~ '[[:cntrl:]]'),
  constraint tournament_content_reports_snapshot_check check (
    jsonb_typeof(content_snapshot) = 'object' and pg_column_size(content_snapshot) <= 4096),
  constraint tournament_content_reports_scope_check check (review_scope in ('organization', 'platform')),
  constraint tournament_content_reports_reason_check check (reason in ('offensive', 'impersonation', 'personal_data', 'spam', 'other')),
  constraint tournament_content_reports_detail_check check (detail is null or (
    detail = btrim(detail) and char_length(detail) between 3 and 500 and detail !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')),
  constraint tournament_content_reports_status_check check (status in ('open', 'under_review', 'resolved', 'dismissed')),
  constraint tournament_content_reports_resolution_check check (
    (status in ('resolved', 'dismissed') and handled_at is not null and resolution_note is not null
      and resolution_note = btrim(resolution_note) and char_length(resolution_note) between 3 and 500)
    or (status in ('open', 'under_review') and handled_at is null and action_taken is null)),
  constraint tournament_content_reports_action_check check (action_taken is null or action_taken ~ '^[a-z_]{3,40}$')
);
create unique index tournament_content_reports_idempotency_idx
  on public.tournament_content_reports (reporter_user_id, idempotency_key);
-- One open report per reporter and target: a second one is the same report.
create unique index tournament_content_reports_open_target_idx
  on public.tournament_content_reports (reporter_user_id, target_kind, target_id) where status in ('open', 'under_review');
create index tournament_content_reports_queue_idx
  on public.tournament_content_reports (review_scope, status, created_at);
create index tournament_content_reports_organization_idx
  on public.tournament_content_reports (organization_id, status, created_at desc);
create index tournament_content_reports_reporter_recent_idx
  on public.tournament_content_reports (reporter_user_id, created_at desc);
comment on table public.tournament_content_reports is
  'Reports of user-generated content (0022). Reached only through SECURITY DEFINER RPCs; the reporter is never shown to the organization.';

create table public.tournament_content_report_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.tournament_content_reports(id) on delete cascade,
  actor_user_id uuid references public.torneos_identity(id) on delete set null,
  actor_type text not null,
  event text not null,
  from_status text,
  to_status text,
  action text,
  note text,
  created_at timestamptz not null default now(),
  constraint tournament_content_report_events_actor_check check (actor_type in ('user', 'platform')),
  constraint tournament_content_report_events_event_check check (event in ('created', 'status_changed', 'escalated', 'action')),
  constraint tournament_content_report_events_note_check check (note is null or char_length(note) <= 500)
);
create index tournament_content_report_events_report_idx on public.tournament_content_report_events (report_id, id);
comment on table public.tournament_content_report_events is 'Audit trail of every content report (0022).';

create table public.tournament_communication_mutes (
  user_id uuid not null references public.torneos_identity(id) on delete cascade,
  organization_id uuid not null references public.tournament_organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);
comment on table public.tournament_communication_mutes is
  'A participant muted an organization (0022): its new announcements are delivered archived (never `emergency`).';

create table public.tournament_applicant_blocks (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.tournament_organizations(id) on delete cascade,
  blocked_user_id uuid not null references public.torneos_identity(id) on delete cascade,
  reason text not null,
  source_team_entry_id uuid,
  created_by uuid references public.torneos_identity(id) on delete set null,
  created_by_platform boolean not null default false,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references public.torneos_identity(id) on delete set null,
  constraint tournament_applicant_blocks_reason_check check (
    reason = btrim(reason) and char_length(reason) between 3 and 300 and reason !~ '[[:cntrl:]]')
);
create unique index tournament_applicant_blocks_active_idx
  on public.tournament_applicant_blocks (organization_id, blocked_user_id) where released_at is null;
comment on table public.tournament_applicant_blocks is
  'An organization blocked an applicant (0022): that identity cannot request a place in any of its tournaments.';

create table private.tournament_moderation_holds (
  tournament_id uuid primary key,
  organization_id uuid not null,
  report_id uuid references public.tournament_content_reports(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  constraint tournament_moderation_holds_tournament_fk
    foreign key (organization_id, tournament_id) references public.tournaments(organization_id, id) on delete cascade,
  constraint tournament_moderation_holds_reason_check check (char_length(reason) between 3 and 500)
);
comment on table private.tournament_moderation_holds is
  'Platform hold of a tournament''s public page (0022): while active, the page cannot be published again.';

alter table public.tournament_content_reports enable row level security;
alter table public.tournament_content_report_events enable row level security;
alter table public.tournament_communication_mutes enable row level security;
alter table public.tournament_applicant_blocks enable row level security;
alter table private.tournament_moderation_holds enable row level security;
-- Applied as postgres (the hosted installer), whose default privileges grant every new table to the API roles.
revoke all on table public.tournament_content_reports from public, anon, authenticated, service_role;
revoke all on table public.tournament_content_report_events from public, anon, authenticated, service_role;
revoke all on table public.tournament_communication_mutes from public, anon, authenticated, service_role;
revoke all on table public.tournament_applicant_blocks from public, anon, authenticated, service_role;
revoke all on table private.tournament_moderation_holds from public, anon, authenticated, service_role;
revoke all on sequence public.tournament_content_report_events_id_seq from public, anon, authenticated, service_role;

-- ============================================================================================ 3. internal helpers
-- Owners and administrators of an active organization: the people who moderate its tournaments.
create function private.tournament_moderation_is_manager(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_identity_id() is not null and exists (
    select 1
    from public.tournament_organization_members membership
    join public.tournament_organizations organization on organization.id = membership.organization_id
    where membership.organization_id = p_organization_id
      and membership.user_id = private.current_identity_id()
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
      and organization.status = 'active'
  );
$$;

-- The one place that changes a report and the content it points to. p_platform = the operator (no identity).
create function private.tournament_moderation_handle(p_report_id uuid, p_status text, p_action text, p_note text,
  p_platform boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := case when p_platform then null else private.current_identity_id() end;
  v_report public.tournament_content_reports%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_action text := nullif(btrim(coalesce(p_action, '')), '');
  v_effects jsonb := '[]'::jsonb;
  v_suffix text;
  v_count integer;
  v_tournament record;
  v_entry record;
  v_page record;
  v_reason text;
begin
  select * into v_report from public.tournament_content_reports report where report.id = p_report_id for update;
  if not found then
    raise exception using errcode = 'PT409', message = 'TORNEOS_REPORT_NOT_FOUND';
  end if;
  if p_status is null or p_status not in ('under_review', 'resolved', 'dismissed', 'escalated') then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_INVALID', detail = 'status';
  end if;
  if v_note is not null and (char_length(v_note) not between 3 and 500 or v_note ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]') then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_INVALID', detail = 'note';
  end if;
  -- A closed report only accepts the release of a hold (platform), which keeps its status.
  if v_report.status in ('resolved', 'dismissed')
    and not (p_platform and v_action = 'release_tournament_hold' and p_status = v_report.status) then
    raise exception using errcode = 'PT409', message = 'TORNEOS_REPORT_ALREADY_CLOSED';
  end if;
  if p_status = 'escalated' and (p_platform or v_action is not null) then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_ACTION_INVALID';
  end if;
  if p_status in ('resolved', 'dismissed') and v_note is null then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_INVALID', detail = 'note';
  end if;
  if v_action is not null and p_status <> 'resolved' then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_ACTION_INVALID';
  end if;
  -- Which actions fit which content, and who may take them.
  if v_action is not null and not (
    (v_action in ('neutralize_team_name', 'remove_team_shield') and v_report.target_kind = 'team')
    or (v_action = 'neutralize_player_name' and v_report.target_kind = 'player')
    or (p_platform and v_action in ('take_down_tournament', 'release_tournament_hold', 'clear_tournament_logo')
        and v_report.tournament_id is not null)
    or (p_platform and v_action in ('take_down_organization', 'clear_organization_logo'))
    or (p_platform and v_action = 'revoke_announcement' and v_report.target_kind = 'announcement')
    or (p_platform and v_action = 'block_applicant' and v_report.target_kind = 'application')
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_ACTION_INVALID';
  end if;

  if v_action in ('neutralize_team_name', 'remove_team_shield') then
    select entry.id, entry.organization_id, entry.tournament_id into v_entry
    from public.tournament_team_entries entry
    where entry.id = v_report.target_id and entry.organization_id = v_report.organization_id;
    if v_entry.id is not null then
      v_suffix := upper(left(replace(v_entry.id::text, '-', ''), 4));
      -- The frozen fixture snapshot is what the public page shows: always moderated.
      if v_action = 'neutralize_team_name' then
        update public.tournament_competition_participants participant
        set snapshot_name = 'Equipo ' || v_suffix, snapshot_short_name = null
        where participant.team_entry_id = v_entry.id and participant.organization_id = v_entry.organization_id;
      else
        update public.tournament_competition_participants participant
        set snapshot_shield_path = null
        where participant.team_entry_id = v_entry.id and participant.organization_id = v_entry.organization_id;
      end if;
      get diagnostics v_count = row_count;
      v_effects := v_effects || jsonb_build_object('participants', v_count);
      -- The entry itself, unless the plan gate of the tournament refuses every entry write (then only the snapshot moved).
      begin
        if v_action = 'neutralize_team_name' then
          update public.tournament_team_entries set name = 'Equipo ' || v_suffix, short_name = null, updated_at = now()
          where id = v_entry.id;
        else
          update public.tournament_team_entries set shield_path = null, updated_at = now() where id = v_entry.id;
        end if;
        v_effects := v_effects || jsonb_build_object('entry', true);
      exception when insufficient_privilege then
        v_effects := v_effects || jsonb_build_object('entry', false);
      end;
    end if;
  elsif v_action = 'neutralize_player_name' then
    -- The public page identifies a player by name only: every active roster row of that tournament with the reported name.
    with targets as (
      select player.id
      from public.tournament_roster_players player
      join public.tournament_team_entries entry on entry.id = player.team_entry_id
      where entry.tournament_id = v_report.tournament_id and entry.organization_id = v_report.organization_id
        and (player.id = v_report.target_id
             or (player.status = 'active' and player.display_name = v_report.content_snapshot->>'playerName'))
    )
    update public.tournament_roster_players player
    set display_name = 'Jugador ' || upper(left(replace(player.id::text, '-', ''), 4)), updated_at = now()
    from targets where targets.id = player.id;
    get diagnostics v_count = row_count;
    v_effects := v_effects || jsonb_build_object('players', v_count);
  elsif v_action in ('take_down_tournament', 'take_down_organization') then
    v_reason := coalesce(v_note, 'Moderación de contenido');
    for v_tournament in
      select tournament.id, tournament.organization_id from public.tournaments tournament
      where tournament.organization_id = v_report.organization_id
        and (v_action = 'take_down_organization' or tournament.id = v_report.tournament_id)
    loop
      insert into private.tournament_moderation_holds (tournament_id, organization_id, report_id, reason)
      values (v_tournament.id, v_tournament.organization_id, v_report.id, v_reason)
      on conflict (tournament_id) do update
        set report_id = excluded.report_id, reason = excluded.reason, created_at = now(), released_at = null;
      -- The column demands an identity: the publisher's. The audit log below says the platform did it.
      update public.tournament_public_pages page
      set status = 'unpublished', unpublished_by = page.published_by, unpublished_at = now(), updated_at = now()
      where page.tournament_id = v_tournament.id and page.status = 'published';
      if exists (select 1 from public.tournament_catalog_listings listing
                 where listing.tournament_id = v_tournament.id and listing.platform_removed_at is null) then
        perform public.platform_remove_tournament_catalog_listing(v_tournament.id,
          left('Moderación: ' || v_reason, 300));
      end if;
    end loop;
    v_effects := v_effects || jsonb_build_object('heldTournaments', (
      select count(*) from private.tournament_moderation_holds hold
      where hold.organization_id = v_report.organization_id and hold.released_at is null));
  elsif v_action = 'release_tournament_hold' then
    update private.tournament_moderation_holds set released_at = now()
    where tournament_id = v_report.tournament_id and released_at is null;
    get diagnostics v_count = row_count;
    v_effects := v_effects || jsonb_build_object('released', v_count);
  elsif v_action = 'clear_organization_logo' then
    update public.tournament_organizations set logo_path = null where id = v_report.organization_id and logo_path is not null;
    get diagnostics v_count = row_count;
    v_effects := v_effects || jsonb_build_object('logos', v_count);
  elsif v_action = 'clear_tournament_logo' then
    update public.tournaments set logo_path = null
    where id = v_report.tournament_id and organization_id = v_report.organization_id and logo_path is not null;
    get diagnostics v_count = row_count;
    v_effects := v_effects || jsonb_build_object('logos', v_count);
  elsif v_action = 'revoke_announcement' then
    -- The same effect as revoke_tournament_announcement (baseline), taken by the platform.
    update public.tournament_announcements
    set status = 'revoked', revoked_at = now(), revoked_reason = left(coalesce(v_note, 'Moderación de contenido'), 500)
    where id = v_report.target_id and organization_id = v_report.organization_id and status = 'published';
    get diagnostics v_count = row_count;
    update public.tournament_announcement_deliveries set status = 'revoked', revoked_at = now()
    where announcement_id = v_report.target_id and organization_id = v_report.organization_id and status <> 'archived';
    v_effects := v_effects || jsonb_build_object('announcements', v_count);
  elsif v_action = 'block_applicant' then
    insert into public.tournament_applicant_blocks (organization_id, blocked_user_id, reason, source_team_entry_id,
      created_by_platform)
    select application.organization_id, application.applicant_user_id, left(coalesce(v_note, 'Moderación de contenido'), 300),
      application.team_entry_id, true
    from public.tournament_team_applications application
    where application.team_entry_id = v_report.target_id and application.organization_id = v_report.organization_id
    on conflict do nothing;
    get diagnostics v_count = row_count;
    v_effects := v_effects || jsonb_build_object('blocks', v_count);
  end if;

  if v_action is not null then
    insert into public.tournament_audit_log (organization_id, actor_user_id, actor_type, action, resource_type, resource_id,
      tournament_id, metadata)
    values (v_report.organization_id, v_actor, case when p_platform then 'system' else 'user' end,
      'moderation.' || v_action, 'content_report', v_report.id, v_report.tournament_id,
      jsonb_build_object('targetKind', v_report.target_kind, 'targetId', v_report.target_id, 'platform', p_platform,
        'effects', v_effects));
    insert into public.tournament_content_report_events (report_id, actor_user_id, actor_type, event, action, note)
    values (v_report.id, v_actor, case when p_platform then 'platform' else 'user' end, 'action', v_action, v_note);
  end if;

  if p_status = 'escalated' then
    update public.tournament_content_reports
    set review_scope = 'platform', escalated_at = now(), status = 'open', updated_at = now()
    where id = v_report.id;
    insert into public.tournament_content_report_events (report_id, actor_user_id, actor_type, event, from_status, to_status, note)
    values (v_report.id, v_actor, 'user', 'escalated', v_report.status, 'open', v_note);
  elsif p_status <> v_report.status then
    update public.tournament_content_reports
    set status = p_status, updated_at = now(),
      action_taken = case when p_status = 'resolved' then v_action end,
      resolution_note = case when p_status in ('resolved', 'dismissed') then v_note end,
      handled_at = case when p_status in ('resolved', 'dismissed') then now() end,
      handled_by = v_actor, handled_by_platform = p_platform
    where id = v_report.id;
    insert into public.tournament_content_report_events (report_id, actor_user_id, actor_type, event, from_status, to_status, note)
    values (v_report.id, v_actor, case when p_platform then 'platform' else 'user' end, 'status_changed', v_report.status,
      p_status, v_note);
  end if;

  select * into v_report from public.tournament_content_reports where id = p_report_id;
  return jsonb_build_object('reportId', v_report.id, 'status', v_report.status, 'reviewScope', v_report.review_scope,
    'actionTaken', v_report.action_taken, 'effects', v_effects);
end;
$$;

-- ============================================================================================ 4. triggers
create function private.tournament_moderation_public_page_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
    and exists (select 1 from private.tournament_moderation_holds hold
                where hold.tournament_id = new.tournament_id and hold.released_at is null) then
    raise exception using errcode = '42501', message = 'TORNEOS_PUBLIC_PAGE_MODERATION_HOLD';
  end if;
  return new;
end;
$$;

create function private.tournament_moderation_application_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.tournament_applicant_blocks block
             where block.organization_id = new.organization_id and block.blocked_user_id = new.applicant_user_id
               and block.released_at is null) then
    raise exception using errcode = '42501', message = 'TORNEOS_APPLICATION_BLOCKED';
  end if;
  return new;
end;
$$;

create function private.tournament_moderation_delivery_mute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'available'
    and exists (select 1 from public.tournament_communication_mutes mute
                where mute.user_id = new.recipient_user_id and mute.organization_id = new.organization_id)
    and not exists (select 1 from public.tournament_announcements announcement
                    where announcement.id = new.announcement_id and announcement.announcement_type = 'emergency') then
    new.status := 'archived';
    new.archived_at := now();
  end if;
  return new;
end;
$$;

create trigger tournament_public_pages_moderation_hold
  before insert or update of status on public.tournament_public_pages
  for each row execute function private.tournament_moderation_public_page_hold();
create trigger tournament_team_applications_moderation_block
  before insert on public.tournament_team_applications
  for each row execute function private.tournament_moderation_application_block();
create trigger tournament_announcement_deliveries_moderation_mute
  before insert on public.tournament_announcement_deliveries
  for each row execute function private.tournament_moderation_delivery_mute();

-- ============================================================================================ 5. RPCs
create function public.report_tournament_content(p_target_kind text, p_public_slug text, p_target_id uuid,
  p_target_label text, p_reason text, p_detail text, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_identity_id();
  v_label text := nullif(btrim(coalesce(p_target_label, '')), '');
  v_detail text := nullif(btrim(coalesce(p_detail, '')), '');
  v_page public.tournament_public_pages%rowtype;
  v_organization_id uuid;
  v_tournament_id uuid;
  v_target_id uuid;
  v_target_label text;
  v_snapshot jsonb;
  v_scope text;
  v_existing public.tournament_content_reports%rowtype;
  v_row public.tournament_content_reports%rowtype;
  v_hour integer;
  v_day integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_target_kind is null or p_target_kind not in (
    'organization', 'tournament', 'catalog_listing', 'announcement', 'team', 'player', 'application') then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_INVALID', detail = 'target_kind';
  end if;
  if p_reason is null or p_reason not in ('offensive', 'impersonation', 'personal_data', 'spam', 'other') then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_INVALID', detail = 'reason';
  end if;
  if v_detail is not null and (char_length(v_detail) not between 3 and 500 or v_detail ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]') then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_INVALID', detail = 'detail';
  end if;
  if v_label is not null and (char_length(v_label) > 200 or v_label ~ '[[:cntrl:]]') then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_INVALID', detail = 'target_label';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_INVALID', detail = 'idempotency_key';
  end if;

  -- One reporter at a time: idempotency, the open-report rule and the rate limit cannot be raced.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tournament_content_reports:' || v_uid::text, 22));
  select * into v_existing from public.tournament_content_reports report
  where report.reporter_user_id = v_uid and report.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.target_kind <> p_target_kind then
      raise exception using errcode = '22023', message = 'TORNEOS_REPORT_INVALID', detail = 'idempotency_key';
    end if;
    return jsonb_build_object('reportId', v_existing.id, 'status', v_existing.status, 'alreadyReported', true,
      'reviewScope', v_existing.review_scope, 'receivedAt', v_existing.created_at);
  end if;

  -- Resolve the target: public content by its public page (slug + the text shown), private content by id with access.
  if p_target_kind in ('organization', 'tournament', 'catalog_listing', 'team', 'player') then
    if p_public_slug is null or char_length(p_public_slug) not between 3 and 96
      or p_public_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$' then
      raise exception using errcode = '22023', message = 'TORNEOS_REPORT_TARGET_INVALID';
    end if;
    select page.* into v_page from public.tournament_public_pages page
    where page.public_slug = p_public_slug and page.status = 'published';
    if v_page.tournament_id is null then
      raise exception using errcode = '22023', message = 'TORNEOS_REPORT_TARGET_INVALID';
    end if;
    v_organization_id := v_page.organization_id;
    v_tournament_id := v_page.tournament_id;
  end if;

  if p_target_kind = 'organization' then
    select organization.id, organization.name, jsonb_build_object('organizationName', organization.name,
        'hasLogo', organization.logo_path is not null)
      into v_target_id, v_target_label, v_snapshot
    from public.tournament_organizations organization where organization.id = v_organization_id;
    v_scope := 'platform';
  elsif p_target_kind = 'tournament' then
    select tournament.id, tournament.name, jsonb_build_object('tournamentName', tournament.name,
        'description', left(tournament.description, 600), 'hasLogo', tournament.logo_path is not null)
      into v_target_id, v_target_label, v_snapshot
    from public.tournaments tournament where tournament.id = v_tournament_id;
    v_scope := 'platform';
  elsif p_target_kind = 'catalog_listing' then
    select listing.tournament_id, tournament.name, jsonb_build_object('tournamentName', tournament.name,
        'summary', listing.summary, 'requirements', left(listing.requirements, 600),
        'rulesSummary', left(listing.rules_summary, 600))
      into v_target_id, v_target_label, v_snapshot
    from public.tournament_catalog_listings listing
    join public.tournaments tournament on tournament.id = listing.tournament_id
    where listing.tournament_id = v_tournament_id and listing.status = 'listed';
    v_scope := 'platform';
  elsif p_target_kind = 'team' then
    if v_label is null then
      raise exception using errcode = '22023', message = 'TORNEOS_REPORT_TARGET_INVALID';
    end if;
    select entry.id, v_label, jsonb_build_object('teamName', v_label, 'shortName', entry.short_name,
        'hasShield', entry.shield_path is not null)
      into v_target_id, v_target_label, v_snapshot
    from public.tournament_team_entries entry
    where entry.tournament_id = v_tournament_id and entry.organization_id = v_organization_id
      and entry.status not in ('draft', 'archived')
      and (entry.name = v_label or exists (
        select 1 from public.tournament_competition_participants participant
        where participant.team_entry_id = entry.id and participant.snapshot_name = v_label))
    order by entry.created_at, entry.id
    limit 1;
    v_scope := 'organization';
  elsif p_target_kind = 'player' then
    if v_label is null then
      raise exception using errcode = '22023', message = 'TORNEOS_REPORT_TARGET_INVALID';
    end if;
    select player.id, player.display_name, jsonb_build_object('playerName', player.display_name, 'teamName', entry.name)
      into v_target_id, v_target_label, v_snapshot
    from public.tournament_roster_players player
    join public.tournament_team_entries entry on entry.id = player.team_entry_id
    where entry.tournament_id = v_tournament_id and entry.organization_id = v_organization_id
      and player.display_name = v_label
    -- Published statistics keep showing a player removed from the roster: still reportable; the active row first.
    order by (player.status = 'active') desc, player.created_at, player.id
    limit 1;
    v_scope := 'organization';
  elsif p_target_kind = 'announcement' then
    -- Only a recipient reports a communication: someone else's announcement is indistinguishable from none.
    select announcement.id, announcement.title, announcement.organization_id, announcement.tournament_id,
        jsonb_build_object('title', announcement.title, 'summary', announcement.summary, 'body', left(announcement.body, 1200))
      into v_target_id, v_target_label, v_organization_id, v_tournament_id, v_snapshot
    from public.tournament_announcements announcement
    where announcement.id = p_target_id
      and exists (select 1 from public.tournament_announcement_deliveries delivery
                  where delivery.announcement_id = announcement.id and delivery.recipient_user_id = v_uid);
    v_scope := 'platform';
  elsif p_target_kind = 'application' then
    -- The organization reports a request it received to Arma2 (the applicant is another user).
    select application.team_entry_id, entry.name, application.organization_id, application.tournament_id,
        jsonb_build_object('teamName', entry.name, 'message', application.message)
      into v_target_id, v_target_label, v_organization_id, v_tournament_id, v_snapshot
    from public.tournament_team_applications application
    join public.tournament_team_entries entry on entry.id = application.team_entry_id
    where application.team_entry_id = p_target_id;
    if v_target_id is not null and not private.tournament_moderation_is_manager(v_organization_id) then
      v_target_id := null;
    end if;
    v_scope := 'platform';
  end if;
  if v_target_id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_TARGET_INVALID';
  end if;

  select * into v_existing from public.tournament_content_reports report
  where report.reporter_user_id = v_uid and report.target_kind = p_target_kind and report.target_id = v_target_id
    and report.status in ('open', 'under_review');
  if found then
    return jsonb_build_object('reportId', v_existing.id, 'status', v_existing.status, 'alreadyReported', true,
      'reviewScope', v_existing.review_scope, 'receivedAt', v_existing.created_at);
  end if;

  select count(*) filter (where report.created_at > now() - interval '1 hour'), count(*)
    into v_hour, v_day
  from public.tournament_content_reports report
  where report.reporter_user_id = v_uid and report.created_at > now() - interval '24 hours';
  if v_hour >= 10 or v_day >= 30 then
    raise exception using errcode = 'PT429', message = 'TORNEOS_REPORT_RATE_LIMITED';
  end if;

  insert into public.tournament_content_reports (organization_id, tournament_id, target_kind, target_id, target_label,
    content_snapshot, review_scope, reporter_user_id, reason, detail, idempotency_key)
  values (v_organization_id, v_tournament_id,
    p_target_kind, v_target_id, left(btrim(regexp_replace(v_target_label, '[[:cntrl:]]', ' ', 'g')), 200),
    v_snapshot, v_scope, v_uid, p_reason, v_detail, p_idempotency_key)
  returning * into v_row;
  insert into public.tournament_content_report_events (report_id, actor_user_id, actor_type, event, to_status)
  values (v_row.id, v_uid, 'user', 'created', 'open');
  return jsonb_build_object('reportId', v_row.id, 'status', v_row.status, 'alreadyReported', false,
    'reviewScope', v_row.review_scope, 'receivedAt', v_row.created_at);
end;
$$;

create function public.get_tournament_content_reports(p_organization_id uuid, p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_blocks jsonb;
begin
  if private.current_identity_id() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_organization_id is null or not private.tournament_moderation_is_manager(p_organization_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_MODERATION_FORBIDDEN';
  end if;
  if p_status is not null and p_status not in ('open', 'under_review', 'resolved', 'dismissed', 'pending') then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_INVALID', detail = 'status';
  end if;
  -- Organization-scope reports of this organization, plus the ones it escalated (read only). Never the reporter.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', report.id, 'targetKind', report.target_kind, 'targetId', report.target_id, 'targetLabel', report.target_label,
      'tournamentId', report.tournament_id, 'tournamentName', tournament.name, 'content', report.content_snapshot,
      'reason', report.reason, 'detail', report.detail, 'status', report.status, 'actionTaken', report.action_taken,
      'resolutionNote', report.resolution_note, 'escalated', report.escalated_at is not null,
      'canHandle', report.review_scope = 'organization' and report.status in ('open', 'under_review'),
      'createdAt', report.created_at, 'handledAt', report.handled_at
    ) order by (report.status in ('open', 'under_review')) desc, report.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select * from public.tournament_content_reports candidate
    where candidate.organization_id = p_organization_id
      and (candidate.review_scope = 'organization' or candidate.escalated_at is not null)
      and (p_status is null
        or (p_status = 'pending' and candidate.status in ('open', 'under_review'))
        or candidate.status = p_status)
    order by candidate.created_at desc
    limit 100
  ) report
  left join public.tournaments tournament on tournament.id = report.tournament_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', block.id, 'teamName', entry.name, 'reason', block.reason, 'createdAt', block.created_at,
      'byPlatform', block.created_by_platform
    ) order by block.created_at desc), '[]'::jsonb)
  into v_blocks
  from public.tournament_applicant_blocks block
  left join public.tournament_team_entries entry on entry.id = block.source_team_entry_id
  where block.organization_id = p_organization_id and block.released_at is null;
  return jsonb_build_object('schemaVersion', 1, 'organizationId', p_organization_id, 'canHandle', true,
    'reports', v_items, 'applicantBlocks', v_blocks);
end;
$$;

create function public.handle_tournament_content_report(p_report_id uuid, p_status text, p_action text default null,
  p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.tournament_content_reports%rowtype;
begin
  if private.current_identity_id() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_report from public.tournament_content_reports report where report.id = p_report_id;
  -- Not a manager of its organization, or a platform report: indistinguishable from a report that does not exist.
  if v_report.id is null or v_report.review_scope <> 'organization'
    or not private.tournament_moderation_is_manager(v_report.organization_id) then
    raise exception using errcode = 'PT409', message = 'TORNEOS_REPORT_NOT_FOUND';
  end if;
  return private.tournament_moderation_handle(p_report_id, p_status, p_action, p_note, false);
end;
$$;

create function public.block_tournament_applicant(p_organization_id uuid, p_team_entry_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_identity_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_applicant uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_organization_id is null or not private.tournament_moderation_is_manager(p_organization_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_MODERATION_FORBIDDEN';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 300 or v_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_INVALID', detail = 'reason';
  end if;
  select application.applicant_user_id into v_applicant
  from public.tournament_team_applications application
  where application.team_entry_id = p_team_entry_id and application.organization_id = p_organization_id;
  if v_applicant is null then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_TARGET_INVALID';
  end if;
  if v_applicant = v_uid then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_TARGET_INVALID';
  end if;
  select block.id into v_id from public.tournament_applicant_blocks block
  where block.organization_id = p_organization_id and block.blocked_user_id = v_applicant and block.released_at is null;
  if v_id is null then
    insert into public.tournament_applicant_blocks (organization_id, blocked_user_id, reason, source_team_entry_id, created_by)
    values (p_organization_id, v_applicant, v_reason, p_team_entry_id, v_uid)
    returning id into v_id;
    insert into public.tournament_audit_log (organization_id, actor_user_id, actor_type, action, resource_type, resource_id,
      team_entry_id, tournament_id, metadata)
    select p_organization_id, v_uid, 'user', 'moderation.block_applicant', 'applicant_block', v_id, entry.id,
      entry.tournament_id, '{}'::jsonb
    from public.tournament_team_entries entry where entry.id = p_team_entry_id;
    return jsonb_build_object('blockId', v_id, 'blocked', true, 'alreadyBlocked', false);
  end if;
  return jsonb_build_object('blockId', v_id, 'blocked', true, 'alreadyBlocked', true);
end;
$$;

create function public.unblock_tournament_applicant(p_organization_id uuid, p_block_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_identity_id();
  v_count integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_organization_id is null or not private.tournament_moderation_is_manager(p_organization_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_MODERATION_FORBIDDEN';
  end if;
  update public.tournament_applicant_blocks
  set released_at = now(), released_by = v_uid
  where id = p_block_id and organization_id = p_organization_id and released_at is null;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception using errcode = 'PT409', message = 'TORNEOS_BLOCK_NOT_FOUND';
  end if;
  insert into public.tournament_audit_log (organization_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata)
  values (p_organization_id, v_uid, 'user', 'moderation.unblock_applicant', 'applicant_block', p_block_id, '{}'::jsonb);
  return jsonb_build_object('blockId', p_block_id, 'blocked', false);
end;
$$;

create function public.set_tournament_communications_muted(p_organization_id uuid, p_announcement_id uuid, p_muted boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_identity_id();
  v_organization_id uuid := p_organization_id;
  v_archived integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_muted is null or (p_organization_id is null) = (p_announcement_id is null) then
    raise exception using errcode = '22023', message = 'TORNEOS_REPORT_INVALID', detail = 'muted';
  end if;
  if p_announcement_id is not null then
    select announcement.organization_id into v_organization_id
    from public.tournament_announcements announcement
    where announcement.id = p_announcement_id;
  end if;
  -- Only an organization that delivered something to the caller (or one already muted) can be muted or unmuted.
  if v_organization_id is null or not (
    exists (select 1 from public.tournament_announcement_deliveries delivery
            where delivery.recipient_user_id = v_uid and delivery.organization_id = v_organization_id)
    or exists (select 1 from public.tournament_communication_mutes mute
               where mute.user_id = v_uid and mute.organization_id = v_organization_id)) then
    raise exception using errcode = '42501', message = 'TORNEOS_COMMUNICATIONS_MUTE_FORBIDDEN';
  end if;
  if p_muted then
    insert into public.tournament_communication_mutes (user_id, organization_id) values (v_uid, v_organization_id)
    on conflict do nothing;
    -- What is already in the inbox goes to the archive too (never an emergency).
    update public.tournament_announcement_deliveries delivery
    set status = 'archived', archived_at = now()
    where delivery.recipient_user_id = v_uid and delivery.organization_id = v_organization_id
      and delivery.status in ('available', 'read', 'confirmed')
      and not exists (select 1 from public.tournament_announcements announcement
                      where announcement.id = delivery.announcement_id and announcement.announcement_type = 'emergency');
    get diagnostics v_archived = row_count;
  else
    delete from public.tournament_communication_mutes where user_id = v_uid and organization_id = v_organization_id;
  end if;
  return jsonb_build_object('organizationId', v_organization_id, 'muted', p_muted, 'archived', v_archived);
end;
$$;

create function public.get_my_tournament_communication_mutes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_identity_id();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  return jsonb_build_object('mutes', coalesce((
    select jsonb_agg(jsonb_build_object('organizationId', mute.organization_id, 'organizationName', organization.name,
      'mutedAt', mute.created_at) order by organization.name)
    from public.tournament_communication_mutes mute
    join public.tournament_organizations organization on organization.id = mute.organization_id
    where mute.user_id = v_uid), '[]'::jsonb));
end;
$$;

-- ============================================================================================ 6. platform (operator only)
create function public.platform_list_tournament_content_reports(p_status text default 'pending', p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_data order by row_data->>'createdAt'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', report.id, 'reviewScope', report.review_scope, 'status', report.status, 'targetKind', report.target_kind,
      'targetId', report.target_id, 'targetLabel', report.target_label, 'organizationId', report.organization_id,
      'organizationName', organization.name, 'tournamentId', report.tournament_id, 'tournamentName', tournament.name,
      'content', report.content_snapshot, 'reason', report.reason, 'detail', report.detail,
      'escalated', report.escalated_at is not null, 'createdAt', report.created_at,
      -- The internal identity of the reporter (never shown to an organization): lets the operator spot abusive reporting.
      'reporterIdentity', report.reporter_user_id,
      'ageHours', round(extract(epoch from now() - report.created_at) / 3600.0, 1)) as row_data
    from public.tournament_content_reports report
    join public.tournament_organizations organization on organization.id = report.organization_id
    left join public.tournaments tournament on tournament.id = report.tournament_id
    where (coalesce(p_status, 'pending') = 'pending' and report.status in ('open', 'under_review'))
       or report.status = p_status
    order by report.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) listed;
$$;

create function public.platform_handle_tournament_content_report(p_report_id uuid, p_status text, p_action text default null,
  p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.tournament_moderation_handle(p_report_id, p_status, p_action, p_note, true);
end;
$$;

-- ============================================================================================ 7. ACL
-- Applied as postgres (the hosted installer), whose default privileges grant EXECUTE on new functions to the API roles:
-- revoked explicitly. Seven RPCs for authenticated; the platform and private functions for nobody.
revoke all on function private.tournament_moderation_is_manager(uuid) from public, anon, authenticated, service_role;
revoke all on function private.tournament_moderation_handle(uuid, text, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function private.tournament_moderation_public_page_hold() from public, anon, authenticated, service_role;
revoke all on function private.tournament_moderation_application_block() from public, anon, authenticated, service_role;
revoke all on function private.tournament_moderation_delivery_mute() from public, anon, authenticated, service_role;
revoke all on function public.report_tournament_content(text, text, uuid, text, text, text, uuid) from public, anon, service_role;
revoke all on function public.get_tournament_content_reports(uuid, text) from public, anon, service_role;
revoke all on function public.handle_tournament_content_report(uuid, text, text, text) from public, anon, service_role;
revoke all on function public.block_tournament_applicant(uuid, uuid, text) from public, anon, service_role;
revoke all on function public.unblock_tournament_applicant(uuid, uuid) from public, anon, service_role;
revoke all on function public.set_tournament_communications_muted(uuid, uuid, boolean) from public, anon, service_role;
revoke all on function public.get_my_tournament_communication_mutes() from public, anon, service_role;
revoke all on function public.platform_list_tournament_content_reports(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.platform_handle_tournament_content_report(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.report_tournament_content(text, text, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.get_tournament_content_reports(uuid, text) to authenticated;
grant execute on function public.handle_tournament_content_report(uuid, text, text, text) to authenticated;
grant execute on function public.block_tournament_applicant(uuid, uuid, text) to authenticated;
grant execute on function public.unblock_tournament_applicant(uuid, uuid) to authenticated;
grant execute on function public.set_tournament_communications_muted(uuid, uuid, boolean) to authenticated;
grant execute on function public.get_my_tournament_communication_mutes() to authenticated;

-- ============================================================================================ 8. postconditions
DO $post$
DECLARE
  v_rpcs constant text[] := array[
    'public.report_tournament_content(text,text,uuid,text,text,text,uuid)',
    'public.get_tournament_content_reports(uuid,text)',
    'public.handle_tournament_content_report(uuid,text,text,text)',
    'public.block_tournament_applicant(uuid,uuid,text)',
    'public.unblock_tournament_applicant(uuid,uuid)',
    'public.set_tournament_communications_muted(uuid,uuid,boolean)',
    'public.get_my_tournament_communication_mutes()'
  ];
  v_closed constant text[] := array[
    'public.platform_list_tournament_content_reports(text,integer)',
    'public.platform_handle_tournament_content_report(uuid,text,text,text)',
    'private.tournament_moderation_is_manager(uuid)',
    'private.tournament_moderation_handle(uuid,text,text,text,boolean)',
    'private.tournament_moderation_public_page_hold()',
    'private.tournament_moderation_application_block()',
    'private.tournament_moderation_delivery_mute()'
  ];
  v_tables constant text[] := array[
    'public.tournament_content_reports', 'public.tournament_content_report_events', 'public.tournament_communication_mutes',
    'public.tournament_applicant_blocks', 'private.tournament_moderation_holds'
  ];
  v_triggers constant text[] := array[
    'tournament_public_pages.tournament_public_pages_moderation_hold',
    'tournament_team_applications.tournament_team_applications_moderation_block',
    'tournament_announcement_deliveries.tournament_announcement_deliveries_moderation_mute'
  ];
  v_problems text[] := array[]::text[];
  v_key text;
  v_before torneos_0022_counts%ROWTYPE;
  v_auth integer;
  v_anon integer;
  v_service integer;
  v_policies text;
  v_row record;
BEGIN
  FOREACH v_key IN ARRAY v_rpcs || v_closed LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_key) AND p.prosecdef
                   AND p.proconfig = array['search_path=""']) THEN
      v_problems := v_problems || format('%s is not SECURITY DEFINER search_path=""', v_key);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               WHERE p.oid = to_regprocedure(v_key) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      OR has_function_privilege('anon', v_key, 'EXECUTE') OR has_function_privilege('service_role', v_key, 'EXECUTE') THEN
      v_problems := v_problems || format('%s is reachable by PUBLIC, anon or service_role', v_key);
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_rpcs LOOP
    IF NOT has_function_privilege('authenticated', v_key, 'EXECUTE') THEN
      v_problems := v_problems || format('%s must be EXECUTE for authenticated', v_key);
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_closed LOOP
    IF has_function_privilege('authenticated', v_key, 'EXECUTE') THEN
      v_problems := v_problems || format('%s must not be reachable by authenticated', v_key);
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_tables LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_key::regclass)
      OR has_table_privilege('anon', v_key, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_table_privilege('authenticated', v_key, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_table_privilege('service_role', v_key, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname || '.' || tablename = v_key) THEN
      v_problems := v_problems || format('%s must have RLS on, no policy and no API grant', v_key);
    END IF;
  END LOOP;
  -- Nothing else moved: every function that existed is identical (body, ACL, owner, attributes) and exactly ours were added.
  FOR v_row IN
    SELECT s.sig, s.state, concat_ws('|', md5(p.prosrc), coalesce(p.proacl::text, '-'), pg_get_userbyid(p.proowner),
           p.prosecdef, p.provolatile, coalesce(p.proconfig::text, '-'), pg_get_function_result(p.oid)) AS now_state
    FROM torneos_0022_functions s LEFT JOIN pg_proc p ON p.oid = to_regprocedure(s.sig)
  LOOP
    IF v_row.now_state IS DISTINCT FROM v_row.state THEN
      v_problems := v_problems || format('%s changed', v_row.sig);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'private'))
     <> (SELECT count(*) FROM torneos_0022_functions) + cardinality(v_rpcs) + cardinality(v_closed) THEN
    v_problems := v_problems || 'the set of functions changed beyond the fourteen added'::text;
  END IF;
  FOR v_row IN
    SELECT n.nspname || '.' || c.relname AS rel,
           concat_ws('|', c.relkind, c.relrowsecurity, coalesce(c.relacl::text, '-'), pg_get_userbyid(c.relowner)) AS now_state,
           r.state
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    FULL JOIN torneos_0022_relations r ON r.rel = n.nspname || '.' || c.relname
    WHERE (n.nspname IN ('public', 'private', 'storage') AND c.relkind IN ('r', 'v', 'm', 'p', 'f', 'S')) OR c.oid IS NULL
  LOOP
    IF NOT (v_row.rel = ANY (v_tables || 'public.tournament_content_report_events_id_seq'::text))
      AND v_row.now_state IS DISTINCT FROM v_row.state THEN
      v_problems := v_problems || format('relation %s changed', coalesce(v_row.rel, '?'));
    END IF;
  END LOOP;
  FOR v_row IN
    SELECT coalesce(s.tg, t.tgrelid::regclass::text || '.' || t.tgname) AS tg, s.state,
           CASE WHEN t.oid IS NULL THEN NULL ELSE concat_ws('|', t.tgenabled, t.tgfoid::regprocedure::text, t.tgtype) END AS now_state
    FROM (SELECT t.* FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'private')) t
    FULL JOIN torneos_0022_triggers s ON s.tg = t.tgrelid::regclass::text || '.' || t.tgname
  LOOP
    IF v_row.state IS NULL THEN
      IF NOT (v_row.tg = ANY (v_triggers)) THEN
        v_problems := v_problems || format('unexpected trigger %s', v_row.tg);
      END IF;
    ELSIF v_row.now_state IS DISTINCT FROM v_row.state THEN
      v_problems := v_problems || format('trigger %s changed', v_row.tg);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
        AND (t.tgrelid::regclass::text || '.' || t.tgname) = ANY (v_triggers)) <> 3 THEN
    v_problems := v_problems || 'the three moderation triggers must exist and be enabled'::text;
  END IF;
  SELECT * INTO v_before FROM torneos_0022_counts;
  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('service_role', p.oid, 'EXECUTE'))
    INTO v_auth, v_anon, v_service
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
  IF v_auth <> v_before.authenticated + 7 OR v_anon <> v_before.anon OR v_service <> v_before.service THEN
    v_problems := v_problems || format('public ACL counts authenticated %s→%s anon %s→%s service_role %s→%s (expected +7 / +0 / +0)',
      v_before.authenticated, v_auth, v_before.anon, v_anon, v_before.service, v_service);
  END IF;
  SELECT md5(coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '-')
           || ':' || coalesce(with_check, '-') || ':' || roles::text, ',' ORDER BY schemaname, tablename, policyname), ''))
    INTO v_policies FROM pg_policies WHERE schemaname IN ('public', 'private', 'storage');
  IF v_policies IS DISTINCT FROM v_before.policies THEN
    v_problems := v_problems || 'policies changed'::text;
  END IF;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'TORNEOS_0022_POSTCONDITION_FAILED: %', array_to_string(v_problems, '; ');
  END IF;
END $post$;

COMMIT;
