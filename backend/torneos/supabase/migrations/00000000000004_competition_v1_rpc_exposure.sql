-- Arma2 Torneos — COMPETITION-V1: client exposure of the full-competition contract. Applies after
-- 00000000000000_torneos_baseline_v1.sql, 00000000000001_staging_v1_rpc_exposure.sql (unchanged),
-- 00000000000002_mercadopago_checkout_pro_test.sql and 00000000000003_mercadopago_provider_ordering.sql.
--
-- 00000000000001 revoked EXECUTE from anon/authenticated on 32 SECURITY DEFINER RPCs (+1 parent) whose
-- features were OFF in staging v1 and demanded "its fixture/test certification and an explicit GRANT
-- migration after this one" to come back. COMPETITION-V1 certifies (backend/torneos/competition-v1) the
-- competition journeys of the product — fixture, draw, scheduling, match squads, match reports (actas),
-- review / validation / officialization / correction, standings and qualification — and this migration is
-- that explicit GRANT, for exactly the 15 of those RPCs a real journey of the frontend calls:
--
--   fixtures (6)          reopen_tournament_participants, save_tournament_draw_pots, update_draft_fixture,
--                         publish_tournament_fixture, supersede_tournament_fixture, schedule_tournament_match
--                         + auto_schedule_tournament_matches (the parent path 0001 closed)
--   match operations (7)  submit_match_squad, void_tournament_match_event, review_tournament_match_operation,
--                         validate_tournament_match_operation, make_tournament_match_official,
--                         request_tournament_match_correction, create_tournament_match_correction
--   standings (1)         resolve_tournament_qualification
--
-- Season fix (before any GRANT): update_draft_fixture authorized the organization capability through a CASE
-- expression that the Phase 2B season-scope generator did not match — the same class as the Phase 2D P0 — so
-- an admin seated only on another season of the organization could edit this season's draft fixture. The
-- function is replaced with its certified baseline body plus has_tournament_season_access(org, the version's
-- season); nothing else in it changes (body md5 390a1e4c… → 53fd2b4b…, both pinned below).
--
-- Guard-order fix (in the same transaction, before the contract goes live): publish_tournament_document_version
-- answered its idempotent "already published" result — {documentId, versionId, status} — to ANY bearer before
-- checking documents.publish and the season: a cross-workspace oracle found by the COMPETITION-V1 negative
-- matrix. The function is replaced with the same body where authorization runs first (no row lock for an
-- unauthorized caller); authorized behaviour, codes and messages are unchanged (md5 1000277b… → 6830b726…).
--
-- Only `authenticated` gains EXECUTE; anon gains nothing; service_role keeps what it had and gains nothing;
-- PUBLIC, torneos_core_adapter, torneos_identity_writer and torneos_payment_service never get these. Every
-- function keeps its own guard (bridge identity → organization capability → season access), which the
-- certification exercises positively (owner / season admin) and negatively (collaborator, participant,
-- unassigned-season admin, other workspace, anon).
--
-- NOT granted (they stay exactly as 0001 left them: no anon, no authenticated): the 17 other gated RPCs
-- of features that remain OFF — media pipeline, player portraits, team photos, social export, purchases /
-- entitlements (get_tournament_purchase is MP-A2's and untouched here), manual availability, roster lock,
-- points adjustments, disciplinary overrides and suspension bookkeeping. The service-only competition RPCs
-- of the baseline (archive_tournament_fixture, postpone/cancel/restore/ready_tournament_match,
-- schedule_tournament_match_resumption) stay service-only: no client journey ever reached them.
--
-- Fail-closed: the preconditions accept the certified 0000 + 0001 (+0002/0003) ACL state or the state this
-- migration leaves (re-apply is a no-op); anything else aborts with TORNEOS_COMPETITION_V1_PRECONDITION_FAILED
-- before any change. Postconditions re-verify the exact ACL delta inside the same transaction.
-- Rollback (documented, never applied automatically): backend/torneos/competition-v1/rollback/
-- 00000000000004_competition_v1_rpc_exposure.rollback.sql.
BEGIN;

CREATE TEMPORARY TABLE torneos_competition_v1_acl (
  phase text PRIMARY KEY,
  authenticated_public integer NOT NULL,
  anon_public integer NOT NULL,
  newly_granted integer NOT NULL
) ON COMMIT DROP;

DO $pre$
DECLARE
  v_grant text[] := array[
    'public.reopen_tournament_participants(uuid,uuid,uuid,text)',
    'public.save_tournament_draw_pots(uuid,uuid,uuid,jsonb)',
    'public.update_draft_fixture(uuid,uuid,text,jsonb)',
    'public.publish_tournament_fixture(uuid,uuid)',
    'public.supersede_tournament_fixture(uuid,uuid,uuid)',
    'public.schedule_tournament_match(uuid,uuid,timestamp with time zone,uuid,uuid,integer,boolean,text)',
    'public.auto_schedule_tournament_matches(uuid,uuid)',
    'public.submit_match_squad(uuid,uuid,uuid)',
    'public.void_tournament_match_event(uuid,uuid,text)',
    'public.review_tournament_match_operation(uuid,uuid,text,text)',
    'public.validate_tournament_match_operation(uuid,uuid)',
    'public.make_tournament_match_official(uuid,uuid)',
    'public.request_tournament_match_correction(uuid,uuid,text)',
    'public.create_tournament_match_correction(uuid,uuid)',
    'public.resolve_tournament_qualification(uuid,text)'
  ];
  v_kept text[] := array[
    'public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)',
    'public.cancel_tournament_purchase(uuid)',
    'public.change_tournament_media_gallery_state(uuid,text,text)',
    'public.create_tournament_disciplinary_override(uuid,text,integer,text,uuid)',
    'public.create_tournament_points_adjustment(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)',
    'public.get_tournament_player_portrait_ref(uuid,uuid,text)',
    'public.has_tournament_entitlement(uuid,uuid,text)',
    'public.lock_tournament_roster(uuid,uuid,uuid)',
    'public.mark_tournament_suspension_served(uuid,uuid,text)',
    'public.record_manual_match_availability(uuid,uuid,uuid,text,text,text)',
    'public.report_tournament_media_asset(uuid,text,text,boolean,uuid)',
    'public.revoke_tournament_player_portrait_publication(uuid,uuid)',
    'public.revoke_tournament_points_adjustment(uuid,text)',
    'public.revoke_tournament_team_photo(uuid,uuid)',
    'public.set_tournament_player_portrait_crop(uuid,uuid,numeric,numeric,numeric)',
    'public.set_tournament_player_portrait_editorial_status(uuid,uuid,text)',
    'public.transition_tournament_media_asset(uuid,text,text)'
  ];
  v_system text[] := array[
    'public.archive_tournament_fixture(uuid,uuid,text)',
    'public.postpone_tournament_match(uuid,uuid,text)',
    'public.cancel_tournament_match(uuid,uuid,text)',
    'public.restore_tournament_match_unscheduled(uuid,uuid,text)',
    'public.ready_tournament_match(uuid,uuid)',
    'public.schedule_tournament_match_resumption(uuid,uuid,timestamp with time zone,uuid,uuid,text)'
  ];
  v_server_roles text[] := array['torneos_core_adapter', 'torneos_identity_writer', 'torneos_payment_service'];
  v_problems text[] := array[]::text[];
  v_fn text;
  v_role text;
  v_oid oid;
  v_newly integer := 0;
BEGIN
  FOREACH v_fn IN ARRAY v_grant || v_kept || v_system LOOP
    IF to_regprocedure(v_fn) IS NULL THEN v_problems := v_problems || ('missing ' || v_fn); END IF;
  END LOOP;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'TORNEOS_COMPETITION_V1_PRECONDITION_FAILED: %', array_to_string(v_problems, '; ');
  END IF;
  FOREACH v_fn IN ARRAY v_grant LOOP
    v_oid := to_regprocedure(v_fn);
    IF NOT (SELECT p.prosecdef AND p.proconfig @> array['search_path=""'] FROM pg_proc p WHERE p.oid = v_oid) THEN
      v_problems := v_problems || ('not a pinned SECURITY DEFINER ' || v_fn);
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN v_problems := v_problems || ('anon executes ' || v_fn); END IF;
    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN v_problems := v_problems || ('service_role lacks ' || v_fn); END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      v_problems := v_problems || ('PUBLIC executes ' || v_fn);
    END IF;
    FOREACH v_role IN ARRAY v_server_roles LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) AND has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
        v_problems := v_problems || (v_role || ' executes ' || v_fn);
      END IF;
    END LOOP;
    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN v_newly := v_newly + 1; END IF;
  END LOOP;
  -- 0001 must be in force: every function this migration does NOT grant is still closed to the client roles.
  FOREACH v_fn IN ARRAY v_kept || v_system LOOP
    v_oid := to_regprocedure(v_fn);
    IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_problems := v_problems || ('client role executes ' || v_fn);
    END IF;
  END LOOP;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'TORNEOS_COMPETITION_V1_PRECONDITION_FAILED: %', array_to_string(v_problems, '; ');
  END IF;
  INSERT INTO torneos_competition_v1_acl
  SELECT 'before',
    count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')),
    v_newly
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
END $pre$;

