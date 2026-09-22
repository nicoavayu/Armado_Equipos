-- Phase 2B: Core contract boundary for the four historical Core-dependent RPCs.
-- The Torneos server calls the certified Core contract (Phase 2A) and records a
-- single-use attestation bound to the local identity, the Core session and the
-- exact request. The historical RPC re-authorizes locally, then consumes it.
-- Nothing here is a client-settable GUC, a request-body flag, an email claim, or a
-- browser-readable attestation table.
CREATE ROLE torneos_core_adapter NOLOGIN NOINHERIT;
GRANT USAGE ON SCHEMA private TO torneos_core_adapter;

CREATE TABLE private.core_contract_attestations (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 identity_id uuid NOT NULL REFERENCES public.torneos_identity(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 contract text NOT NULL CHECK (contract IN ('verified_email','directory_players','directory_teams','team_snapshot')),
 request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
 observed_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now() + interval '10 seconds',
 consumed_at timestamptz,
 CONSTRAINT core_contract_attestations_ttl CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 seconds'),
 CONSTRAINT core_contract_attestations_fresh CHECK (observed_at >= created_at - interval '10 seconds' AND observed_at <= created_at + interval '5 seconds')
);
CREATE INDEX core_contract_attestations_lookup ON private.core_contract_attestations (identity_id, session_id, contract, request_hash) WHERE consumed_at IS NULL;
ALTER TABLE private.core_contract_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.core_contract_attestations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.core_contract_attestations FROM PUBLIC, anon, authenticated, service_role;
-- The adapter can only append; it never reads, replays, extends or deletes an attestation.
GRANT INSERT ON private.core_contract_attestations TO torneos_core_adapter;
CREATE POLICY adapter_attest ON private.core_contract_attestations FOR INSERT TO torneos_core_adapter WITH CHECK (true);

-- Torneos-owned frozen competition snapshot (Phase 2A contract 3). Not a Core mirror.
CREATE TABLE private.tournament_team_entry_core_snapshots (
 team_entry_id uuid PRIMARY KEY REFERENCES public.tournament_team_entries(id) ON DELETE CASCADE,
 organization_id uuid NOT NULL,
 tournament_id uuid NOT NULL,
 core_team_id uuid NOT NULL,
 name text NOT NULL,
 crest_url text,
 players jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(players) = 'array'),
 source_revision integer NOT NULL,
 captured_at timestamptz NOT NULL,
 imported_by uuid NOT NULL REFERENCES public.torneos_identity(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.tournament_team_entry_core_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.tournament_team_entry_core_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.tournament_team_entry_core_snapshots FROM PUBLIC, anon, authenticated, service_role, torneos_core_adapter;

-- One hash implementation: the adapter stores what SQL computed; the RPC recomputes from its own validated inputs.
CREATE FUNCTION private.core_contract_request_hash(p_contract text, p_request jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT encode(extensions.digest(convert_to(p_contract || E'\n' || p_request::text, 'UTF8'), 'sha256'), 'hex')
$$;

-- Single-use consumption. Executable only by the function owner from the historical DEFINER RPCs.
CREATE FUNCTION private.consume_core_attestation(p_contract text, p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
 v_identity uuid := private.current_identity_id();
 v_session uuid;
 v_attestation private.core_contract_attestations%rowtype;
BEGIN
 IF v_identity IS NULL THEN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_AUTH_REQUIRED';
 END IF;
 BEGIN
  v_session := (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'session_id')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
  v_session := NULL;
 END;
 IF v_session IS NULL THEN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_AUTH_REQUIRED';
 END IF;
 SELECT * INTO v_attestation
 FROM private.core_contract_attestations attestation
 WHERE attestation.identity_id = v_identity
  AND attestation.session_id = v_session
  AND attestation.contract = p_contract
  AND attestation.request_hash = private.core_contract_request_hash(p_contract, p_request)
  AND attestation.consumed_at IS NULL
  AND attestation.expires_at > now()
 ORDER BY attestation.created_at DESC
 LIMIT 1
 FOR UPDATE;
 IF v_attestation.id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TORNEOS_CORE_ATTESTATION_REQUIRED';
 END IF;
 UPDATE private.core_contract_attestations SET consumed_at = now() WHERE id = v_attestation.id;
 RETURN v_attestation.response;
END $$;

-- Server-side pre-authorization: the same local predicate the RPC applies, evaluated
-- for the verified claims before any Core call. Returns the exact Core request and its hash.
CREATE FUNCTION private.authorize_core_contract(p_contract text, p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END $$;

REVOKE ALL ON FUNCTION private.core_contract_request_hash(text, jsonb), private.consume_core_attestation(text, jsonb), private.authorize_core_contract(text, jsonb) FROM PUBLIC, anon, authenticated, service_role, torneos_core_adapter;
GRANT EXECUTE ON FUNCTION private.authorize_core_contract(text, jsonb) TO torneos_core_adapter;
