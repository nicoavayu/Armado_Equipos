  -- Phase 2A: organization membership alone does not authorize this season.
  if not exists (
    select 1 from public.tournaments scoped_tournament
    where scoped_tournament.id = p_tournament_id
      and scoped_tournament.organization_id = p_organization_id
      and public.has_tournament_season_access(p_organization_id, scoped_tournament.season_id)
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
