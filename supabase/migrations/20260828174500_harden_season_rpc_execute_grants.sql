-- CREATE OR REPLACE restores PostgreSQL's default PUBLIC EXECUTE when a
-- function was introduced under a new identity. Close that implicit grant on
-- the season-filtered context and keep the internal at-time resolver callable
-- only through the authenticated projections that validate actor scope.
revoke all on function public.get_tournament_competition_context(uuid)
  from public,anon;
grant execute on function public.get_tournament_competition_context(uuid)
  to authenticated,service_role;

revoke all on function public.resolve_effective_tournament_season_entitlements_at(
  uuid,uuid,timestamptz,boolean,uuid
) from public,anon,authenticated;
grant execute on function public.resolve_effective_tournament_season_entitlements_at(
  uuid,uuid,timestamptz,boolean,uuid
) to service_role;
