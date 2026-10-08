-- Rollback of PILOT 0015: restores the two certified baseline bodies (no previousScheduledAt). Never automatic.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_player_tournament_matches() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'matchId', match_row.id,
    'organizationId', match_row.organization_id,
    'tournamentId', match_row.tournament_id,
    'categoryId', match_row.category_id,
    'teamEntryId', player.team_entry_id,
    'teamName', own_entry.name,
    'opponentName', opponent_entry.name,
    'isHome', player.team_entry_id = teams.home_team_entry_id,
    'scheduledAt', match_row.scheduled_at,
    'status', match_row.status,
    'venue', venue.name,
    'court', court.name,
    'availability', availability.response,
    'callupStatus', squad_player.callup_status,
    'lineupStatus', squad_player.lineup_status,
    'squadStatus', squad.status,
    'officialScore', case when operation.status = 'official'
      then jsonb_build_object('home', score.home_score, 'away', score.away_score)
      else null end
  ) order by match_row.scheduled_at nulls last), '[]'::jsonb)
  from public.tournament_roster_players player
  join public.tournament_rosters roster
    on roster.id = player.roster_id and roster.status in ('approved', 'locked')
  join public.tournament_competition_participants own_participant
    on own_participant.team_entry_id = player.team_entry_id
    and own_participant.status = 'active'
  join public.tournament_matches match_row
    on own_participant.id in (match_row.home_participant_id, match_row.away_participant_id)
  join public.tournament_fixture_versions fixture
    on fixture.id = match_row.fixture_version_id and fixture.status = 'published'
  cross join lateral public.tournament_match_team_entries(match_row.id) teams
  join public.tournament_team_entries own_entry on own_entry.id = player.team_entry_id
  join public.tournament_team_entries opponent_entry
    on opponent_entry.id = case
      when player.team_entry_id = teams.home_team_entry_id then teams.away_team_entry_id
      else teams.home_team_entry_id end
  left join public.tournament_venues venue on venue.id = match_row.venue_id
  left join public.tournament_courts court on court.id = match_row.court_id
  left join public.tournament_match_availability_responses availability
    on availability.match_id = match_row.id
    and availability.roster_player_id = player.id
  left join public.tournament_match_squads squad
    on squad.match_id = match_row.id and squad.team_entry_id = player.team_entry_id
    and squad.status <> 'superseded'
  left join public.tournament_match_squad_players squad_player
    on squad_player.match_squad_id = squad.id and squad_player.roster_player_id = player.id
  left join public.tournament_match_operations operation
    on operation.match_id = match_row.id and operation.status = 'official'
  left join public.tournament_match_scores score
    on score.match_operation_id = operation.id
  where private.current_identity_id() is not null
    and player.arma2_user_id = private.current_identity_id()
    and player.status = 'active'
    and player.eligibility_status = 'eligible'
    and match_row.status in ('scheduled', 'ready', 'postponed', 'cancelled');
$function$;

CREATE OR REPLACE FUNCTION public.get_managed_tournament_matches() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'matchId', match_row.id,
    'organizationId', match_row.organization_id,
    'tournamentId', match_row.tournament_id,
    'categoryId', match_row.category_id,
    'teamEntryId', manager.team_entry_id,
    'teamName', own_entry.name,
    'opponentName', opponent_entry.name,
    'isHome', manager.team_entry_id = teams.home_team_entry_id,
    'scheduledAt', match_row.scheduled_at,
    'status', match_row.status,
    'venue', venue.name,
    'court', court.name,
    'squadStatus', squad.status,
    'canManageSquad', manager.role in ('captain', 'delegate'),
    'officialScore', case when operation.status = 'official'
      then jsonb_build_object('home', score.home_score, 'away', score.away_score)
      else null end
  ) order by match_row.scheduled_at nulls last), '[]'::jsonb)
  from public.tournament_team_managers manager
  join public.tournament_competition_participants own_participant
    on own_participant.team_entry_id = manager.team_entry_id
    and own_participant.status = 'active'
  join public.tournament_matches match_row
    on own_participant.id in (match_row.home_participant_id, match_row.away_participant_id)
  join public.tournament_fixture_versions fixture
    on fixture.id = match_row.fixture_version_id and fixture.status = 'published'
  cross join lateral public.tournament_match_team_entries(match_row.id) teams
  join public.tournament_team_entries own_entry on own_entry.id = manager.team_entry_id
  join public.tournament_team_entries opponent_entry
    on opponent_entry.id = case
      when manager.team_entry_id = teams.home_team_entry_id then teams.away_team_entry_id
      else teams.home_team_entry_id end
  left join public.tournament_venues venue on venue.id = match_row.venue_id
  left join public.tournament_courts court on court.id = match_row.court_id
  left join public.tournament_match_squads squad
    on squad.match_id = match_row.id and squad.team_entry_id = manager.team_entry_id
    and squad.status <> 'superseded'
  left join public.tournament_match_operations operation
    on operation.match_id = match_row.id and operation.status = 'official'
  left join public.tournament_match_scores score
    on score.match_operation_id = operation.id
  where private.current_identity_id() is not null
    and manager.user_id = private.current_identity_id()
    and manager.status = 'active'
    and manager.role in ('captain', 'delegate')
    and match_row.status in ('scheduled', 'ready', 'postponed', 'cancelled');
$function$;

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_player_tournament_matches()'::regprocedure) IS DISTINCT FROM '998cd63e1fb57ca63147ee556ae81783'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_managed_tournament_matches()'::regprocedure) IS DISTINCT FROM 'ab7320d546b04e171868875d01beac2a' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0015_ROLLBACK_FAILED: baseline bodies not restored';
  END IF;
END $post$;

COMMIT;
