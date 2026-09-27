-- ROLLBACK of 00000000000005_officialization_v1.sql — documented, NEVER applied automatically. Not a migration.
--
-- Effect (one transaction, run as the installer role that owns the functions):
--   • the three replaced bodies go back to their certified POST_0004 text (md5 pinned below): validation is
--     strict dual control again for every tournament, the operation context loses its dualControl object, and the Core
--     authorizer loses the organization-invitation branch (the team branch never changed);
--   • the nine OFFICIALIZATION-V1 RPCs are dropped (authenticated EXECUTE count 171 → 162, anon stays 12).
-- Kept on purpose (inert without the RPCs, and deleting them would lose audit/history): the column
-- tournaments.match_result_dual_control_enabled, the table tournament_organization_invitations (RLS on, no
-- client privilege), the owner capability row match_operations.configure_dual_control, every membership
-- created by an accepted invitation (they are legitimate members) and every audit entry.
-- Order with the gateway: roll the gateway back FIRST (its allowlist then stops naming the nine RPCs), then
-- this script.
BEGIN;

DO $pre$
DECLARE
  v_pins text[][] := array[
    array['public.validate_tournament_match_operation(uuid,uuid)', '349c89ce40a0a2ac1223839d20c3437d'],
    array['public.get_tournament_match_operation_context(uuid,uuid)', '86186ea09217d70d2cc113c16f9340fa'],
    array['private.authorize_core_contract(text,jsonb)', '1ac5d5131cd7c3914ad6bda7df30019b']
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_pins, 1) LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(v_pins[i][1])) IS DISTINCT FROM v_pins[i][2] THEN
      RAISE EXCEPTION 'TORNEOS_OFFICIALIZATION_V1_ROLLBACK_PRECONDITION_FAILED: % is not the OFFICIALIZATION-V1 body', v_pins[i][1];
    END IF;
  END LOOP;
END $pre$;

DROP FUNCTION public.set_tournament_match_dual_control(uuid, uuid, boolean);
DROP FUNCTION public.get_tournament_match_dual_control(uuid, uuid);
DROP FUNCTION public.remove_tournament_organization_member(uuid, uuid);
DROP FUNCTION public.update_tournament_organization_member_role(uuid, uuid, text);
DROP FUNCTION public.list_tournament_organization_members(uuid);
DROP FUNCTION public.accept_tournament_organization_invitation(text);
DROP FUNCTION public.revoke_tournament_organization_invitation(uuid, uuid);
DROP FUNCTION public.list_tournament_organization_invitations(uuid);
DROP FUNCTION public.invite_tournament_organization_member(uuid, text, text);

