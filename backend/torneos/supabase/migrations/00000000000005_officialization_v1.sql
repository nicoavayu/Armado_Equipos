-- Arma2 Torneos — OFFICIALIZATION-V1: optional dual control per tournament + organization membership.
-- Applies after 00000000000000 … 00000000000004 (all unchanged). Append-only.
--
-- Root cause (measured in Production during the 2026-09-27 product smoke, reproduced locally):
--   • make_tournament_match_official requires a `validated` operation;
--   • validate_tournament_match_operation refused, unconditionally, a validator that is the submitter
--     (TORNEOS_MATCH_DUAL_CONTROL_REQUIRED);
--   • submit / review / validate / make official require an owner/admin of the organization, and the only
--     code path that inserts a tournament_organization_members row is create_tournament_organization (the
--     owner). The capability matrix already had members.invite / members.update_role / members.remove, but no
--     RPC used them and the UI said "Invitar miembro: Próximamente".
--   ⇒ no real organization could make a result official; standings, statistics, qualification, playoffs,
--     corrections and finishing a competition were blocked in cascade.
--
-- What this migration does (one transaction, fail-closed pre/postconditions):
--
--   1. Dual control becomes an explicit, optional policy of each tournament:
--        tournaments.match_result_dual_control_enabled boolean NOT NULL DEFAULT false.
--      validate_tournament_match_operation keeps every guard (bridge identity, organization, capability
--      match_operations.validate, season access, status under_review, payload validation) and refuses
--      submitter = validator ONLY when the tournament's policy is ON (a missing tournament reads as ON:
--      fail closed). The validation audit entry records {dualControl, selfValidated}. Nothing else changes:
--      review / make official / corrections keep their certified bodies.
--      The policy is changed only by set_tournament_match_dual_control (new capability
--      match_operations.configure_dual_control, owner only, like tournaments.reopen), audited, refused on a
--      completed/archived competition, and turning it ON needs two eligible validators on the season.
--      get_tournament_match_operation_context gains a `dualControl` object (policy + whether the viewer
--      submitted / validated) so the UI never offers a button that must end in 403.
--
--   2. Organization membership: invitations by email with a single-use token (sha256 stored, 7 days),
--      accepted only by the Core identity whose VERIFIED email is the invited one — the same Core
--      `verified_email` attestation the team invitations use (private.authorize_core_contract gains the
--      organization-invitation branch; the team branch is byte-identical). Roles: exactly one OWNER
--      (unchanged: unique index + protect trigger), any number of ADMIN / COLLABORATOR. Owner invites admin
--      or collaborator; admin invites collaborator; only the owner changes roles; nobody changes their own
--      membership; the owner is never removed or demoted; removing a member releases their season seats.
--      New table public.tournament_organization_invitations: RLS on, no policy, no client grant (RPC-only).
--
-- New RPCs (EXECUTE to authenticated + service_role only; never anon / PUBLIC / server roles):
--   invite_tournament_organization_member, list_tournament_organization_invitations,
--   revoke_tournament_organization_invitation, accept_tournament_organization_invitation,
--   list_tournament_organization_members, update_tournament_organization_member_role,
--   remove_tournament_organization_member, get_tournament_match_dual_control,
--   set_tournament_match_dual_control.
-- Replaced bodies (pinned before → after): validate_tournament_match_operation,
--   get_tournament_match_operation_context, private.authorize_core_contract.
--
-- Fail-closed: the preconditions accept the certified POST_0004 state or the state this migration leaves
-- (re-apply is a no-op); anything else aborts with TORNEOS_OFFICIALIZATION_V1_PRECONDITION_FAILED before
-- any change. Rollback (documented, never applied automatically):
-- backend/torneos/officialization-v1/rollback/00000000000005_officialization_v1.rollback.sql.
BEGIN;

CREATE TEMPORARY TABLE torneos_officialization_v1_acl (
  phase text PRIMARY KEY,
  authenticated_public integer NOT NULL,
  anon_public integer NOT NULL,
  newly_granted integer NOT NULL
) ON COMMIT DROP;

