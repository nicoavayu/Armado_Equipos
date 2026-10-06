-- CONNECTED-V1 0011 — a team's own responsible can search Arma2 players for its roster on the isolated composition.
--
-- Found in the promotion rehearsal (hybrid lab, real gateway): an applicant who is the captain of a registration request
-- but not a member of the organization got TORNEOS_RESOURCE_FORBIDDEN from «Buscar jugador de Arma2». The certified bodies
-- of public.search_tournament_players (baseline) and private.authorize_core_contract (0005, directory_players branch) let a
-- team entry's editor search, but their Phase 2D season guard (has_tournament_season_access = active organization member)
-- wrapped BOTH paths. Every other roster RPC the captain uses (add / create provisional / update / remove / submit) only
-- asks can_edit_tournament_team_entry; the LOCAL composition never had the guard on this path.
--
-- The change, identical in both bodies and nothing else: the season guard now applies to the organization path only
-- (members still need access to the tournament's season); the team entry path requires the entry to belong to that
-- tournament and the tournament not to be archived — what the season clause also checked. Grants are untouched
-- (CREATE OR REPLACE keeps them; the post-check proves it). Each body is pinned by md5(prosrc) before and after; any
-- other state aborts. Rollback: backend/torneos/connected-v1/rollback/00000000000011_connected_roster_search.rollback.sql
-- restores both certified bodies byte for byte.
BEGIN;

DO $guard$
DECLARE
  v_search text := (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.search_tournament_players(uuid,uuid,text,integer,uuid)'::regprocedure);
  v_auth text := (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.authorize_core_contract(text,jsonb)'::regprocedure);
BEGIN
  IF v_search IS DISTINCT FROM '194194571ffb20bd1946ab638ecac8e2' OR v_auth IS DISTINCT FROM '1ac5d5131cd7c3914ad6bda7df30019b' THEN
    RAISE EXCEPTION 'TORNEOS_0011_PRECONDITION_FAILED: search % auth %', v_search, v_auth;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.search_tournament_players(p_organization_id uuid, p_tournament_id uuid, p_query text, p_limit integer DEFAULT 8, p_team_entry_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_result jsonb;
  v_directory jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 12);
begin
  if private.current_identity_id() is null
    or not (
      (
        public.has_tournament_organization_capability(
          p_organization_id,
          'roster_players.read'
        )
        and exists (
          select 1 from public.tournaments
          where id = p_tournament_id and organization_id = p_organization_id and status <> 'archived'
            and public.has_tournament_season_access(p_organization_id, season_id)
        )
      )
      or (
        p_team_entry_id is not null
        and public.can_edit_tournament_team_entry(
          p_organization_id,
          p_team_entry_id
        )
        and exists (
          select 1
          from public.tournament_team_entries entry
          join public.tournaments tournament on tournament.id = entry.tournament_id
          where entry.id = p_team_entry_id
            and entry.organization_id = p_organization_id
            and entry.tournament_id = p_tournament_id
            and tournament.status <> 'archived'
        )
      )
    )
    or char_length(btrim(coalesce(p_query, ''))) not between 2 and 100
  then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  if (
    select count(*)
    from public.tournament_audit_log audit
    where audit.actor_user_id = private.current_identity_id()
      and audit.action = 'search.players'
      and audit.created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception using errcode = 'P0001', message = 'TORNEOS_SEARCH_RATE_LIMITED';
  end if;
  -- Phase 2B: Core directory contract (players). Each result is a current, discoverable
  -- Core account; its local shadow identity is allocated exactly as the certified bridge does.
  v_directory := private.consume_core_attestation(
    'directory_players',
    jsonb_build_object(
      'organizationId', p_organization_id, 'tournamentId', p_tournament_id,
      'teamEntryId', p_team_entry_id, 'query', btrim(p_query), 'limit', v_limit
    )
  );
  insert into public.torneos_identity (core_user_id)
  select (item->>'core_user_id')::uuid
  from jsonb_array_elements(coalesce(v_directory->'items', '[]'::jsonb)) item
  on conflict (core_user_id) do nothing;
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', identity.id,
    'displayName', item->>'display_name',
    'avatarUrl', item->'avatar_url',
    'positions', coalesce(item->'positions', '[]'::jsonb),
    'linkedAccount', true,
    'teamName', null
  ) order by item->>'display_name', identity.id), '[]'::jsonb)
  into v_result
  from jsonb_array_elements(coalesce(v_directory->'items', '[]'::jsonb)) item
  join public.torneos_identity identity
    on identity.core_user_id = (item->>'core_user_id')::uuid;
  perform public.append_tournament_audit(
    p_organization_id,
    'search.players',
    'tournament',
    p_tournament_id,
    p_team_entry_id,
    p_tournament_id,
    jsonb_build_object(
      'queryLength',
      char_length(btrim(p_query)),
      'resultCount',
      jsonb_array_length(v_result)
    )
  );
  return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION private.authorize_core_contract(p_contract text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_identity uuid := private.current_identity_id();
 v_invitation public.tournament_team_invitations%rowtype;
 v_organization_invitation public.tournament_organization_invitations%rowtype;
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
 -- OFFICIALIZATION-V1: an organization invitation is accepted with the same Core verified-email contract; the
 -- request names exactly one key. The team-invitation branch below is unchanged.
 IF p_contract = 'verified_email' AND p_request ? 'organization_invitation_token' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_request)) <> 1 THEN
   RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TORNEOS_INVALID_CORE_CONTRACT_REQUEST';
  END IF;
  v_token := p_request->>'organization_invitation_token';
  IF char_length(coalesce(v_token, '')) <> 64 THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_INVITATION_INVALID';
  END IF;
  SELECT * INTO v_organization_invitation FROM public.tournament_organization_invitations
  WHERE token_hash = encode(public.digest(v_token, 'sha256'), 'hex');
  IF v_organization_invitation.id IS NULL OR v_organization_invitation.status <> 'pending' THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_INVITATION_INVALID';
  END IF;
  IF v_organization_invitation.expires_at <= now() THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_INVITATION_EXPIRED';
  END IF;
  IF NOT EXISTS (
   SELECT 1 FROM public.tournament_organizations organization
   WHERE organization.id = v_organization_invitation.organization_id AND organization.status = 'active'
  ) THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_INVITATION_INVALID';
  END IF;
  v_request := jsonb_build_object('expected_email', v_organization_invitation.email_normalized);
  v_core_request := v_request;
 ELSIF p_contract = 'verified_email' THEN
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
     (
      public.has_tournament_organization_capability(v_organization_id, 'roster_players.read')
      AND EXISTS (
       SELECT 1 FROM public.tournaments
       WHERE id = v_tournament_id AND organization_id = v_organization_id AND status <> 'archived'
        AND public.has_tournament_season_access(v_organization_id, season_id)
      )
     )
     OR (
      v_team_entry_id IS NOT NULL
      AND public.can_edit_tournament_team_entry(v_organization_id, v_team_entry_id)
      AND EXISTS (
       SELECT 1 FROM public.tournament_team_entries entry
       JOIN public.tournaments tournament ON tournament.id = entry.tournament_id
       WHERE entry.id = v_team_entry_id
        AND entry.organization_id = v_organization_id
        AND entry.tournament_id = v_tournament_id
        AND tournament.status <> 'archived'
      )
     )
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

DO $guard$
DECLARE
  v_search text := (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.search_tournament_players(uuid,uuid,text,integer,uuid)'::regprocedure);
  v_auth text := (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.authorize_core_contract(text,jsonb)'::regprocedure);
BEGIN
  IF v_search IS DISTINCT FROM '2c2616850c960260c57b7a6a2e475caf' OR v_auth IS DISTINCT FROM 'd04babede13de0b09f9a462e2279566b' THEN
    RAISE EXCEPTION 'TORNEOS_0011_POSTCONDITION_FAILED: search % auth %', v_search, v_auth;
  END IF;
END $guard$;

DO $acl$
BEGIN
  IF has_function_privilege('anon', 'public.search_tournament_players(uuid,uuid,text,integer,uuid)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.search_tournament_players(uuid,uuid,text,integer,uuid)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.authorize_core_contract(text,jsonb)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('anon', 'private.authorize_core_contract(text,jsonb)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege('torneos_core_adapter', 'private.authorize_core_contract(text,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'TORNEOS_ROSTER_SEARCH_ACL_CHANGED';
  END IF;
END $acl$;

COMMIT;
