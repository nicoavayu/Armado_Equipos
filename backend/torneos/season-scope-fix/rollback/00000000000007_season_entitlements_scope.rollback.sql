-- Arma2 Torneos — SEASON-SCOPE-FIX ROLLBACK (not a migration; documented, never applied automatically).
-- Restores the certified POST_0006 body of public.get_effective_tournament_season_entitlements(uuid,uuid) byte for byte
-- (md5 a533331a821dbbac90c6eedbc7b053b3). Nothing else changes (no grant, owner, attribute or other object).
-- Effect: the season-scope leak comes back (an organization owner gets HTTP 200 `null` for a season of another
-- organization). Only roll back while the gateway does NOT expose this RPC (TORNEOS_PLAN_READ_MODE off, Commerce off).
BEGIN;

CREATE TEMPORARY TABLE torneos_season_scope_fix_rollback_state (
  attrs text NOT NULL
) ON COMMIT DROP;

DO $pre$
DECLARE
  v_fn constant regprocedure := 'public.get_effective_tournament_season_entitlements(uuid,uuid)'::regprocedure;
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = v_fn;
  IF v_md5 NOT IN ('bf263acafb185ee0993117d5805bc701', 'a533331a821dbbac90c6eedbc7b053b3') THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_SCOPE_FIX_ROLLBACK_PRECONDITION_FAILED: unexpected body md5 %', v_md5;
  END IF;
  INSERT INTO torneos_season_scope_fix_rollback_state
  SELECT concat_ws('|', p.prosecdef, p.provolatile, p.proconfig::text, p.proowner, p.proacl::text,
                   pg_get_function_result(p.oid), p.prolang)
  FROM pg_proc p WHERE p.oid = v_fn;
END $pre$;

CREATE OR REPLACE FUNCTION public.get_effective_tournament_season_entitlements(p_organization_id uuid, p_season_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_result jsonb; v_usage integer;
begin
  if private.current_identity_id() is null then raise exception using errcode='42501',message='TORNEOS_AUTH_REQUIRED'; end if;
  if not public.has_tournament_season_access(p_organization_id,p_season_id) then
    raise exception using errcode='42501',message='TORNEOS_ENTITLEMENTS_FORBIDDEN';
  end if;
  v_result := public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,p_season_id,now(),false,null
  );
  select count(*)::integer into v_usage
  from public.tournament_season_member_assignments
  where organization_id=p_organization_id and season_id=p_season_id;
  return jsonb_set(v_result,'{administration,currentAdministrativeSeatUsage}',to_jsonb(v_usage),true);
end;
$$;

DO $post$
DECLARE
  v_fn constant regprocedure := 'public.get_effective_tournament_season_entitlements(uuid,uuid)'::regprocedure;
  v_md5 text;
  v_attrs text;
BEGIN
  SELECT md5(p.prosrc),
         concat_ws('|', p.prosecdef, p.provolatile, p.proconfig::text, p.proowner, p.proacl::text,
                   pg_get_function_result(p.oid), p.prolang)
    INTO v_md5, v_attrs
  FROM pg_proc p WHERE p.oid = v_fn;
  IF v_md5 <> 'a533331a821dbbac90c6eedbc7b053b3' THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_SCOPE_FIX_ROLLBACK_POSTCONDITION_FAILED: body md5 %', v_md5;
  END IF;
  IF v_attrs IS DISTINCT FROM (SELECT attrs FROM torneos_season_scope_fix_rollback_state) THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_SCOPE_FIX_ROLLBACK_POSTCONDITION_FAILED: owner, grants or attributes changed';
  END IF;
END $post$;

COMMIT;