DO $pre$
DECLARE
  -- 0004 must be in force: its 15 grants present, its 23 closed functions closed.
  v_0004 text[] := array[
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
  -- Bodies this migration replaces: certified POST_0004 md5 → OFFICIALIZATION-V1 md5.
  v_pins text[][] := array[
    array['public.validate_tournament_match_operation(uuid,uuid)', '4f43a7292753cbd191c9800dac08ed58', '349c89ce40a0a2ac1223839d20c3437d'],
    array['public.get_tournament_match_operation_context(uuid,uuid)', '2f43290e706d0471f91a4baf67f400c5', '86186ea09217d70d2cc113c16f9340fa'],
    array['private.authorize_core_contract(text,jsonb)', '488ca6bb0491e7ae9921091a90f30b65', '1ac5d5131cd7c3914ad6bda7df30019b']
  ];
  v_problems text[] := array[]::text[];
  v_fn text;
  v_oid oid;
  v_md5 text;
  v_post boolean;
  v_newly integer := 0;
  i integer;
BEGIN
  FOREACH v_fn IN ARRAY v_0004 || v_closed LOOP
    IF to_regprocedure(v_fn) IS NULL THEN v_problems := v_problems || ('missing ' || v_fn); END IF;
  END LOOP;
  IF to_regclass('public.tournaments') IS NULL OR to_regclass('public.tournament_organization_members') IS NULL
    OR to_regprocedure('private.consume_core_attestation(text,jsonb)') IS NULL THEN
    v_problems := v_problems || 'baseline objects missing'::text;
  END IF;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'TORNEOS_OFFICIALIZATION_V1_PRECONDITION_FAILED: %', array_to_string(v_problems, '; ');
  END IF;
  FOREACH v_fn IN ARRAY v_0004 LOOP
    IF NOT has_function_privilege('authenticated', to_regprocedure(v_fn), 'EXECUTE') THEN
      v_problems := v_problems || ('0004 not in force: authenticated lacks ' || v_fn);
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY v_closed LOOP
    v_oid := to_regprocedure(v_fn);
    IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_problems := v_problems || ('client role executes ' || v_fn);
    END IF;
  END LOOP;
  -- Every replaced body is either the certified POST_0004 one or this migration's (never a third state).
  v_post := to_regclass('public.tournament_organization_invitations') IS NOT NULL;
  FOR i IN 1 .. array_length(v_pins, 1) LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_pins[i][1]);
    IF v_md5 IS DISTINCT FROM (CASE WHEN v_post THEN v_pins[i][3] ELSE v_pins[i][2] END) THEN
      v_problems := v_problems || format('%s body %s is not the certified %s body', v_pins[i][1], v_md5,
        CASE WHEN v_post THEN 'OFFICIALIZATION-V1' ELSE 'POST_0004' END);
    END IF;
  END LOOP;
  IF v_post <> EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                        AND table_name = 'tournaments' AND column_name = 'match_result_dual_control_enabled') THEN
    v_problems := v_problems || 'partial OFFICIALIZATION-V1 state (column vs invitations table)'::text;
  END IF;
  FOREACH v_fn IN ARRAY v_new LOOP
    v_oid := to_regprocedure(v_fn);
    IF v_oid IS NULL THEN
      IF v_post THEN v_problems := v_problems || ('partial OFFICIALIZATION-V1 state: missing ' || v_fn); END IF;
      v_newly := v_newly + 1;
    ELSIF NOT v_post THEN
      v_problems := v_problems || ('unexpected pre-existing ' || v_fn);
    ELSIF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_newly := v_newly + 1;
    END IF;
  END LOOP;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'TORNEOS_OFFICIALIZATION_V1_PRECONDITION_FAILED: %', array_to_string(v_problems, '; ');
  END IF;
  INSERT INTO torneos_officialization_v1_acl
  SELECT 'before',
    count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')),
    v_newly
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
END $pre$;

-- ============================================================================ schema
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS match_result_dual_control_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.tournaments.match_result_dual_control_enabled IS
  'Política de doble control de actas del torneo. false (default): un owner/admin autorizado puede presentar y validar su propia acta. true: quien presenta no puede validar (dos identidades distintas). Sólo la cambia el propietario (set_tournament_match_dual_control), con auditoría.';

