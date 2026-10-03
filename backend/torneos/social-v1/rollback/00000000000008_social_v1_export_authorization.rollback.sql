-- Arma2 Torneos — ROLLBACK of 00000000000008_social_v1_export_authorization.sql (documented, NEVER automatic: gate D).
-- Restores the POST_0007 state exactly: the certified body f211d9a26d99448d4069c499c7508c55 of
-- public.authorize_tournament_social_export and its POST_0007 ACL (no EXECUTE for authenticated; 171/12).
-- Run it only with the gateway SOCIAL mode OFF (TORNEOS_SOCIAL_MODE absent): once it runs, the Studio export of the
-- web answers 403 permission denied. Nothing else is touched (proven by the postcondition). Re-running it is a no-op.
BEGIN;

CREATE TEMPORARY TABLE torneos_social_v1_rollback_state (
  fn text PRIMARY KEY,
  md5 text NOT NULL,
  attrs text NOT NULL
) ON COMMIT DROP;

DO $pre$
DECLARE
  v_fn constant regprocedure := 'public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)'::regprocedure;
  v_md5 text;
  v_auth integer;
  v_anon integer;
  v_rerun boolean;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = v_fn;
  -- 85bb4858… = SOCIAL-V1 body (0008); f211d9a2… = POST_0007 body (rollback already applied).
  IF v_md5 IS NULL OR v_md5 NOT IN ('85bb485891d9a2c046798f9eaa0cb649', 'f211d9a26d99448d4069c499c7508c55') THEN
    RAISE EXCEPTION 'TORNEOS_SOCIAL_V1_ROLLBACK_PRECONDITION_FAILED: unexpected authorize body md5 %', v_md5;
  END IF;
  v_rerun := v_md5 = 'f211d9a26d99448d4069c499c7508c55';
  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))
    INTO v_auth, v_anon
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
  IF (v_auth, v_anon) IS DISTINCT FROM (CASE WHEN v_rerun THEN 171 ELSE 172 END, 12)
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') IS DISTINCT FROM NOT v_rerun
     OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'TORNEOS_SOCIAL_V1_ROLLBACK_PRECONDITION_FAILED: ACL authenticated=% anon=%', v_auth, v_anon;
  END IF;
  INSERT INTO torneos_social_v1_rollback_state
  SELECT p.oid::regprocedure::text, md5(p.prosrc),
         concat_ws('|', p.prosecdef, p.provolatile, p.proconfig::text, p.proowner, p.proacl::text,
                   pg_get_function_result(p.oid), p.prolang)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE '%social%';
END $pre$;

CREATE OR REPLACE FUNCTION public.authorize_tournament_social_export(p_organization_id uuid, p_tournament_id uuid, p_piece text, p_theme text, p_include_arma2_branding boolean) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_season_id uuid;
  v_policy jsonb;
  v_premium boolean;
  v_effective_branding boolean;
begin
  select season_id into v_season_id from public.tournaments
  where organization_id=p_organization_id and id=p_tournament_id;
  if v_season_id is null
    or not public.has_tournament_season_access(p_organization_id,v_season_id)
    or not (public.has_tournament_social_capability(p_organization_id,'social.export') and public.has_tournament_season_access(p_organization_id, (select t.season_id from public.tournaments t where t.id = p_tournament_id and t.organization_id = p_organization_id))) then
    raise exception using errcode='42501',message='TORNEOS_SOCIAL_EXPORT_FORBIDDEN';
  end if;

  if p_theme not in ('base','heritage','street','scoreboard','editorial') then
    raise exception using errcode='22023',message='TORNEOS_SOCIAL_THEME_UNKNOWN';
  end if;
  if p_piece not in (
    'round_results','next_fixture','standings','mvp','final','champion',
    'scorers','discipline','best_eleven','round_summary','semifinals'
  ) then
    raise exception using errcode='22023',message='TORNEOS_SOCIAL_PIECE_UNKNOWN';
  end if;

  v_policy:=public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,v_season_id,now(),false,p_tournament_id
  );
  v_premium:=coalesce(
    (v_policy->'capabilities'->>'social_studio.premium')::boolean,
    false
  );

  if not v_premium and (
    p_theme <> 'base'
    or p_piece not in ('round_results','standings','next_fixture')
  ) then
    raise exception using errcode='42501',message='TORNEOS_SOCIAL_PREMIUM_REQUIRED';
  end if;

  if p_theme = 'base' then
    if not v_premium and not p_include_arma2_branding then
      raise exception using errcode='42501',message='TORNEOS_BRANDING_PREMIUM_REQUIRED';
    end if;
    v_effective_branding:=case when v_premium then p_include_arma2_branding else true end;
  else
    -- Every Premium theme is intrinsically white-label, irrespective of input.
    v_effective_branding:=false;
  end if;

  return jsonb_build_object(
    'authorized',true,
    'organizationId',p_organization_id,
    'seasonId',v_season_id,
    'tournamentId',p_tournament_id,
    'piece',p_piece,
    'theme',p_theme,
    'plan',v_policy->>'plan',
    'capability','social_studio.premium',
    'includeArma2Branding',v_effective_branding
  );
end;
$$;

REVOKE EXECUTE ON FUNCTION public.authorize_tournament_social_export(p_organization_id uuid, p_tournament_id uuid, p_piece text, p_theme text, p_include_arma2_branding boolean) FROM authenticated;

DO $post$
DECLARE
  v_fn constant regprocedure := 'public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)'::regprocedure;
  v_problems text[] := array[]::text[];
  v_auth integer;
  v_anon integer;
  v_row record;
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = v_fn) <> 'f211d9a26d99448d4069c499c7508c55' THEN
    v_problems := v_problems || 'authorize body is not the POST_0007 one'::text;
  END IF;
  IF has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    v_problems := v_problems || 'authorize ACL is not the POST_0007 one (service_role only)'::text;
  END IF;
  FOR v_row IN
    SELECT s.fn, s.md5, s.attrs, md5(p.prosrc) AS now_md5,
           concat_ws('|', p.prosecdef, p.provolatile, p.proconfig::text, p.proowner, p.proacl::text,
                     pg_get_function_result(p.oid), p.prolang) AS now_attrs
    FROM torneos_social_v1_rollback_state s JOIN pg_proc p ON p.oid = s.fn::regprocedure
    WHERE s.fn <> v_fn::text
  LOOP
    IF v_row.now_md5 <> v_row.md5 OR v_row.now_attrs <> v_row.attrs THEN
      v_problems := v_problems || format('%s changed', v_row.fn);
    END IF;
  END LOOP;
  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))
    INTO v_auth, v_anon
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
  IF (v_auth, v_anon) IS DISTINCT FROM (171, 12) THEN
    v_problems := v_problems || format('public ACL counts authenticated=%s anon=%s, expected 171/12', v_auth, v_anon);
  END IF;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'TORNEOS_SOCIAL_V1_ROLLBACK_POSTCONDITION_FAILED: %', array_to_string(v_problems, '; ');
  END IF;
END $post$;

COMMIT;