-- ============================================================================ season fix: update_draft_fixture
DO $fixpre$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.update_draft_fixture(uuid,uuid,text,jsonb)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '390a1e4cae6af1973ead63563a71b08f' AND v_md5 IS DISTINCT FROM '53fd2b4bc95a86434c7e5b8e1e938275' THEN
    RAISE EXCEPTION 'TORNEOS_COMPETITION_V1_PRECONDITION_FAILED: update_draft_fixture body is neither the certified baseline nor the COMPETITION-V1 body';
  END IF;
END $fixpre$;

CREATE OR REPLACE FUNCTION public.update_draft_fixture(p_organization_id uuid, p_fixture_version_id uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_version public.tournament_fixture_versions%rowtype;
  v_phase public.tournament_phases%rowtype;
  v_round public.tournament_rounds%rowtype;
  v_match public.tournament_matches%rowtype;
  v_id uuid;
  v_number integer;
begin
  if private.current_identity_id() is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select version.* into v_version
  from public.tournament_fixture_versions version
  join public.tournament_organizations organization
    on organization.id = version.organization_id and organization.status = 'active'
  join public.tournaments tournament
    on tournament.id = version.tournament_id and tournament.status <> 'archived'
  join public.tournament_categories category
    on category.id = version.category_id and category.status = 'active'
  where version.id = p_fixture_version_id
    and version.organization_id = p_organization_id
    and version.status = 'draft'
  for update of version;
  -- COMPETITION-V1: the capability argument is a CASE expression, which the Phase 2B season-scope generator
  -- did not match (the class of the Phase 2D P0); authority over this draft now also requires the actor's
  -- access to the fixture version's season, like every other fixture RPC.
  if v_version.id is null or not (public.has_tournament_organization_capability(
    p_organization_id,
    case
      when p_action = 'create_match' then 'matches.create'
      when p_action in ('create_round', 'lock_round') then 'rounds.manage'
      else 'fixture.update_draft'
    end
  ) and public.has_tournament_season_access(p_organization_id, v_version.season_id)) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if p_action = 'create_phase' then
    select coalesce(max(phase.sequence_number), 0) + 1 into v_number
    from public.tournament_phases phase where phase.fixture_version_id = v_version.id;
    insert into public.tournament_phases (
      organization_id, tournament_id, category_id, fixture_version_id,
      name, phase_type, sequence_number, status, configuration
    ) values (
      v_version.organization_id, v_version.tournament_id, v_version.category_id,
      v_version.id, btrim(p_payload->>'name'), p_payload->>'phaseType',
      coalesce((p_payload->>'sequenceNumber')::integer, v_number),
      'draft', coalesce(p_payload->'configuration', '{}'::jsonb)
    ) returning id into v_id;
  elsif p_action = 'create_round' then
    select phase.* into v_phase from public.tournament_phases phase
    where phase.id = (p_payload->>'phaseId')::uuid
      and phase.fixture_version_id = v_version.id;
    if v_phase.id is null then
      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
    end if;
    select coalesce(max(round_row.round_number), 0) + 1 into v_number
    from public.tournament_rounds round_row
    where round_row.phase_id = v_phase.id
      and round_row.group_id is not distinct from nullif(p_payload->>'groupId', '')::uuid;
    if nullif(p_payload->>'groupId', '') is not null and not exists (
      select 1
      from public.tournament_groups group_row
      where group_row.id = (p_payload->>'groupId')::uuid
        and group_row.fixture_version_id = v_version.id
        and group_row.phase_id = v_phase.id
        and group_row.participant_set_id = v_version.participant_set_id
        and group_row.status <> 'archived'
    ) then
      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
    end if;
    insert into public.tournament_rounds (
      organization_id, tournament_id, category_id, fixture_version_id,
      phase_id, group_id, round_number, name, status, sort_order
    ) values (
      v_version.organization_id, v_version.tournament_id, v_version.category_id,
      v_version.id, v_phase.id, nullif(p_payload->>'groupId', '')::uuid,
      coalesce((p_payload->>'roundNumber')::integer, v_number),
      btrim(p_payload->>'name'), 'draft',
      coalesce((p_payload->>'sortOrder')::integer, v_number - 1)
    ) returning id into v_id;
  elsif p_action = 'create_match' then
    select round_row.* into v_round from public.tournament_rounds round_row
    where round_row.id = (p_payload->>'roundId')::uuid
      and round_row.fixture_version_id = v_version.id;
    if v_round.id is null then
      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
    end if;
    select coalesce(max(match_row.match_number), 0) + 1 into v_number
    from public.tournament_matches match_row
    where match_row.fixture_version_id = v_version.id;
    insert into public.tournament_matches (
      organization_id, season_id, tournament_id, category_id,
      participant_set_id, fixture_version_id, phase_id, group_id, round_id,
      match_number, home_participant_id, away_participant_id, status,
      duration_minutes, created_by
    ) values (
      v_version.organization_id, v_version.season_id, v_version.tournament_id,
      v_version.category_id, v_version.participant_set_id, v_version.id,
      v_round.phase_id, v_round.group_id, v_round.id,
      coalesce((p_payload->>'matchNumber')::integer, v_number),
      nullif(p_payload->>'homeParticipantId', '')::uuid,
      nullif(p_payload->>'awayParticipantId', '')::uuid,
      'unscheduled', coalesce((p_payload->>'durationMinutes')::integer, 60),
      private.current_identity_id()
    ) returning id into v_id;
    perform public.insert_tournament_match_source(
      v_id, 'home', coalesce(
        p_payload->'homeSource',
        jsonb_build_object('type', 'participant', 'participantId', p_payload->>'homeParticipantId')
      )
    );
    perform public.insert_tournament_match_source(
      v_id, 'away', coalesce(
        p_payload->'awaySource',
        jsonb_build_object('type', 'participant', 'participantId', p_payload->>'awayParticipantId')
      )
    );
  elsif p_action = 'delete_match' then
    select match_row.* into v_match
    from public.tournament_matches match_row
    where match_row.id = (p_payload->>'matchId')::uuid
      and match_row.fixture_version_id = v_version.id
    for update;
    if v_match.id is null or exists (
      select 1 from public.tournament_match_sources source
      where source.source_match_id = v_match.id
    ) then
      raise exception using errcode = '23514', message = 'TORNEOS_MATCH_HAS_DEPENDENCIES';
    end if;
    delete from public.tournament_match_sources where match_id = v_match.id;
    delete from public.tournament_matches where id = v_match.id;
    v_id := v_match.id;
  elsif p_action = 'lock_round' then
    update public.tournament_rounds
    set status = 'locked', locked_at = now()
    where id = (p_payload->>'roundId')::uuid
      and fixture_version_id = v_version.id
      and status in ('draft', 'scheduled')
      and exists (
        select 1 from public.tournament_matches match_row
        where match_row.round_id = tournament_rounds.id
          and match_row.status <> 'cancelled'
      )
      and not exists (
        select 1 from public.tournament_matches match_row
        where match_row.round_id = tournament_rounds.id
          and match_row.status not in ('scheduled', 'postponed', 'ready', 'cancelled')
      )
    returning id into v_id;
    if v_id is null then
      raise exception using errcode = '23514', message = 'TORNEOS_INVALID_ROUND_TRANSITION';
    end if;
  else
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_FIXTURE_ACTION';
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'fixture.draft_updated', 'fixture_version', v_version.id,
    null, v_version.tournament_id,
    jsonb_build_object('action', p_action, 'resourceId', v_id)
  );
  return jsonb_build_object('fixtureVersionId', v_version.id, 'resourceId', v_id, 'action', p_action);