CREATE TABLE IF NOT EXISTS public.tournament_organization_invitations (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.tournament_organizations(id) ON DELETE CASCADE,
  email_normalized text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  accepted_at timestamp with time zone,
  accepted_by uuid,
  membership_id uuid REFERENCES public.tournament_organization_members(id),
  revoked_at timestamp with time zone,
  revoked_by uuid,
  CONSTRAINT tournament_organization_invitations_token_unique UNIQUE (token_hash),
  CONSTRAINT tournament_organization_invitations_email_check CHECK (
    email_normalized = lower(btrim(email_normalized)) AND char_length(email_normalized) BETWEEN 6 AND 254
    AND email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT tournament_organization_invitations_role_check CHECK (role = ANY (ARRAY['admin'::text, 'collaborator'::text])),
  CONSTRAINT tournament_organization_invitations_token_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tournament_organization_invitations_status_check CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text, 'expired'::text])),
  CONSTRAINT tournament_organization_invitations_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT tournament_organization_invitations_lifecycle_check CHECK (
    ((status <> 'accepted') OR (accepted_at IS NOT NULL AND accepted_by IS NOT NULL AND membership_id IS NOT NULL AND accepted_at <= expires_at))
    AND ((status <> 'revoked') OR (revoked_at IS NOT NULL)))
);
COMMENT ON TABLE public.tournament_organization_invitations IS
  'OFFICIALIZATION-V1: invitaciones a la organización (admin/collaborator). Token de un solo uso (sólo se guarda su sha256), 7 días, aceptación ligada al email verificado de Core. Sin acceso directo de clientes: sólo por RPC.';
CREATE UNIQUE INDEX IF NOT EXISTS tournament_organization_invitations_one_pending_idx
  ON public.tournament_organization_invitations (organization_id, email_normalized) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS tournament_organization_invitations_org_idx
  ON public.tournament_organization_invitations (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tournament_organization_invitations_creator_idx
  ON public.tournament_organization_invitations (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS tournament_organization_invitations_membership_idx
  ON public.tournament_organization_invitations (membership_id) WHERE membership_id IS NOT NULL;
ALTER TABLE public.tournament_organization_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_organization_invitations FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.tournament_organization_role_capabilities (role, capability)
VALUES ('owner', 'match_operations.configure_dual_control')
ON CONFLICT (role, capability) DO NOTHING;

-- ============================================================================ replaced bodies
-- validate_tournament_match_operation: certified POST_0004 body + the tournament's dual-control policy.
CREATE OR REPLACE FUNCTION public.validate_tournament_match_operation(p_organization_id uuid, p_match_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_operation public.tournament_match_operations%rowtype;
  v_validation jsonb;
  v_dual_control boolean;
  v_self_validation boolean;
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
  -- OFFICIALIZATION-V1: dual control is the tournament's policy. ON: the submitter never validates. OFF: an
  -- authorized owner/admin (every guard above still applies) may validate the report they submitted. A
  -- tournament that cannot be read reads as ON (fail closed).
  select tournament.match_result_dual_control_enabled into v_dual_control
  from public.tournaments tournament
  where tournament.id = v_operation.tournament_id and tournament.organization_id = p_organization_id;
  v_dual_control := coalesce(v_dual_control, true);
  v_self_validation := v_operation.submitted_by = private.current_identity_id();
  if v_dual_control and v_self_validation then
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
    v_operation.id, null, v_operation.tournament_id,
    jsonb_build_object('dualControl', v_dual_control, 'selfValidated', v_self_validation)
  );
  return public.get_tournament_match_operation_context(p_organization_id, v_operation.id);
end;
$function$;

-- get_tournament_match_operation_context: certified body + the `dualControl` object.
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
      ), '[]'::jsonb),
      -- OFFICIALIZATION-V1: the tournament's dual-control policy and the viewer's part in this version, so a
      -- client never offers an action the policy refuses (a missing tournament reads as ON).
      'dualControl', jsonb_build_object(
        'enabled', coalesce(tournament.match_result_dual_control_enabled, true),
        'submittedByViewer', coalesce(operation.submitted_by = private.current_identity_id(), false),
        'validatedByViewer', coalesce(operation.validated_by = private.current_identity_id(), false)
      )
    )
  end
  from public.tournament_match_operations operation
  left join public.tournament_match_outcomes outcome
    on outcome.match_operation_id = operation.id
  left join public.tournament_match_scores score
    on score.match_operation_id = operation.id
  left join public.tournaments tournament
    on tournament.id = operation.tournament_id and tournament.organization_id = operation.organization_id
  where operation.id = p_match_operation_id
    and operation.organization_id = p_organization_id;
