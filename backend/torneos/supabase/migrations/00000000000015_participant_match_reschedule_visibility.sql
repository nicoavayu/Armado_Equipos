-- Arma2 Torneos — PILOT 0015: a rescheduled match tells its participants the time it had before.
-- Independent of 00000000000012–00000000000014 (none of them touches these two reads): any order. Rollback (documented,
-- never automatic): backend/torneos/connected-v1/rollback/00000000000015_participant_match_reschedule_visibility.rollback.sql
--
-- Pilot run (2026-10-08): the organizer reschedules a match (reschedule_tournament_match keeps the history in
-- tournament_match_reschedules), but a player or a team manager only ever saw the new time: the history was readable
-- by the organization alone (get_tournament_schedule_context). Both participant reads now add `previousScheduledAt`,
-- the previous kickoff of the match's latest reschedule (null when it was never rescheduled). Only the time: the
-- organizer's internal reason, venue and court of the old slot stay in the organization's history.
--
-- Exactly two bodies change, each starting from its certified baseline text (md5 pinned below); ACL, owner, SECURITY
-- DEFINER and search_path are those of CREATE OR REPLACE (unchanged). No table, policy or grant changes.
BEGIN;

DO $pre$
DECLARE
  v_md5 text;
BEGIN
  IF to_regclass('public.tournament_match_reschedules') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0015_PRECONDITION_FAILED: tournament_match_reschedules is missing';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.get_player_tournament_matches()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '998cd63e1fb57ca63147ee556ae81783' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0015_PRECONDITION_FAILED: get_player_tournament_matches body is not the expected one (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.get_managed_tournament_matches()'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'ab7320d546b04e171868875d01beac2a' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0015_PRECONDITION_FAILED: get_managed_tournament_matches body is not the expected one (%)', v_md5;
  END IF;
END $pre$;

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
    'previousScheduledAt', last_reschedule.previous_scheduled_at,
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
  left join lateral (
    select reschedule.previous_scheduled_at
    from public.tournament_match_reschedules reschedule
    where reschedule.match_id = match_row.id and reschedule.previous_scheduled_at is not null
    order by reschedule.created_at desc
    limit 1
  ) last_reschedule on true
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
    'previousScheduledAt', last_reschedule.previous_scheduled_at,
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
  left join lateral (
    select reschedule.previous_scheduled_at
    from public.tournament_match_reschedules reschedule
    where reschedule.match_id = match_row.id and reschedule.previous_scheduled_at is not null
    order by reschedule.created_at desc
    limit 1
  ) last_reschedule on true
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
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.get_player_tournament_matches()'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'c997fcf5516a8bf8f518db0c3c99d335' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0015_POSTCONDITION_FAILED: get_player_tournament_matches body is not the expected one (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.get_managed_tournament_matches()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '54d543bd2fc8c697ed67654b2cbd0c46' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0015_POSTCONDITION_FAILED: get_managed_tournament_matches body is not the expected one (%)', v_md5;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid IN ('public.get_player_tournament_matches()'::regprocedure, 'public.get_managed_tournament_matches()'::regprocedure)
      AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0015_POSTCONDITION_FAILED: grants, SECURITY DEFINER or search_path changed';
  END IF;
END $post$;

COMMIT;
