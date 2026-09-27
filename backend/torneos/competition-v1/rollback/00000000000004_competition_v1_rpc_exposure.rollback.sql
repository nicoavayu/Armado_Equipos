-- Arma2 Torneos — COMPETITION-V1 logical rollback of 00000000000004_competition_v1_rpc_exposure.sql.
--
-- NOT a migration (it lives outside supabase/migrations on purpose, so no installer ever applies it by
-- accident). It returns the ACL of the 15 functions that 0004 granted to exactly the state 0001 left:
-- EXECUTE for service_role only. It does not touch data: fixtures, match reports, standings or
-- communications written while the contract was open stay in the database, read-only for clients that
-- lose the RPCs. Apply only together with the gateway allowlist rollback (competition-v1 entries removed)
-- and the frontend feature map rollback, in the order documented in backend/torneos/competition-v1/REPORT.md.
--
-- Fail-closed: aborts unless the 15 are exactly in the 0004 state (authenticated yes, anon no) or already
-- rolled back; verifies afterwards that authenticated lost exactly those 15 and anon did not change.
BEGIN;

CREATE TEMPORARY TABLE torneos_competition_v1_rollback (
  authenticated_public integer NOT NULL,
  anon_public integer NOT NULL,
  still_granted integer NOT NULL
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
  v_fn text;
  v_oid oid;
  v_problems text[] := array[]::text[];
  v_still integer := 0;
BEGIN
  FOREACH v_fn IN ARRAY v_grant LOOP
    v_oid := to_regprocedure(v_fn);
    IF v_oid IS NULL THEN v_problems := v_problems || ('missing ' || v_fn); CONTINUE; END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN v_problems := v_problems || ('anon executes ' || v_fn); END IF;
    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN v_problems := v_problems || ('service_role lacks ' || v_fn); END IF;
    IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN v_still := v_still + 1; END IF;
  END LOOP;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'TORNEOS_COMPETITION_V1_ROLLBACK_PRECONDITION_FAILED: %', array_to_string(v_problems, '; ');
  END IF;
  INSERT INTO torneos_competition_v1_rollback
  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')), v_still
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
END $pre$;

REVOKE EXECUTE ON FUNCTION public.reopen_tournament_participants(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_reason text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.save_tournament_draw_pots(p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_pots jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_draft_fixture(p_organization_id uuid, p_fixture_version_id uuid, p_action text, p_payload jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publish_tournament_fixture(p_organization_id uuid, p_fixture_version_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.supersede_tournament_fixture(p_organization_id uuid, p_fixture_version_id uuid, p_idempotency_key uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.schedule_tournament_match(p_organization_id uuid, p_match_id uuid, p_scheduled_at timestamp with time zone, p_venue_id uuid, p_court_id uuid, p_duration_minutes integer, p_override_warnings boolean, p_override_reason text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_schedule_tournament_matches(p_organization_id uuid, p_fixture_version_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_match_squad(p_organization_id uuid, p_match_id uuid, p_team_entry_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.void_tournament_match_event(p_organization_id uuid, p_event_id uuid, p_reason text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.review_tournament_match_operation(p_organization_id uuid, p_match_operation_id uuid, p_decision text, p_reason text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_tournament_match_operation(p_organization_id uuid, p_match_operation_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.make_tournament_match_official(p_organization_id uuid, p_match_operation_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.request_tournament_match_correction(p_organization_id uuid, p_match_operation_id uuid, p_reason text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_tournament_match_correction(p_organization_id uuid, p_match_operation_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_tournament_qualification(p_revision_id uuid, p_reason text) FROM authenticated;

DO $post$
DECLARE
  v_before torneos_competition_v1_rollback%rowtype;
  v_auth integer;
  v_anon integer;
BEGIN
  SELECT * INTO v_before FROM torneos_competition_v1_rollback;
  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))
    INTO v_auth, v_anon
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
  IF v_auth <> v_before.authenticated_public - v_before.still_granted OR v_anon <> v_before.anon_public THEN
    RAISE EXCEPTION 'TORNEOS_COMPETITION_V1_ROLLBACK_POSTCONDITION_FAILED: authenticated % -> %, anon % -> %',
      v_before.authenticated_public, v_auth, v_before.anon_public, v_anon;
  END IF;
END $post$;

COMMIT;