$function$;

-- private.authorize_core_contract: certified body + the organization-invitation branch of verified_email.
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

-- ============================================================================ organization membership
-- Organization-wide authority: members.* capabilities of the caller's ACTIVE membership in an ACTIVE
-- organization (has_tournament_organization_capability). Membership is organization-scoped, not season-
-- scoped: season access keeps being granted by the existing seat assignments.
CREATE OR REPLACE FUNCTION public.invite_tournament_organization_member(p_organization_id uuid, p_email text, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := private.current_identity_id();
  v_actor_role text;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_invitation public.tournament_organization_invitations%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(p_organization_id, 'members.invite') then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_FORBIDDEN';
  end if;
  select membership.role into v_actor_role
  from public.tournament_organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor and membership.status = 'active';
  if p_role is null or p_role not in ('admin', 'collaborator') then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_MEMBER_ROLE';
  end if;
  -- Only the owner grants the administrator role; an admin invites collaborators.
  if p_role = 'admin' and v_actor_role is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_ROLE_FORBIDDEN';
  end if;
  if char_length(v_email) not between 6 and 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_MEMBER_EMAIL';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('torneos:organization-members:' || p_organization_id::text, 0)
  );
  if (
    select count(*) from public.tournament_organization_invitations invitation
    where invitation.created_by = v_actor and invitation.created_at > now() - interval '10 minutes'
  ) >= 10 then
    raise exception using errcode = 'P0001', message = 'TORNEOS_INVITATION_RATE_LIMITED';
  end if;
  if (
    select count(*) from public.tournament_organization_invitations invitation
    where invitation.organization_id = p_organization_id and invitation.status = 'pending'
      and invitation.expires_at > now()
  ) >= 50 then
    raise exception using errcode = 'P0001', message = 'TORNEOS_INVITATION_RATE_LIMITED';
  end if;
  -- A pending administrator invitation for this email is the owner's; an admin cannot replace it.
  if v_actor_role is distinct from 'owner' and exists (
    select 1 from public.tournament_organization_invitations invitation
    where invitation.organization_id = p_organization_id and invitation.email_normalized = v_email
      and invitation.status = 'pending' and invitation.role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_ROLE_FORBIDDEN';
  end if;
  -- Re-inviting replaces the previous link: at most one pending invitation per email.
  update public.tournament_organization_invitations set
    status = 'revoked', revoked_at = now(), revoked_by = v_actor
  where organization_id = p_organization_id and email_normalized = v_email and status = 'pending';
  v_token := encode(public.gen_random_bytes(32), 'hex');
  insert into public.tournament_organization_invitations (
    organization_id, email_normalized, role, token_hash, expires_at, created_by
  ) values (
    p_organization_id, v_email, p_role, encode(public.digest(v_token, 'sha256'), 'hex'),
    now() + interval '7 days', v_actor
  ) returning * into v_invitation;
  perform public.append_tournament_audit(
    p_organization_id, 'member.invited', 'organization_invitation', v_invitation.id,
    null, null, jsonb_build_object('role', p_role, 'expiresAt', v_invitation.expires_at)
  );
  -- The token is returned once, to the inviter, and never stored in clear.
  return jsonb_build_object(
    'invitationId', v_invitation.id, 'role', v_invitation.role, 'email', v_invitation.email_normalized,
    'expiresAt', v_invitation.expires_at, 'token', v_token
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_tournament_organization_invitations(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if private.current_identity_id() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(p_organization_id, 'members.invite') then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_FORBIDDEN';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', invitation.id,
    'email', invitation.email_normalized,
    'role', invitation.role,
    'status', case when invitation.expires_at <= now() then 'expired' else invitation.status end,
    'createdAt', invitation.created_at,
    'expiresAt', invitation.expires_at
  ) order by invitation.created_at desc), '[]'::jsonb) into v_result
  from (
    select * from public.tournament_organization_invitations pending
    where pending.organization_id = p_organization_id and pending.status = 'pending'
    order by pending.created_at desc
    limit 100
  ) invitation;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_tournament_organization_invitation(p_organization_id uuid, p_invitation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := private.current_identity_id();
  v_actor_role text;
  v_invitation public.tournament_organization_invitations%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(p_organization_id, 'members.invite') then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_FORBIDDEN';
  end if;
  select * into v_invitation from public.tournament_organization_invitations
  where id = p_invitation_id and organization_id = p_organization_id for update;
  if v_invitation.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_INVALID';
  end if;
  select membership.role into v_actor_role
  from public.tournament_organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor and membership.status = 'active';
  if v_invitation.role = 'admin' and v_actor_role is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_ROLE_FORBIDDEN';
  end if;
  if v_invitation.status = 'revoked' then
    return jsonb_build_object('invitationId', v_invitation.id, 'status', 'revoked');
  end if;
  if v_invitation.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'TORNEOS_INVITATION_NOT_PENDING';
  end if;
  update public.tournament_organization_invitations set
    status = 'revoked', revoked_at = now(), revoked_by = v_actor
  where id = v_invitation.id;
  perform public.append_tournament_audit(
    p_organization_id, 'member.invitation_revoked', 'organization_invitation', v_invitation.id,
    null, null, jsonb_build_object('role', v_invitation.role)
  );
  return jsonb_build_object('invitationId', v_invitation.id, 'status', 'revoked');
end;
$function$;

-- Accepting requires the Core `verified_email` attestation for exactly the invited email, prepared by the
-- gateway's Core-contract adapter through private.authorize_core_contract (single use, 10 s, bound to this
-- identity and Core session). Without it — e.g. a direct PostgREST call — the RPC refuses.
CREATE OR REPLACE FUNCTION public.accept_tournament_organization_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_identity uuid := private.current_identity_id();
  v_invitation public.tournament_organization_invitations%rowtype;
  v_organization public.tournament_organizations%rowtype;
  v_membership public.tournament_organization_members%rowtype;
  v_verification jsonb;