-- Certified POST_0004 bodies (pg_get_functiondef of the certified lab, byte-identical prosrc).
CREATE OR REPLACE FUNCTION public.validate_tournament_match_operation(p_organization_id uuid, p_match_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_operation public.tournament_match_operations%rowtype;
  v_validation jsonb;
begin
  if private.current_identity_id() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_operation.id is null or v_operation.status <> 'under_review'
    or not (public.has_tournament_organization_capability(
      p_organization_id, 'match_operations.validate'
    ) and public.has_tournament_season_access(p_organization_id, (select o.season_id from public.tournament_match_operations o where o.id = p_match_operation_id and o.organization_id = p_organization_id)))
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if v_operation.submitted_by = private.current_identity_id() then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_DUAL_CONTROL_REQUIRED';
  end if;
  v_validation := public.validate_tournament_match_operation_payload(v_operation.id);
  if not (v_validation->>'valid')::boolean then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_OPERATION_INVALID';
  end if;
  update public.tournament_match_operations set
    status = 'validated', validated_by = private.current_identity_id(), validated_at = now(), updated_at = now()
  where id = v_operation.id;
  perform public.append_tournament_audit(
    p_organization_id, 'match_operation.validated', 'match_operation',
    v_operation.id, null, v_operation.tournament_id, '{}'::jsonb
  );
  return public.get_tournament_match_operation_context(p_organization_id, v_operation.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_tournament_match_operation_context(p_organization_id uuid, p_match_operation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when not public.can_read_tournament_match_operation(p_organization_id, operation.match_id)
      then public.raise_tournament_match_error('TORNEOS_MATCH_FORBIDDEN')
    else jsonb_build_object(
      'operation', to_jsonb(operation),
      'outcome', to_jsonb(outcome),
      'score', to_jsonb(score),
      'players', coalesce((
        select jsonb_agg(to_jsonb(player) order by player.team_entry_id, player.lineup_status, player.display_name_snapshot)
        from public.tournament_match_operation_players player
        where player.match_operation_id = operation.id
      ), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(to_jsonb(event) order by event.sequence_number)
        from public.tournament_match_events event
        where event.match_operation_id = operation.id
      ), '[]'::jsonb),
      'reviews', coalesce((
        select jsonb_agg(to_jsonb(review) order by review.requested_at)
        from public.tournament_match_reviews review
        where review.match_operation_id = operation.id
      ), '[]'::jsonb),
      'resumptions', coalesce((
        select jsonb_agg(to_jsonb(resumption) order by resumption.created_at)
        from public.tournament_match_resumptions resumption
        where resumption.match_operation_id = operation.id
      ), '[]'::jsonb)
    )
  end
  from public.tournament_match_operations operation
  left join public.tournament_match_outcomes outcome
    on outcome.match_operation_id = operation.id
  left join public.tournament_match_scores score
    on score.match_operation_id = operation.id
  where operation.id = p_match_operation_id
    and operation.organization_id = p_organization_id;
$function$;

CREATE OR REPLACE FUNCTION private.authorize_core_contract(p_contract text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_identity uuid := private.current_identity_id();
 v_invitation public.tournament_team_invitations%rowtype;
 v_token text;
 v_organization_id uuid;
 v_tournament_id uuid;
 v_category_id uuid;
 v_team_entry_id uuid;
 v_core_team_id uuid;
 v_query text;
 v_limit integer;
 v_request jsonb;
 v_core_request jsonb;
BEGIN
 IF v_identity IS NULL THEN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_AUTH_REQUIRED';
 END IF;
 IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_INVALID_CORE_CONTRACT_REQUEST';
 END IF;
 IF p_contract = 'verified_email' THEN
  v_token := p_request->>'token';
  IF char_length(coalesce(v_token, '')) <> 64 THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_INVITATION_INVALID';
  END IF;
  SELECT * INTO v_invitation FROM public.tournament_team_invitations
  WHERE token_hash = encode(public.digest(v_token, 'sha256'), 'hex');
  IF v_invitation.id IS NULL OR v_invitation.status <> 'pending' THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_INVITATION_INVALID';
  END IF;
  IF v_invitation.expires_at <= now() THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_INVITATION_EXPIRED';
  END IF;
  IF NOT EXISTS (
   SELECT 1
   FROM public.tournament_organizations organization
   JOIN public.tournament_team_entries entry ON entry.organization_id = organization.id
   JOIN public.tournaments tournament
    ON tournament.organization_id = entry.organization_id AND tournament.id = entry.tournament_id
   JOIN public.tournament_categories category
    ON category.organization_id = entry.organization_id
    AND category.tournament_id = entry.tournament_id
    AND category.id = entry.category_id
   WHERE organization.id = v_invitation.organization_id
    AND organization.status = 'active'
    AND entry.id = v_invitation.team_entry_id
    AND entry.status IN ('invited', 'in_progress', 'changes_requested')
    AND tournament.id = v_invitation.tournament_id
    AND tournament.status = 'registration'
    AND (tournament.registration_opens_at IS NULL OR now() >= tournament.registration_opens_at)
    AND (tournament.registration_closes_at IS NULL OR now() <= tournament.registration_closes_at)
    AND category.status = 'active'
  ) OR NOT EXISTS (
   SELECT 1 FROM public.tournament_team_managers manager
   WHERE manager.id = v_invitation.manager_id
    AND manager.organization_id = v_invitation.organization_id
    AND manager.team_entry_id = v_invitation.team_entry_id
    AND manager.status = 'pending'
  ) THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_INVITATION_INVALID';
  END IF;
  v_request := jsonb_build_object('expected_email', v_invitation.email_normalized);
  v_core_request := v_request;
 ELSIF p_contract IN ('directory_players', 'directory_teams') THEN
  v_organization_id := (p_request->>'organization_id')::uuid;
  v_tournament_id := (p_request->>'tournament_id')::uuid;
  v_team_entry_id := (p_request->>'team_entry_id')::uuid;
  v_query := btrim(coalesce(p_request->>'query', ''));
  v_limit := least(greatest(coalesce((p_request->>'limit')::integer, 8), 1), 12);
  IF char_length(v_query) < 2 OR char_length(v_query) > 100 THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
  END IF;
  IF p_contract = 'directory_players' THEN
   IF NOT (
     public.has_tournament_organization_capability(v_organization_id, 'roster_players.read')
     OR (
      v_team_entry_id IS NOT NULL
      AND public.can_edit_tournament_team_entry(v_organization_id, v_team_entry_id)
      AND EXISTS (
       SELECT 1 FROM public.tournament_team_entries entry
       WHERE entry.id = v_team_entry_id
        AND entry.organization_id = v_organization_id
        AND entry.tournament_id = v_tournament_id
      )
     )
    ) OR NOT EXISTS (
     SELECT 1 FROM public.tournaments
     WHERE id = v_tournament_id AND organization_id = v_organization_id AND status <> 'archived'
      AND public.has_tournament_season_access(v_organization_id, season_id)
    )
   THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
   END IF;
   IF (
    SELECT count(*) FROM public.tournament_audit_log audit
    WHERE audit.actor_user_id = v_identity AND audit.action = 'search.players'
     AND audit.created_at > now() - interval '1 minute'
   ) >= 30 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TORNEOS_SEARCH_RATE_LIMITED';
   END IF;
   v_request := jsonb_build_object(
    'organizationId', v_organization_id, 'tournamentId', v_tournament_id,
    'teamEntryId', v_team_entry_id, 'query', v_query, 'limit', v_limit);
   v_core_request := jsonb_build_object('kind', 'players', 'query', v_query, 'limit', v_limit, 'cursor', NULL);
  ELSE
   IF NOT public.has_tournament_organization_capability(v_organization_id, 'team_entries.create')
    OR NOT EXISTS (
     SELECT 1 FROM public.tournaments
     WHERE id = v_tournament_id AND organization_id = v_organization_id AND status = 'registration'
      AND public.has_tournament_season_access(v_organization_id, season_id)
    )
   THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
   END IF;
   IF (
    SELECT count(*) FROM public.tournament_audit_log audit
    WHERE audit.actor_user_id = v_identity AND audit.action = 'search.teams'
     AND audit.created_at > now() - interval '1 minute'
   ) >= 30 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TORNEOS_SEARCH_RATE_LIMITED';
   END IF;
   v_request := jsonb_build_object(
    'organizationId', v_organization_id, 'tournamentId', v_tournament_id, 'query', v_query, 'limit', v_limit);
   v_core_request := jsonb_build_object('kind', 'teams', 'query', v_query, 'limit', v_limit, 'cursor', NULL);
  END IF;
 ELSIF p_contract = 'team_snapshot' THEN
  v_organization_id := (p_request->>'organization_id')::uuid;
  v_tournament_id := (p_request->>'tournament_id')::uuid;
  v_category_id := (p_request->>'category_id')::uuid;
  v_core_team_id := (p_request->>'core_team_id')::uuid;
  IF v_core_team_id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_INVALID_TEAM_ENTRY';
  END IF;
  IF NOT public.has_tournament_organization_capability(v_organization_id, 'team_entries.create') THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
   SELECT 1 FROM public.tournaments scoped_tournament
   WHERE scoped_tournament.id = v_tournament_id
    AND scoped_tournament.organization_id = v_organization_id
    AND public.has_tournament_season_access(v_organization_id, scoped_tournament.season_id)
  ) THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_RESOURCE_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
   SELECT 1 FROM public.tournaments tournament
   JOIN public.tournament_categories category
    ON category.tournament_id = tournament.id AND category.organization_id = tournament.organization_id
   WHERE tournament.id = v_tournament_id AND tournament.organization_id = v_organization_id
    AND tournament.status = 'registration' AND tournament.archived_at IS NULL
    AND (tournament.registration_opens_at IS NULL OR now() >= tournament.registration_opens_at)
    AND (tournament.registration_closes_at IS NULL OR now() <= tournament.registration_closes_at)
    AND category.id = v_category_id AND category.status = 'active'
  ) THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_REGISTRATION_CLOSED';
  END IF;
  v_request := jsonb_build_object(
   'organizationId', v_organization_id, 'tournamentId', v_tournament_id,
   'categoryId', v_category_id, 'coreTeamId', v_core_team_id);
  v_core_request := jsonb_build_object('core_team_id', v_core_team_id);
 ELSE
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_INVALID_CORE_CONTRACT';
 END IF;
 RETURN jsonb_build_object(
  'contract', p_contract,
  'identity_id', v_identity,
  'core_request', v_core_request,
  'request_hash', private.core_contract_request_hash(p_contract, v_request)
 );
EXCEPTION WHEN invalid_text_representation THEN
 RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_INVALID_CORE_CONTRACT_REQUEST';
END $function$;

DO $post$
DECLARE
  v_pins text[][] := array[
    array['public.validate_tournament_match_operation(uuid,uuid)', '4f43a7292753cbd191c9800dac08ed58'],
    array['public.get_tournament_match_operation_context(uuid,uuid)', '2f43290e706d0471f91a4baf67f400c5'],
    array['private.authorize_core_contract(text,jsonb)', '488ca6bb0491e7ae9921091a90f30b65']
  ];
  v_new text[] := array[
    'public.invite_tournament_organization_member(uuid,text,text)',
    'public.list_tournament_organization_invitations(uuid)',
    'public.revoke_tournament_organization_invitation(uuid,uuid)',
    'public.accept_tournament_organization_invitation(text)',
    'public.list_tournament_organization_members(uuid)',
    'public.update_tournament_organization_member_role(uuid,uuid,text)',
    'public.remove_tournament_organization_member(uuid,uuid)',
    'public.get_tournament_match_dual_control(uuid,uuid)',
    'public.set_tournament_match_dual_control(uuid,uuid,boolean)'
  ];
  v_fn text;
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_pins, 1) LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(v_pins[i][1])) IS DISTINCT FROM v_pins[i][2] THEN
      RAISE EXCEPTION 'TORNEOS_OFFICIALIZATION_V1_ROLLBACK_POSTCONDITION_FAILED: % body', v_pins[i][1];
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY v_new LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      RAISE EXCEPTION 'TORNEOS_OFFICIALIZATION_V1_ROLLBACK_POSTCONDITION_FAILED: % still exists', v_fn;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'private.authorize_core_contract(text,jsonb)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege('torneos_core_adapter', 'private.authorize_core_contract(text,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'TORNEOS_OFFICIALIZATION_V1_ROLLBACK_POSTCONDITION_FAILED: authorizer ACL';
  END IF;
END $post$;

COMMIT;
