-- Core: invoker triggers must be able to call their own pure helpers.
--
-- 20260727215106 rebuilt the authenticated EXECUTE allowlist from scratch
-- (`revoke execute on all functions in schema public from authenticated`) and
-- listed client RPCs and RLS helpers, but not helpers called from SECURITY
-- INVOKER trigger functions. PostgreSQL checks EXECUTE on every function a
-- trigger body calls as the triggering role, so on any database built from
-- the repository migrations:
--   * every INSERT/UPDATE on public.usuarios by its own user fails with
--     "permission denied for function normalize_posicion_token" (profile edit,
--     onboarding, avatar, location, push preference...);
--   * every INSERT on public.challenges (and UPDATE of its squad columns)
--     fails with "permission denied for function resolve_challenge_squad_limits".
--
-- Production is not affected: its catalog keeps the historical
-- `GRANT ALL ... TO anon, authenticated, service_role` on both helpers (see the
-- ACL section of 20260727090000_arma2_canonical_baseline.sql). This migration
-- restores that parity for `authenticated` only; it is a no-op on Production.
--
-- Both functions are IMMUTABLE/pure: they read no table and return a value
-- derived only from their argument, so the grant exposes no data.
grant execute on function public.normalize_posicion_token(text) to authenticated;
grant execute on function public.resolve_challenge_squad_limits(smallint) to authenticated;

do $trigger_helper_execute_check$
begin
  if not has_function_privilege('authenticated', 'public.normalize_posicion_token(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.resolve_challenge_squad_limits(smallint)', 'execute') then
    raise exception 'trigger helper EXECUTE grant did not apply';
  end if;
  -- anon is not asserted: Core Production keeps its historical grants on these pure helpers
  -- (see above); the repository schema has them closed. Neither exposes data.
end
$trigger_helper_execute_check$;
