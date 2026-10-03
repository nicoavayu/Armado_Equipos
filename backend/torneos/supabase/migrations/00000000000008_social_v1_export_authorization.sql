-- Arma2 Torneos — SOCIAL-V1: the Estudio Social export authorization becomes callable by `authenticated`, NULL-safe.
-- Applies after 00000000000000 … 00000000000007 (all unchanged). Append-only. Rollback (documented, never automatic):
-- backend/torneos/social-v1/rollback/00000000000008_social_v1_export_authorization.rollback.sql
--
-- Why (backend/torneos/social-v1/AUDIT.md, finding F1, reproduced in the lab on POST_0007):
--   public.authorize_tournament_social_export compared its inputs with `not in (…)` / `<>` / `=`. With a NULL theme
--   every comparison is NULL, no guard raises, and the Premium branch answers `authorized: true` with
--   `includeArma2Branding: false` — a FREE season authorised as white-label. A NULL piece was authorised the same way,
--   and a NULL branding flag made a PREMIUM answer `includeArma2Branding: null`.
--
-- What this migration does (one transaction, fail-closed pre/postconditions):
--   1. replaces ONLY the body of public.authorize_tournament_social_export(uuid,uuid,text,text,boolean): a NULL theme
--      is TORNEOS_SOCIAL_THEME_UNKNOWN, a NULL piece TORNEOS_SOCIAL_PIECE_UNKNOWN and a NULL branding flag
--      TORNEOS_SOCIAL_BRANDING_INVALID (22023). No coercion, no implicit default. The access check still runs first,
--      so an identity without access never learns anything about its inputs. Everything else in the body is
--      byte-identical: same signature, STABLE, SECURITY DEFINER, search_path '', owner;
--   2. GRANT EXECUTE on that single function TO authenticated (the only ACL change: 171 → 172 / anon 12).
-- The other three Social RPCs and the nine helpers are untouched (body md5 and ACL proven equal below).
-- set_tournament_social_permission keeps its baseline EXECUTE but is NOT part of SOCIAL-V1 (no UI consumer, not in
-- any gateway allowlist). Re-applying it is a no-op.
BEGIN;

CREATE TEMPORARY TABLE torneos_social_v1_state (
  fn text PRIMARY KEY,
  md5 text NOT NULL,
  attrs text NOT NULL
) ON COMMIT DROP;

CREATE TEMPORARY TABLE torneos_social_v1_acl (
  authenticated integer NOT NULL,
  anon integer NOT NULL
) ON COMMIT DROP;

DO $pre$
DECLARE
  v_fn constant regprocedure := 'public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)'::regprocedure;
  -- Social catalog at POST_0007 (backend/torneos/social-v1/evidence/catalog-post0007.txt): every function but the one
  -- this migration replaces must keep exactly this body.
  v_kept constant jsonb := jsonb_build_object(
    'public.current_user_tournament_social_capabilities(uuid)', '40ace2223c80ee45ffafd3033603b768',
    'public.get_tournament_social_snapshot(uuid,uuid,uuid,uuid,text,uuid,uuid)', '5640252b8bbf9aebb1575b48aa78db0a',
    'public.get_tournament_social_snapshot_plan_legacy(uuid,uuid,uuid,uuid,text,uuid,uuid)', 'e7606acb7df7381f81b9302aa3c987ae',
    'public.get_tournament_social_studio_context(uuid)', '860a6746dbf4b3a9fd29c3430ac8b8a7',
    'public.get_tournament_social_studio_context_organization_legacy(uuid)', '42287a3a4e91e5714cfdb20e0332ed23',
    'public.has_tournament_social_capability(uuid,text)', 'f7558d609734718f7131b9f9dc027a13',
    'public.set_tournament_social_permission(uuid,uuid,boolean)', '6bec22e64e5dd60a9303c42e5df17eda',
    'public.tournament_social_match_rows(uuid,uuid,uuid,boolean)', '37686ea2a0fe990907e50b09207486a8',
    'public.tournament_social_next_fixture(uuid,uuid,uuid)', '42e14685d1b169fc4c2dc0f61341e552',
    'public.tournament_social_player_candidates(uuid,jsonb)', 'f60726bbd0d3de5349dd07b48849d7c8',
    'public.tournament_social_published_scope(uuid,uuid,uuid,uuid)', 'e479c745bdeeb899140aef691fae79f6',
    'public.tournament_social_role_capabilities(text)', '2763a8313613bff6211867fb0be33512'
  );
  v_server_roles constant text[] := array['torneos_core_adapter', 'torneos_identity_writer', 'torneos_payment_service'];
  v_problems text[] := array[]::text[];
  v_md5 text;
  v_reapply boolean;
  v_auth integer;
  v_anon integer;
  v_key text;
  v_role text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = v_fn;
  -- f211d9a2… = certified POST_0007 body; 85bb4858… = this migration's body (re-apply).
  IF v_md5 IS NULL OR v_md5 NOT IN ('f211d9a26d99448d4069c499c7508c55', '85bb485891d9a2c046798f9eaa0cb649') THEN
    v_problems := v_problems || format('unexpected authorize body md5 %s', v_md5);
  END IF;
  v_reapply := v_md5 = '85bb485891d9a2c046798f9eaa0cb649';
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND p.prosecdef AND p.provolatile = 's'
                 AND p.proconfig = array['search_path=""'] AND pg_get_function_result(p.oid) = 'jsonb') THEN
    v_problems := v_problems || 'authorize is not STABLE SECURITY DEFINER search_path="" returning jsonb'::text;
  END IF;
  -- ACL of the function: closed (POST_0007) or opened by this migration (re-apply). Never anon / PUBLIC / server roles.
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') IS DISTINCT FROM v_reapply
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    v_problems := v_problems || 'authorize ACL is neither the POST_0007 one nor the SOCIAL-V1 one'::text;
  END IF;
  FOREACH v_role IN ARRAY v_server_roles LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) AND has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
      v_problems := v_problems || format('server role %s can execute authorize', v_role);
    END IF;
  END LOOP;
  FOR v_key IN SELECT jsonb_object_keys(v_kept) LOOP
    IF to_regprocedure(v_key) IS NULL THEN
      v_problems := v_problems || format('missing %s', v_key);
    ELSIF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(v_key)) <> v_kept->>v_key THEN
      v_problems := v_problems || format('unexpected body of %s', v_key);
    END IF;
  END LOOP;
  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))
    INTO v_auth, v_anon
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
  IF (v_auth, v_anon) IS DISTINCT FROM (CASE WHEN v_reapply THEN 172 ELSE 171 END, 12) THEN
    v_problems := v_problems || format('public ACL counts authenticated=%s anon=%s', v_auth, v_anon);
  END IF;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'TORNEOS_SOCIAL_V1_PRECONDITION_FAILED: %', array_to_string(v_problems, '; ');
  END IF;
  INSERT INTO torneos_social_v1_acl VALUES (v_auth, v_anon);
  INSERT INTO torneos_social_v1_state
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

  -- SOCIAL-V1: NULL is never a valid theme, piece or branding choice (no coercion, no implicit default).
  if p_theme is null or p_theme not in ('base','heritage','street','scoreboard','editorial') then
    raise exception using errcode='22023',message='TORNEOS_SOCIAL_THEME_UNKNOWN';
  end if;
  if p_piece is null or p_piece not in (
    'round_results','next_fixture','standings','mvp','final','champion',
    'scorers','discipline','best_eleven','round_summary','semifinals'
  ) then
    raise exception using errcode='22023',message='TORNEOS_SOCIAL_PIECE_UNKNOWN';
  end if;
  if p_include_arma2_branding is null then
    raise exception using errcode='22023',message='TORNEOS_SOCIAL_BRANDING_INVALID';
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