end;
$function$;

DO $fixpost$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.update_draft_fixture(uuid,uuid,text,jsonb)'::regprocedure
      AND md5(p.prosrc) = '53fd2b4bc95a86434c7e5b8e1e938275' AND p.prosecdef AND p.proconfig @> array['search_path=""']) THEN
    RAISE EXCEPTION 'TORNEOS_COMPETITION_V1_POSTCONDITION_FAILED: update_draft_fixture season fix';
  END IF;
END $fixpost$;

-- ============================================================================ guard-order fix: publish_tournament_document_version
DO $docpre$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.publish_tournament_document_version(uuid)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '1000277b885896c3311b04ad960cf4b9' AND v_md5 IS DISTINCT FROM '6830b726fc3aa23342ab7fed2b1d5348' THEN
    RAISE EXCEPTION 'TORNEOS_COMPETITION_V1_PRECONDITION_FAILED: publish_tournament_document_version body is neither the certified baseline nor the COMPETITION-V1 body';
  END IF;
END $docpre$;

CREATE OR REPLACE FUNCTION public.publish_tournament_document_version(p_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_version public.tournament_document_versions%rowtype;
  v_document public.tournament_documents%rowtype;
begin
  if private.current_identity_id() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  -- COMPETITION-V1: authorization BEFORE the idempotent answer. The baseline returned {documentId, versionId,
  -- status} for an already published version to any bearer, before checking documents.publish and the season:
  -- a cross-workspace oracle. Unauthorized callers now get TORNEOS_DOCUMENT_FORBIDDEN without locking any row.
  select * into v_version
  from public.tournament_document_versions version
  where version.id = p_version_id;
  if v_version.id is null
    or not (public.has_tournament_communications_capability(
      v_version.organization_id,'documents.publish'
    ) and public.has_tournament_season_access(v_version.organization_id, (select d.season_id from public.tournament_documents d where d.id = v_version.document_id)))
  then
    raise exception using errcode = '42501', message = 'TORNEOS_DOCUMENT_FORBIDDEN';
  end if;
  select * into v_version
  from public.tournament_document_versions version
  where version.id = p_version_id
  for update;
  if v_version.status = 'published' then
    return jsonb_build_object(
      'documentId',v_version.document_id,'versionId',v_version.id,'status','published'
    );
  end if;
  select * into v_document
  from public.tournament_documents document
  where document.id = v_version.document_id
  for update;
  if v_version.status <> 'draft' or v_document.status = 'archived' then
    raise exception using errcode = '42501', message = 'TORNEOS_DOCUMENT_FORBIDDEN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_document.id::text,733));
  update public.tournament_document_versions
  set status = 'superseded',superseded_at = now()
  where document_id = v_document.id and status = 'published';
  update public.tournament_document_versions
  set status = 'published',published_by = private.current_identity_id(),published_at = now()
  where id = p_version_id;
  update public.tournament_documents
  set status = 'published',active_version_id = p_version_id
  where id = v_document.id;
  perform public.append_tournament_audit(
    v_document.organization_id,'communications.document_publish','tournament_document',
    v_document.id,null,v_document.tournament_id,
    jsonb_build_object('versionId',p_version_id,'version',v_version.version)
  );
  return jsonb_build_object(
    'documentId',v_document.id,'versionId',p_version_id,'status','published'
  );
end;
$function$;

DO $docpost$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.publish_tournament_document_version(uuid)'::regprocedure
      AND md5(p.prosrc) = '6830b726fc3aa23342ab7fed2b1d5348' AND p.prosecdef AND p.proconfig @> array['search_path=""']
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'TORNEOS_COMPETITION_V1_POSTCONDITION_FAILED: publish_tournament_document_version guard-order fix';
  END IF;
END $docpost$;

-- ============================================================================ the 15 GRANTs
GRANT EXECUTE ON FUNCTION public.reopen_tournament_participants(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_tournament_draw_pots(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_pots jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_draft_fixture(p_organization_id uuid, p_fixture_version_id uuid, p_action text, p_payload jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_tournament_fixture(p_organization_id uuid, p_fixture_version_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_tournament_fixture(p_organization_id uuid, p_fixture_version_id uuid, p_idempotency_key uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_tournament_match(p_organization_id uuid, p_match_id uuid, p_scheduled_at timestamp with time zone, p_venue_id uuid, p_court_id uuid, p_duration_minutes integer, p_override_warnings boolean, p_override_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_schedule_tournament_matches(p_organization_id uuid, p_fixture_version_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_match_squad(p_organization_id uuid, p_match_id uuid, p_team_entry_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_tournament_match_event(p_organization_id uuid, p_event_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_tournament_match_operation(p_organization_id uuid, p_match_operation_id uuid, p_decision text, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_tournament_match_operation(p_organization_id uuid, p_match_operation_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.make_tournament_match_official(p_organization_id uuid, p_match_operation_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_tournament_match_correction(p_organization_id uuid, p_match_operation_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tournament_match_correction(p_organization_id uuid, p_match_operation_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_tournament_qualification(p_revision_id uuid, p_reason text) TO authenticated;

DO $post$
DECLARE
  v_grant text[] := array[
    'public.reopen_tournament_participants(uuid,uuid,uuid,text)',
    'public.save_tournament_draw_pots(uuid,uuid,uuid,jsonb)',
    'public.update_draft_fixture(uuid,uuid,text,jsonb)',
    'public.publish_tournament_fixture(uuid,uuid)',
    'public.supersede_tournament_fixture(uuid,uuid,uuid)',
    'public.schedule_tournament_match(uuid,uuid,timestamp with time zone,uuid,uuid,integer,boolean,text)',
    'public.auto_schedule_tournament_matches(uuid,uuid)',
    'public.submit_match_squad(uuid,uuid,uuid)',
    'public.void_tournament_match_event(uuid,uuid,text)',
    'public.review_tournament_match_operation(uuid,uuid,text,text)',
    'public.validate_tournament_match_operation(uuid,uuid)',
    'public.make_tournament_match_official(uuid,uuid)',
    'public.request_tournament_match_correction(uuid,uuid,text)',
    'public.create_tournament_match_correction(uuid,uuid)',
    'public.resolve_tournament_qualification(uuid,text)'
  ];
  v_closed text[] := array[
    'public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)',
    'public.cancel_tournament_purchase(uuid)',
    'public.change_tournament_media_gallery_state(uuid,text,text)',
    'public.create_tournament_disciplinary_override(uuid,text,integer,text,uuid)',
    'public.create_tournament_points_adjustment(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)',
    'public.get_tournament_player_portrait_ref(uuid,uuid,text)',
    'public.has_tournament_entitlement(uuid,uuid,text)',
    'public.lock_tournament_roster(uuid,uuid,uuid)',
    'public.mark_tournament_suspension_served(uuid,uuid,text)',
    'public.record_manual_match_availability(uuid,uuid,uuid,text,text,text)',
    'public.report_tournament_media_asset(uuid,text,text,boolean,uuid)',
    'public.revoke_tournament_player_portrait_publication(uuid,uuid)',
    'public.revoke_tournament_points_adjustment(uuid,text)',
    'public.revoke_tournament_team_photo(uuid,uuid)',
    'public.set_tournament_player_portrait_crop(uuid,uuid,numeric,numeric,numeric)',
    'public.set_tournament_player_portrait_editorial_status(uuid,uuid,text)',
    'public.transition_tournament_media_asset(uuid,text,text)',
    'public.archive_tournament_fixture(uuid,uuid,text)',
    'public.postpone_tournament_match(uuid,uuid,text)',
    'public.cancel_tournament_match(uuid,uuid,text)',
    'public.restore_tournament_match_unscheduled(uuid,uuid,text)',
    'public.ready_tournament_match(uuid,uuid)',
    'public.schedule_tournament_match_resumption(uuid,uuid,timestamp with time zone,uuid,uuid,text)'
  ];
  v_server_roles text[] := array['torneos_core_adapter', 'torneos_identity_writer', 'torneos_payment_service'];
  v_problems text[] := array[]::text[];
  v_fn text;
  v_role text;
  v_oid oid;
  v_before torneos_competition_v1_acl%rowtype;
  v_auth integer;
  v_anon integer;
BEGIN
  FOREACH v_fn IN ARRAY v_grant LOOP
    v_oid := to_regprocedure(v_fn);
    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN v_problems := v_problems || ('authenticated lacks ' || v_fn); END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN v_problems := v_problems || ('anon executes ' || v_fn); END IF;
    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN v_problems := v_problems || ('service_role lacks ' || v_fn); END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      v_problems := v_problems || ('PUBLIC executes ' || v_fn);
    END IF;
    FOREACH v_role IN ARRAY v_server_roles LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) AND has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
        v_problems := v_problems || (v_role || ' executes ' || v_fn);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_fn IN ARRAY v_closed LOOP
    v_oid := to_regprocedure(v_fn);
    IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_problems := v_problems || ('client role executes ' || v_fn);
    END IF;
  END LOOP;
  SELECT * INTO v_before FROM torneos_competition_v1_acl WHERE phase = 'before';
  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))
    INTO v_auth, v_anon
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
  -- Exactly the delta: the functions of the grant set that were closed, nothing else, and anon unchanged.
  IF v_auth <> v_before.authenticated_public + v_before.newly_granted THEN
    v_problems := v_problems || format('authenticated delta %s, expected %s', v_auth - v_before.authenticated_public, v_before.newly_granted);
  END IF;
  IF v_anon <> v_before.anon_public THEN
    v_problems := v_problems || format('anon changed %s -> %s', v_before.anon_public, v_anon);
  END IF;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'TORNEOS_COMPETITION_V1_POSTCONDITION_FAILED: %', array_to_string(v_problems, '; ');
  END IF;
END $post$;

COMMIT;
