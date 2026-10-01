-- Arma2 Torneos — SEASON-SCOPE-FIX: get_effective_tournament_season_entitlements binds organization and season.
-- Applies after 00000000000000 … 00000000000006 (all unchanged). Append-only. Rollback (documented, never automatic):
-- backend/torneos/season-scope-fix/rollback/00000000000007_season_entitlements_scope.rollback.sql
--
-- Root cause (reproduced in a local lab on POST_0006, backend/torneos/season-scope-fix/REPORT.md):
--   • the RPC authorised with public.has_tournament_season_access(org, season) only. Its owner branch
--     (membership.role = 'owner') never looks at p_season_id, so an owner of organization A passes for ANY season id
--     (a season of organization B, a missing one, NULL);
--   • the RPC then called resolve_effective_tournament_season_entitlements_at, which does bind the pair and returns
--     NULL for a foreign season; the RPC passed that NULL to jsonb_set (NULL) and returned it. PostgREST answers a
--     NULL scalar as HTTP 200 with body `null`, so the cross-scope call was accepted instead of refused.
--   Non-owner members were already refused: their branch goes through tournament_season_member_assignments, whose
--   (organization_id, season_id) foreign key to tournament_seasons binds the pair.
--
-- What this migration does (one transaction, fail-closed pre/postconditions): it replaces ONLY the body of
-- public.get_effective_tournament_season_entitlements(uuid,uuid) so that
--   1. a NULL organization or season, or a pair with no tournament_seasons row (season.organization_id = org) is
--      refused with the existing 42501 TORNEOS_ENTITLEMENTS_FORBIDDEN before membership is evaluated;
--   2. a NULL resolution is refused the same way (fail closed: the RPC never answers 200 null).
-- Same signature, return type, language, volatility, SECURITY DEFINER, search_path, owner and grants (CREATE OR
-- REPLACE keeps owner and ACL; the postcondition proves it). has_tournament_season_access, the resolver, the
-- tournament RPC and every other object are untouched. Re-applying it is a no-op.
BEGIN;

CREATE TEMPORARY TABLE torneos_season_scope_fix_state (
  attrs text NOT NULL
) ON COMMIT DROP;

DO $pre$
DECLARE
  v_fn constant regprocedure := 'public.get_effective_tournament_season_entitlements(uuid,uuid)'::regprocedure;
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = v_fn;
  -- a533331a… = certified POST_0006 body; bf263aca… = this migration's body (re-apply).
  IF v_md5 NOT IN ('a533331a821dbbac90c6eedbc7b053b3', 'bf263acafb185ee0993117d5805bc701') THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_SCOPE_FIX_PRECONDITION_FAILED: unexpected body md5 %', v_md5;
  END IF;
  INSERT INTO torneos_season_scope_fix_state
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
  -- The (organization, season) pair must exist as such: has_tournament_season_access lets an organization owner
  -- through without looking at the season.
  if p_organization_id is null or p_season_id is null or not exists (
    select 1 from public.tournament_seasons season
    where season.organization_id=p_organization_id and season.id=p_season_id
  ) or not public.has_tournament_season_access(p_organization_id,p_season_id) then
    raise exception using errcode='42501',message='TORNEOS_ENTITLEMENTS_FORBIDDEN';
  end if;
  v_result := public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,p_season_id,now(),false,null
  );
  -- Fail closed: an unresolved scope is refused, never answered as 200 null.
  if v_result is null then
    raise exception using errcode='42501',message='TORNEOS_ENTITLEMENTS_FORBIDDEN';
  end if;
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
  IF v_md5 <> 'bf263acafb185ee0993117d5805bc701' THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_SCOPE_FIX_POSTCONDITION_FAILED: body md5 %', v_md5;
  END IF;
  IF v_attrs IS DISTINCT FROM (SELECT attrs FROM torneos_season_scope_fix_state) THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_SCOPE_FIX_POSTCONDITION_FAILED: owner, grants or attributes changed';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_SCOPE_FIX_POSTCONDITION_FAILED: EXECUTE must stay authenticated-only';
  END IF;
END $post$;

COMMIT;