begin
  if v_identity is null or char_length(coalesce(p_token, '')) <> 64 then
    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_INVALID';
  end if;
  select * into v_invitation from public.tournament_organization_invitations
  where token_hash = encode(public.digest(p_token, 'sha256'), 'hex') for update;
  if v_invitation.id is null or v_invitation.status <> 'pending' then
    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_INVALID';
  end if;
  if v_invitation.expires_at <= now() then
    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_EXPIRED';
  end if;
  select * into v_organization from public.tournament_organizations
  where id = v_invitation.organization_id and status = 'active';
  if v_organization.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_INVALID';
  end if;
  v_verification := private.consume_core_attestation(
    'verified_email',
    jsonb_build_object('expected_email', v_invitation.email_normalized)
  );
  if (v_verification->>'verified') is distinct from 'true'
    or (v_verification->>'matches') is distinct from 'true'
  then
    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('torneos:organization-members:' || v_invitation.organization_id::text, 0)
  );
  select * into v_membership from public.tournament_organization_members
  where organization_id = v_invitation.organization_id and user_id = v_identity for update;
  if v_membership.id is not null and v_membership.status = 'active' then
    raise exception using errcode = 'P0001', message = 'TORNEOS_MEMBER_ALREADY_ACTIVE';
  end if;
  if v_membership.id is null then
    insert into public.tournament_organization_members (
      organization_id, user_id, role, status, invited_by, joined_at
    ) values (
      v_invitation.organization_id, v_identity, v_invitation.role, 'active', v_invitation.created_by, now()
    ) returning * into v_membership;
  else
    -- A removed or suspended member comes back with the invited role (never owner: the owner row is
    -- always active and the invitation role is admin/collaborator).
    update public.tournament_organization_members set
      role = v_invitation.role, status = 'active', invited_by = v_invitation.created_by, joined_at = now()
    where id = v_membership.id
    returning * into v_membership;
  end if;
  update public.tournament_organization_invitations set
    status = 'accepted', accepted_at = now(), accepted_by = v_identity, membership_id = v_membership.id
  where id = v_invitation.id;
  perform public.append_tournament_audit(
    v_invitation.organization_id, 'member.invitation_accepted', 'organization_member', v_membership.id,
    null, null, jsonb_build_object('role', v_membership.role, 'invitationId', v_invitation.id)
  );
  return jsonb_build_object(
    'organizationId', v_organization.id, 'organizationName', v_organization.name,
    'organizationSlug', v_organization.slug, 'membershipId', v_membership.id,
    'role', v_membership.role, 'status', 'accepted'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_tournament_organization_members(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := private.current_identity_id();
  v_can_manage boolean;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(p_organization_id, 'members.read') then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_FORBIDDEN';
  end if;
  -- Invitation emails are shown only to those who manage invitations.
  v_can_manage := public.has_tournament_organization_capability(p_organization_id, 'members.invite');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', membership.id,
    'userId', membership.user_id,
    'role', membership.role,
    'status', membership.status,
    'joinedAt', membership.joined_at,
    'createdAt', membership.created_at,
    'isViewer', membership.user_id = v_actor,
    'email', case when v_can_manage then (
      select invitation.email_normalized from public.tournament_organization_invitations invitation
      where invitation.membership_id = membership.id and invitation.status = 'accepted'
      order by invitation.accepted_at desc limit 1
    ) end
  ) order by case membership.role when 'owner' then 0 when 'admin' then 1 else 2 end, membership.joined_at),
  '[]'::jsonb) into v_result
  from public.tournament_organization_members membership
  where membership.organization_id = p_organization_id and membership.status in ('active', 'suspended');
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_tournament_organization_member_role(p_organization_id uuid, p_membership_id uuid, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := private.current_identity_id();
  v_actor_role text;
  v_target public.tournament_organization_members%rowtype;
  v_previous text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(p_organization_id, 'members.update_role') then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_FORBIDDEN';
  end if;
  if p_role is null or p_role not in ('admin', 'collaborator') then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_MEMBER_ROLE';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('torneos:organization-members:' || p_organization_id::text, 0)
  );
  select * into v_target from public.tournament_organization_members
  where id = p_membership_id and organization_id = p_organization_id for update;
  if v_target.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_FORBIDDEN';
  end if;
  if v_target.user_id = v_actor then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_SELF_CHANGE_FORBIDDEN';
  end if;
  if v_target.role = 'owner' then
    raise exception using errcode = '42501', message = 'TORNEOS_OWNER_PROTECTED';
  end if;
  select membership.role into v_actor_role
  from public.tournament_organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor and membership.status = 'active';
  -- Roles are the owner's decision: an admin can neither promote nor demote anyone.
  if v_actor_role is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_ROLE_FORBIDDEN';
  end if;
  if v_target.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'TORNEOS_MEMBER_NOT_ACTIVE';
  end if;
  v_previous := v_target.role;
  if v_previous <> p_role then
    update public.tournament_organization_members set role = p_role
    where id = v_target.id returning * into v_target;
    perform public.append_tournament_audit(
      p_organization_id, 'member.role_changed', 'organization_member', v_target.id,
      null, null, jsonb_build_object('from', v_previous, 'to', p_role)
    );
  end if;
  return jsonb_build_object('membershipId', v_target.id, 'role', v_target.role, 'status', v_target.status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_tournament_organization_member(p_organization_id uuid, p_membership_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := private.current_identity_id();
  v_actor_role text;
  v_target public.tournament_organization_members%rowtype;
  v_released integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(p_organization_id, 'members.remove') then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_FORBIDDEN';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('torneos:organization-members:' || p_organization_id::text, 0)
  );
  select * into v_target from public.tournament_organization_members
  where id = p_membership_id and organization_id = p_organization_id for update;
  if v_target.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_FORBIDDEN';
  end if;
  if v_target.user_id = v_actor then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_SELF_CHANGE_FORBIDDEN';
  end if;
  -- The owner is never removed (also enforced by protect_tournament_organization_owner).
  if v_target.role = 'owner' then
    raise exception using errcode = '42501', message = 'TORNEOS_OWNER_PROTECTED';
  end if;
  select membership.role into v_actor_role
  from public.tournament_organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor and membership.status = 'active';
  if v_target.role = 'admin' and v_actor_role is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'TORNEOS_MEMBER_ROLE_FORBIDDEN';
  end if;
  if v_target.status = 'removed' then
    return jsonb_build_object('membershipId', v_target.id, 'role', v_target.role, 'status', 'removed');
  end if;
  update public.tournament_organization_members set status = 'removed'
  where id = v_target.id returning * into v_target;
  -- Access ends with the membership; its season seats are released.
  delete from public.tournament_season_member_assignments
  where organization_id = p_organization_id and membership_id = v_target.id;
  get diagnostics v_released = row_count;
  perform public.append_tournament_audit(
    p_organization_id, 'member.removed', 'organization_member', v_target.id,
    null, null, jsonb_build_object('role', v_target.role, 'seatsReleased', v_released)
  );
  return jsonb_build_object('membershipId', v_target.id, 'role', v_target.role, 'status', 'removed');
end;
$function$;

-- ============================================================================ dual-control policy
-- Validators eligible on a season: active members whose role carries match_operations.validate and who
-- have access to the season (owner always; admins/collaborators through a seat).
CREATE OR REPLACE FUNCTION public.get_tournament_match_dual_control(p_organization_id uuid, p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tournament public.tournaments%rowtype;
  v_eligible integer;
begin
  if private.current_identity_id() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_tournament from public.tournaments
  where id = p_tournament_id and organization_id = p_organization_id;
  if v_tournament.id is null or not (
    public.has_tournament_organization_capability(p_organization_id, 'match_operations.read')
    and public.has_tournament_season_access(p_organization_id, v_tournament.season_id)
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select count(*)::integer into v_eligible
  from public.tournament_organization_members membership
  where membership.organization_id = p_organization_id and membership.status = 'active'
    and 'match_operations.validate' = any(public.tournament_role_capabilities(membership.role))
    and (membership.role = 'owner' or exists (
      select 1 from public.tournament_season_member_assignments assignment
      where assignment.organization_id = p_organization_id
        and assignment.season_id = v_tournament.season_id
        and assignment.membership_id = membership.id
    ));
  return jsonb_build_object(
    'tournamentId', v_tournament.id,
    'enabled', v_tournament.match_result_dual_control_enabled,
    'canManage', public.has_tournament_organization_capability(p_organization_id, 'match_operations.configure_dual_control'),
    'eligibleValidators', v_eligible,
    'readOnly', v_tournament.status in ('completed', 'archived')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_tournament_match_dual_control(p_organization_id uuid, p_tournament_id uuid, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tournament public.tournaments%rowtype;
  v_state jsonb;
begin
  if private.current_identity_id() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_DUAL_CONTROL';
  end if;
  select * into v_tournament from public.tournaments
  where id = p_tournament_id and organization_id = p_organization_id for update;
  if v_tournament.id is null or not (
    public.has_tournament_organization_capability(p_organization_id, 'match_operations.configure_dual_control')
    and public.has_tournament_season_access(p_organization_id, v_tournament.season_id)
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if v_tournament.status in ('completed', 'archived') then
    raise exception using errcode = '22023', message = 'TORNEOS_COMPETITION_READ_ONLY';
  end if;
  v_state := public.get_tournament_match_dual_control(p_organization_id, p_tournament_id);
  if v_tournament.match_result_dual_control_enabled = p_enabled then
    return v_state;
  end if;
  -- Turning it ON with a single eligible validator would block every result of this tournament.
  if p_enabled and (v_state->>'eligibleValidators')::integer < 2 then
    raise exception using errcode = 'P0001', message = 'TORNEOS_DUAL_CONTROL_SECOND_VALIDATOR_REQUIRED';
  end if;
  update public.tournaments set match_result_dual_control_enabled = p_enabled
  where id = v_tournament.id;
  perform public.append_tournament_audit(
    p_organization_id, 'tournament.match_dual_control_changed', 'tournament', v_tournament.id,
    null, v_tournament.id,
    jsonb_build_object('enabled', p_enabled, 'previous', v_tournament.match_result_dual_control_enabled)
  );
  return public.get_tournament_match_dual_control(p_organization_id, p_tournament_id);
end;
$function$;

-- ============================================================================ ACL of the new RPCs
REVOKE ALL ON FUNCTION public.invite_tournament_organization_member(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_tournament_organization_invitations(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_tournament_organization_invitation(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.accept_tournament_organization_invitation(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_tournament_organization_members(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_tournament_organization_member_role(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.remove_tournament_organization_member(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_tournament_match_dual_control(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_tournament_match_dual_control(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invite_tournament_organization_member(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_tournament_organization_invitations(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_tournament_organization_invitation(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_tournament_organization_invitation(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_tournament_organization_members(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_tournament_organization_member_role(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_tournament_organization_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_match_dual_control(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_tournament_match_dual_control(uuid, uuid, boolean) TO authenticated, service_role;

-- ============================================================================ postconditions
DO $post$
DECLARE
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
  v_pins text[][] := array[
    array['public.validate_tournament_match_operation(uuid,uuid)', '349c89ce40a0a2ac1223839d20c3437d'],
    array['public.get_tournament_match_operation_context(uuid,uuid)', '86186ea09217d70d2cc113c16f9340fa'],
    array['private.authorize_core_contract(text,jsonb)', '1ac5d5131cd7c3914ad6bda7df30019b']
  ];
  v_server_roles text[] := array['torneos_core_adapter', 'torneos_identity_writer', 'torneos_payment_service'];
  v_problems text[] := array[]::text[];
  v_fn text;
  v_role text;
  v_oid oid;
  v_before torneos_officialization_v1_acl%rowtype;
  v_auth integer;
  v_anon integer;
  i integer;
BEGIN
  FOREACH v_fn IN ARRAY v_new LOOP
    v_oid := to_regprocedure(v_fn);
    IF v_oid IS NULL THEN v_problems := v_problems || ('missing ' || v_fn); CONTINUE; END IF;
    IF NOT (SELECT p.prosecdef AND p.proconfig @> array['search_path=""'] FROM pg_proc p WHERE p.oid = v_oid) THEN
      v_problems := v_problems || ('not a pinned SECURITY DEFINER ' || v_fn);
    END IF;
    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN v_problems := v_problems || ('authenticated lacks ' || v_fn); END IF;
    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN v_problems := v_problems || ('service_role lacks ' || v_fn); END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN v_problems := v_problems || ('anon executes ' || v_fn); END IF;
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
  FOR i IN 1 .. array_length(v_pins, 1) LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(v_pins[i][1])) IS DISTINCT FROM v_pins[i][2] THEN
      v_problems := v_problems || ('body not pinned: ' || v_pins[i][1]);
    END IF;
  END LOOP;
  -- The authorizer stays private: only the Core-contract adapter executes it.
  IF has_function_privilege('authenticated', 'private.authorize_core_contract(text,jsonb)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('anon', 'private.authorize_core_contract(text,jsonb)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege('torneos_core_adapter', 'private.authorize_core_contract(text,jsonb)'::regprocedure, 'EXECUTE') THEN
    v_problems := v_problems || 'private.authorize_core_contract ACL changed'::text;
  END IF;
  -- The invitations table: RLS on, no client privilege at all.
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.tournament_organization_invitations'::regclass) THEN
    v_problems := v_problems || 'invitations without RLS'::text;
  END IF;
  FOREACH v_role IN ARRAY array['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_role, 'public.tournament_organization_invitations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      v_problems := v_problems || (v_role || ' has a privilege on tournament_organization_invitations');
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tournaments'
                 AND column_name = 'match_result_dual_control_enabled' AND is_nullable = 'NO' AND column_default = 'false') THEN
    v_problems := v_problems || 'tournaments.match_result_dual_control_enabled is not boolean NOT NULL DEFAULT false'::text;
  END IF;
  IF (SELECT array_agg(role ORDER BY role) FROM public.tournament_organization_role_capabilities
      WHERE capability = 'match_operations.configure_dual_control') IS DISTINCT FROM array['owner']::text[] THEN
    v_problems := v_problems || 'match_operations.configure_dual_control is not owner-only'::text;
  END IF;
  SELECT * INTO v_before FROM torneos_officialization_v1_acl WHERE phase = 'before';
  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))
    INTO v_auth, v_anon
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
  IF v_auth <> v_before.authenticated_public + v_before.newly_granted THEN
    v_problems := v_problems || format('authenticated delta %s, expected %s', v_auth - v_before.authenticated_public, v_before.newly_granted);
  END IF;
  IF v_anon <> v_before.anon_public THEN
    v_problems := v_problems || format('anon changed %s -> %s', v_before.anon_public, v_anon);
  END IF;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'TORNEOS_OFFICIALIZATION_V1_POSTCONDITION_FAILED: %', array_to_string(v_problems, '; ');
  END IF;
END $post$;

COMMIT;