GRANT EXECUTE ON FUNCTION public.authorize_tournament_social_export(p_organization_id uuid, p_tournament_id uuid, p_piece text, p_theme text, p_include_arma2_branding boolean) TO authenticated;

DO $post$
DECLARE
  v_fn constant regprocedure := 'public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)'::regprocedure;
  v_server_roles constant text[] := array['torneos_core_adapter', 'torneos_identity_writer', 'torneos_payment_service'];
  v_problems text[] := array[]::text[];
  v_before torneos_social_v1_acl%ROWTYPE;
  v_auth integer;
  v_anon integer;
  v_role text;
  v_row record;
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = v_fn) <> '85bb485891d9a2c046798f9eaa0cb649' THEN
    v_problems := v_problems || 'authorize body is not the SOCIAL-V1 one'::text;
  END IF;
  -- Same attributes and owner as before; only the ACL may differ, and only by authenticated.
  IF (SELECT concat_ws('|', p.prosecdef, p.provolatile, p.proconfig::text, p.proowner, pg_get_function_result(p.oid), p.prolang)
      FROM pg_proc p WHERE p.oid = v_fn)
     IS DISTINCT FROM (SELECT split_part(attrs, '|', 1) || '|' || split_part(attrs, '|', 2) || '|' || split_part(attrs, '|', 3)
                              || '|' || split_part(attrs, '|', 4) || '|' || split_part(attrs, '|', 6) || '|' || split_part(attrs, '|', 7)
                       FROM torneos_social_v1_state WHERE fn = v_fn::text) THEN
    v_problems := v_problems || 'authorize attributes or owner changed'::text;
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    v_problems := v_problems || 'authorize must be EXECUTE for authenticated and service_role only'::text;
  END IF;
  FOREACH v_role IN ARRAY v_server_roles LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) AND has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
      v_problems := v_problems || format('server role %s can execute authorize', v_role);
    END IF;
  END LOOP;
  -- Every other Social function: body and ACL identical.
  FOR v_row IN
    SELECT s.fn, s.md5, s.attrs, md5(p.prosrc) AS now_md5,
           concat_ws('|', p.prosecdef, p.provolatile, p.proconfig::text, p.proowner, p.proacl::text,
                     pg_get_function_result(p.oid), p.prolang) AS now_attrs
    FROM torneos_social_v1_state s JOIN pg_proc p ON p.oid = s.fn::regprocedure
    WHERE s.fn <> v_fn::text
  LOOP
    IF v_row.now_md5 <> v_row.md5 OR v_row.now_attrs <> v_row.attrs THEN
      v_problems := v_problems || format('%s changed', v_row.fn);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE '%social%') <> (SELECT count(*) FROM torneos_social_v1_state) THEN
    v_problems := v_problems || 'the set of Social functions changed'::text;
  END IF;
  SELECT * INTO v_before FROM torneos_social_v1_acl;
  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))
    INTO v_auth, v_anon
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
  IF (v_auth, v_anon) IS DISTINCT FROM (172, 12) OR v_anon <> v_before.anon THEN
    v_problems := v_problems || format('public ACL counts authenticated=%s anon=%s, expected 172/12', v_auth, v_anon);
  END IF;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'TORNEOS_SOCIAL_V1_POSTCONDITION_FAILED: %', array_to_string(v_problems, '; ');
  END IF;
END $post$;

COMMIT;
