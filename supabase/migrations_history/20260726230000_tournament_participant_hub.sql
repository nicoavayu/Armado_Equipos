-- Arma2 Torneos: authenticated participant hub and published read models.
-- Local/dedicated staging only. Never apply this migration to production.

create table public.tournament_participant_hub_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, tournament_id),
  constraint tournament_participant_hub_preferences_tournament_fk
    foreign key (organization_id, tournament_id)
    references public.tournaments(organization_id, id) on delete cascade,
  constraint tournament_participant_hub_preferences_category_fk
    foreign key (organization_id, tournament_id, category_id)
    references public.tournament_categories(organization_id, tournament_id, id)
    on delete cascade
);

create index tournament_participant_hub_preferences_scope_idx
  on public.tournament_participant_hub_preferences
  (organization_id, tournament_id, category_id, user_id);

create index tournament_roster_players_user_active_idx
  on public.tournament_roster_players (arma2_user_id, team_entry_id, roster_id)
  where status = 'active' and arma2_user_id is not null;

create index tournament_provisional_players_claimed_user_idx
  on public.tournament_provisional_players (claimed_by_user_id, id)
  where claim_status = 'claimed' and claimed_by_user_id is not null;

create index tournament_roster_players_provisional_active_idx
  on public.tournament_roster_players
  (provisional_player_id, team_entry_id, roster_id)
  where status = 'active' and provisional_player_id is not null;

create index tournament_matches_participant_feed_idx
  on public.tournament_matches
  (fixture_version_id, scheduled_at, match_number);

alter table public.tournament_participant_hub_preferences enable row level security;

create or replace function public.get_my_current_tournament_roster_players()
returns table (
  roster_player_id uuid,
  team_entry_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select player.id, player.team_entry_id
  from public.tournament_roster_players player
  join public.tournament_rosters roster
    on roster.id = player.roster_id
   and roster.organization_id = player.organization_id
   and roster.team_entry_id = player.team_entry_id
   and roster.status in ('approved', 'locked')
  where player.arma2_user_id = auth.uid()
    and player.status = 'active'
  union all
  select player.id, player.team_entry_id
  from public.tournament_provisional_players provisional
  join public.tournament_roster_players player
    on player.organization_id = provisional.organization_id
   and player.provisional_player_id = provisional.id
   and player.status = 'active'
  join public.tournament_rosters roster
    on roster.id = player.roster_id
   and roster.organization_id = player.organization_id
   and roster.team_entry_id = player.team_entry_id
   and roster.status in ('approved', 'locked')
  where provisional.claimed_by_user_id = auth.uid()
    and provisional.claim_status = 'claimed';
$$;

create or replace function public.can_read_tournament_participant_hub(
  p_tournament_id uuid,
  p_category_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournaments tournament
    join public.tournament_organizations organization
      on organization.id = tournament.organization_id
    where tournament.id = p_tournament_id
      and organization.status = 'active'
      and (
        p_category_id is null
        or exists (
          select 1
          from public.tournament_categories category
          where category.id = p_category_id
            and category.organization_id = tournament.organization_id
            and category.tournament_id = tournament.id
            and category.status = 'active'
        )
      )
      and (
        exists (
          select 1
          from public.tournament_organization_members membership
          where membership.organization_id = tournament.organization_id
            and membership.user_id = auth.uid()
            and membership.status = 'active'
        )
        or exists (
          select 1
          from public.tournament_team_entries entry
          join public.tournament_team_managers manager
            on manager.organization_id = entry.organization_id
           and manager.team_entry_id = entry.id
          where entry.tournament_id = tournament.id
            and entry.organization_id = tournament.organization_id
            and entry.status = 'approved'
            and (p_category_id is null or entry.category_id = p_category_id)
            and manager.user_id = auth.uid()
            and manager.status = 'active'
            and manager.role in ('captain', 'delegate')
        )
        or exists (
          select 1
          from public.tournament_team_entries entry
          join public.get_my_current_tournament_roster_players() player
            on player.team_entry_id = entry.id
          where entry.tournament_id = tournament.id
            and entry.organization_id = tournament.organization_id
            and entry.status = 'approved'
            and (p_category_id is null or entry.category_id = p_category_id)
        )
      )
  );
$$;

create or replace function public.set_my_tournament_hub_category(
  p_tournament_id uuid,
  p_category_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;

  select tournament.organization_id, category.name category_name
  into v_scope
  from public.tournaments tournament
  join public.tournament_categories category
    on category.organization_id = tournament.organization_id
   and category.tournament_id = tournament.id
   and category.id = p_category_id
   and category.status = 'active'
  where tournament.id = p_tournament_id;

  if v_scope.organization_id is null
    or not public.can_read_tournament_participant_hub(
      p_tournament_id,
      p_category_id
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_HUB_FORBIDDEN';
  end if;

  insert into public.tournament_participant_hub_preferences (
    user_id,
    organization_id,
    tournament_id,
    category_id
  )
  values (
    auth.uid(),
    v_scope.organization_id,
    p_tournament_id,
    p_category_id
  )
  on conflict (user_id, tournament_id)
  do update
  set organization_id = excluded.organization_id,
      category_id = excluded.category_id,
      updated_at = now();

  return jsonb_build_object(
    'tournamentId', p_tournament_id,
    'categoryId', p_category_id,
    'categoryName', v_scope.category_name,
    'updatedAt', now()
  );
end;
$$;

create or replace function public.get_published_tournament_matches(
  p_tournament_id uuid,
  p_category_id uuid,
  p_view text default 'all',
  p_team_entry_id uuid default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_is_historical boolean := false;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if coalesce(p_view, 'all') not in ('all', 'upcoming', 'results') then
    raise exception using errcode = '22023', message = 'TORNEOS_HUB_INVALID_FILTER';
  end if;
  if not public.can_read_tournament_participant_hub(
    p_tournament_id,
    p_category_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_HUB_FORBIDDEN';
  end if;

  select
    tournament.status in ('completed', 'archived')
      or season.status = 'archived'
  into v_is_historical
  from public.tournaments tournament
  join public.tournament_seasons season
    on season.organization_id = tournament.organization_id
   and season.id = tournament.season_id
  where tournament.id = p_tournament_id;

  select fixture.id
  into v_fixture_id
  from public.tournament_fixture_versions fixture
  where fixture.tournament_id = p_tournament_id
    and fixture.category_id = p_category_id
    and fixture.status = 'published';

  if p_team_entry_id is not null and not exists (
    select 1
    from public.tournament_team_entries entry
    where entry.id = p_team_entry_id
      and entry.tournament_id = p_tournament_id
      and entry.category_id = p_category_id
      and entry.status = 'approved'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_HUB_FORBIDDEN';
  end if;

  with feed as (
    select
      match_row.id match_id,
      match_row.match_number,
      match_row.status,
      match_row.scheduled_at,
      match_row.duration_minutes,
      round_row.id round_id,
      round_row.round_number,
      round_row.name round_name,
      phase.id phase_id,
      phase.name phase_name,
      group_row.id group_id,
      group_row.name group_name,
      venue.name venue_name,
      venue.address venue_address,
      court.name court_name,
      home.id home_participant_id,
      home.team_entry_id home_team_entry_id,
      home.snapshot_name home_name,
      home.snapshot_short_name home_short_name,
      home.snapshot_shield_path home_shield_path,
      away.id away_participant_id,
      away.team_entry_id away_team_entry_id,
      away.snapshot_name away_name,
      away.snapshot_short_name away_short_name,
      away.snapshot_shield_path away_shield_path,
      operation.id operation_id,
      operation.official_at,
      outcome.outcome_type,
      score.home_score,
      score.away_score,
      score.home_penalties,
      score.away_penalties,
      self_player.roster_player_id my_roster_player_id,
      self_player.team_entry_id my_team_entry_id,
      availability.response my_availability,
      squad_player.callup_status my_callup_status,
      squad_player.lineup_status my_lineup_status,
      count(*) over () total_count
    from public.tournament_matches match_row
    join public.tournament_rounds round_row on round_row.id = match_row.round_id
    join public.tournament_phases phase on phase.id = match_row.phase_id
    left join public.tournament_groups group_row on group_row.id = match_row.group_id
    left join public.tournament_venues venue on venue.id = match_row.venue_id
    left join public.tournament_courts court on court.id = match_row.court_id
    left join public.tournament_competition_participants home
      on home.id = match_row.home_participant_id
    left join public.tournament_competition_participants away
      on away.id = match_row.away_participant_id
    left join lateral (
      select official.id, official.official_at
      from public.tournament_match_operations official
      where official.match_id = match_row.id
        and official.status = 'official'
      limit 1
    ) operation on true
    left join public.tournament_match_outcomes outcome
      on outcome.match_operation_id = operation.id
    left join public.tournament_match_scores score
      on score.match_operation_id = operation.id
    left join lateral (
      select
        player.roster_player_id,
        player.team_entry_id
      from public.get_my_current_tournament_roster_players() player
      where player.team_entry_id in (home.team_entry_id, away.team_entry_id)
      order by player.team_entry_id
      limit 1
    ) self_player on true
    left join public.tournament_match_availability_responses availability
      on availability.match_id = match_row.id
     and availability.roster_player_id = self_player.roster_player_id
    left join public.tournament_match_squads squad
      on squad.match_id = match_row.id
     and squad.team_entry_id = self_player.team_entry_id
     and squad.status in ('submitted', 'locked')
    left join public.tournament_match_squad_players squad_player
      on squad_player.match_squad_id = squad.id
     and squad_player.roster_player_id = self_player.roster_player_id
    where match_row.fixture_version_id = v_fixture_id
      and (
        p_team_entry_id is null
        or home.team_entry_id = p_team_entry_id
        or away.team_entry_id = p_team_entry_id
      )
      and (
        p_view = 'all'
        or (
          p_view = 'upcoming'
          and operation.id is null
          and match_row.status in ('scheduled', 'ready', 'postponed')
        )
        or (p_view = 'results' and operation.id is not null)
      )
  ),
  paged as (
    select *
    from feed
    order by
      case when operation_id is null then 0 else 1 end,
      case when operation_id is null then scheduled_at end asc nulls last,
      official_at desc nulls last,
      match_number
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'matchId', match_id,
      'matchNumber', match_number,
      'status', case when operation_id is not null then 'official' else status end,
      'scheduledAt', scheduled_at,
      'durationMinutes', duration_minutes,
      'round', jsonb_build_object(
        'id', round_id,
        'number', round_number,
        'name', round_name
      ),
      'phase', jsonb_build_object('id', phase_id, 'name', phase_name),
      'group', case when group_id is null then null else jsonb_build_object(
        'id', group_id,
        'name', group_name
      ) end,
      'venue', case when venue_name is null then null else jsonb_build_object(
        'name', venue_name,
        'address', venue_address,
        'courtName', court_name
      ) end,
      'home', jsonb_build_object(
        'participantId', home_participant_id,
        'teamEntryId', home_team_entry_id,
        'name', home_name,
        'shortName', home_short_name,
        'shieldPath', home_shield_path
      ),
      'away', jsonb_build_object(
        'participantId', away_participant_id,
        'teamEntryId', away_team_entry_id,
        'name', away_name,
        'shortName', away_short_name,
        'shieldPath', away_shield_path
      ),
      'result', case when operation_id is null then null else jsonb_build_object(
        'home', home_score,
        'away', away_score,
        'homePenalties', home_penalties,
        'awayPenalties', away_penalties,
        'outcomeType', outcome_type,
        'officialAt', official_at
      ) end,
      'isMyTeam', my_team_entry_id is not null,
      'myTeamEntryId', my_team_entry_id,
      'myAvailability', case
        when v_is_historical then null
        else my_availability
      end,
      'myCallupStatus', case
        when v_is_historical then null
        else my_callup_status
      end,
      'myLineupStatus', case
        when v_is_historical then null
        else my_lineup_status
      end
    ) order by
      case when operation_id is null then 0 else 1 end,
      case when operation_id is null then scheduled_at end asc nulls last,
      official_at desc nulls last,
      match_number), '[]'::jsonb),
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', coalesce(max(total_count), 0),
      'hasMore', v_offset + count(*) < coalesce(max(total_count), 0)
    ),
    'hasPublishedFixture', v_fixture_id is not null
  )
  into v_result
  from paged;

  return coalesce(v_result, jsonb_build_object(
    'items', '[]'::jsonb,
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', 0,
      'hasMore', false
    ),
    'hasPublishedFixture', v_fixture_id is not null
  ));
end;
$$;

create or replace function public.get_tournament_participant_match(
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match record;
  v_operation_id uuid;
  v_my_player_id uuid;
  v_my_team_id uuid;
  v_is_historical boolean := false;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;

  select
    match_row.id,
    match_row.tournament_id,
    match_row.category_id,
    match_row.match_number,
    match_row.status,
    match_row.scheduled_at,
    match_row.duration_minutes,
    round_row.name round_name,
    round_row.round_number,
    phase.name phase_name, group_row.name group_name,
    venue.name venue_name, venue.address venue_address, court.name court_name,
    home.team_entry_id home_team_entry_id, home.snapshot_name home_name,
    home.snapshot_short_name home_short_name,
    home.snapshot_shield_path home_shield_path,
    away.team_entry_id away_team_entry_id, away.snapshot_name away_name,
    away.snapshot_short_name away_short_name,
    away.snapshot_shield_path away_shield_path
  into v_match
  from public.tournament_matches match_row
  join public.tournament_fixture_versions fixture
    on fixture.id = match_row.fixture_version_id
   and fixture.status = 'published'
  join public.tournament_rounds round_row on round_row.id = match_row.round_id
  join public.tournament_phases phase on phase.id = match_row.phase_id
  left join public.tournament_groups group_row on group_row.id = match_row.group_id
  left join public.tournament_venues venue on venue.id = match_row.venue_id
  left join public.tournament_courts court on court.id = match_row.court_id
  left join public.tournament_competition_participants home
    on home.id = match_row.home_participant_id
  left join public.tournament_competition_participants away
    on away.id = match_row.away_participant_id
  where match_row.id = p_match_id;

  if v_match.id is null
    or not public.can_read_tournament_participant_hub(
      v_match.tournament_id,
      v_match.category_id
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_HUB_FORBIDDEN';
  end if;

  select
    tournament.status in ('completed', 'archived')
      or season.status = 'archived'
  into v_is_historical
  from public.tournaments tournament
  join public.tournament_seasons season
    on season.organization_id = tournament.organization_id
   and season.id = tournament.season_id
  where tournament.id = v_match.tournament_id;

  select player.roster_player_id, player.team_entry_id
  into v_my_player_id, v_my_team_id
  from public.get_my_current_tournament_roster_players() player
  where player.team_entry_id in (
      v_match.home_team_entry_id,
      v_match.away_team_entry_id
    )
  order by player.team_entry_id
  limit 1;

  select operation.id
  into v_operation_id
  from public.tournament_match_operations operation
  where operation.match_id = p_match_id
    and operation.status = 'official'
  limit 1;

  select jsonb_build_object(
    'matchId', v_match.id,
    'tournamentId', v_match.tournament_id,
    'categoryId', v_match.category_id,
    'matchNumber', v_match.match_number,
    'status', case when v_operation_id is not null then 'official' else v_match.status end,
    'scheduledAt', v_match.scheduled_at,
    'durationMinutes', v_match.duration_minutes,
    'round', jsonb_build_object(
      'number', v_match.round_number,
      'name', v_match.round_name
    ),
    'phaseName', v_match.phase_name,
    'groupName', v_match.group_name,
    'venue', case when v_match.venue_name is null then null else jsonb_build_object(
      'name', v_match.venue_name,
      'address', v_match.venue_address,
      'courtName', v_match.court_name
    ) end,
    'home', jsonb_build_object(
      'teamEntryId', v_match.home_team_entry_id,
      'name', v_match.home_name,
      'shortName', v_match.home_short_name,
      'shieldPath', v_match.home_shield_path
    ),
    'away', jsonb_build_object(
      'teamEntryId', v_match.away_team_entry_id,
      'name', v_match.away_name,
      'shortName', v_match.away_short_name,
      'shieldPath', v_match.away_shield_path
    ),
    'result', (
      select jsonb_build_object(
        'home', score.home_score,
        'away', score.away_score,
        'homePenalties', score.home_penalties,
        'awayPenalties', score.away_penalties,
        'outcomeType', outcome.outcome_type,
        'officialAt', operation.official_at
      )
      from public.tournament_match_operations operation
      join public.tournament_match_outcomes outcome
        on outcome.match_operation_id = operation.id
      left join public.tournament_match_scores score
        on score.match_operation_id = operation.id
      where operation.id = v_operation_id
    ),
    'officialEvents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', event.id,
        'type', event.event_type,
        'minute', event.minute,
        'period', event.period,
        'teamEntryId', event.team_entry_id,
        'playerName', player.display_name_snapshot,
        'sequence', event.sequence_number
      ) order by event.sequence_number), '[]'::jsonb)
      from public.tournament_match_events event
      left join public.tournament_match_operation_players player
        on player.match_operation_id = event.match_operation_id
       and player.roster_player_id = event.roster_player_id
      join public.tournament_match_outcomes outcome
        on outcome.match_operation_id = event.match_operation_id
       and outcome.events_remain_valid
      where event.match_operation_id = v_operation_id
        and event.voided_at is null
        and event.event_type in (
          'goal', 'own_goal', 'assist', 'penalty_goal', 'penalty_missed',
          'yellow_card', 'second_yellow', 'red_card'
        )
    ),
    'officialLineups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'teamEntryId', player.team_entry_id,
        'rosterPlayerId', player.roster_player_id,
        'displayName', player.display_name_snapshot,
        'shirtNumber', player.shirt_number_snapshot,
        'position', player.position_snapshot,
        'lineupStatus', player.lineup_status,
        'isCaptain', player.is_captain
      ) order by player.team_entry_id, player.lineup_status, player.display_name_snapshot), '[]'::jsonb)
      from public.tournament_match_operation_players player
      where player.match_operation_id = v_operation_id
        and player.attendance_status in ('present', 'late')
        and player.lineup_status in ('starter', 'substitute')
    ),
    'myContext', case
      when v_my_player_id is null or v_is_historical then null
      else jsonb_build_object(
      'teamEntryId', v_my_team_id,
      'rosterPlayerId', v_my_player_id,
      'availability', (
        select response.response
        from public.tournament_match_availability_responses response
        where response.match_id = p_match_id
          and response.roster_player_id = v_my_player_id
      ),
      'callup', (
        select jsonb_build_object(
          'status', squad_player.callup_status,
          'lineupStatus', squad_player.lineup_status,
          'isCaptain', squad_player.is_captain,
          'attendanceStatus', case
            when v_operation_id is null then null
            else squad_player.attendance_status
          end
        )
        from public.tournament_match_squads squad
        join public.tournament_match_squad_players squad_player
          on squad_player.match_squad_id = squad.id
         and squad_player.roster_player_id = v_my_player_id
        where squad.match_id = p_match_id
          and squad.team_entry_id = v_my_team_id
          and squad.status in ('submitted', 'locked')
        limit 1
      ),
      'suspensions', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', suspension.id,
          'reason', suspension.reason,
          'remainingMatches', greatest(
            suspension.total_matches - suspension.served_matches,
            0
          ),
          'status', suspension.status
        ) order by suspension.created_at), '[]'::jsonb)
        from public.tournament_player_suspensions suspension
        join public.tournament_standings_revisions revision
          on revision.id = suspension.revision_id
         and revision.status = 'published'
        where suspension.roster_player_id = v_my_player_id
          and suspension.tournament_id = v_match.tournament_id
          and suspension.category_id = v_match.category_id
          and suspension.status in ('active', 'reduced')
      )
    ) end
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.get_tournament_participant_hub(
  p_tournament_id uuid,
  p_category_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament record;
  v_category_id uuid;
  v_fixture_id uuid;
  v_revision_id uuid;
  v_phase_id uuid;
  v_group_id uuid;
  v_my_team_id uuid;
  v_my_player_id uuid;
  v_manager_role text;
  v_organization_role text;
  v_is_historical boolean := false;
  v_can_read_team_private boolean := false;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;

  select
    tournament.id,
    tournament.organization_id,
    tournament.season_id,
    tournament.name,
    tournament.description,
    tournament.status,
    tournament.sport_modality,
    tournament.competition_format,
    tournament.start_date,
    tournament.end_date,
    season.name season_name,
    season.status season_status,
    organization.name organization_name,
    organization.logo_path
  into v_tournament
  from public.tournaments tournament
  join public.tournament_seasons season
    on season.organization_id = tournament.organization_id
   and season.id = tournament.season_id
  join public.tournament_organizations organization
    on organization.id = tournament.organization_id
   and organization.status = 'active'
  where tournament.id = p_tournament_id;

  if v_tournament.id is null
    or not public.can_read_tournament_participant_hub(p_tournament_id, null)
  then
    raise exception using errcode = '42501', message = 'TORNEOS_HUB_FORBIDDEN';
  end if;

  select membership.role
  into v_organization_role
  from public.tournament_organization_members membership
  where membership.organization_id = v_tournament.organization_id
    and membership.user_id = auth.uid()
    and membership.status = 'active';

  if p_category_id is not null then
    if not public.can_read_tournament_participant_hub(
      p_tournament_id,
      p_category_id
    ) then
      raise exception using errcode = '42501', message = 'TORNEOS_HUB_FORBIDDEN';
    end if;
    v_category_id := p_category_id;
  else
    select preference.category_id
    into v_category_id
    from public.tournament_participant_hub_preferences preference
    where preference.user_id = auth.uid()
      and preference.tournament_id = p_tournament_id
      and public.can_read_tournament_participant_hub(
        p_tournament_id,
        preference.category_id
      );

    if v_category_id is null then
      select entry.category_id
      into v_category_id
      from public.tournament_team_entries entry
      left join public.get_my_current_tournament_roster_players() player
        on player.team_entry_id = entry.id
      left join public.tournament_team_managers manager
        on manager.organization_id = entry.organization_id
       and manager.team_entry_id = entry.id
       and manager.user_id = auth.uid()
       and manager.status = 'active'
       and manager.role in ('captain', 'delegate')
      where entry.organization_id = v_tournament.organization_id
        and entry.tournament_id = p_tournament_id
        and entry.status = 'approved'
        and (player.roster_player_id is not null or manager.id is not null)
      order by (player.roster_player_id is not null) desc, entry.name
      limit 1;
    end if;

    if v_category_id is null and v_organization_role is not null then
      select category.id
      into v_category_id
      from public.tournament_categories category
      where category.organization_id = v_tournament.organization_id
        and category.tournament_id = p_tournament_id
        and category.status = 'active'
      order by category.sort_order, category.name
      limit 1;
    end if;
  end if;

  if v_category_id is null
    or not public.can_read_tournament_participant_hub(
      p_tournament_id,
      v_category_id
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_HUB_FORBIDDEN';
  end if;

  select fixture.id
  into v_fixture_id
  from public.tournament_fixture_versions fixture
  where fixture.organization_id = v_tournament.organization_id
    and fixture.tournament_id = p_tournament_id
    and fixture.category_id = v_category_id
    and fixture.status = 'published';

  select entry.id, player.roster_player_id, manager.role
  into v_my_team_id, v_my_player_id, v_manager_role
  from public.tournament_team_entries entry
  left join public.get_my_current_tournament_roster_players() player
    on player.team_entry_id = entry.id
  left join public.tournament_team_managers manager
    on manager.organization_id = entry.organization_id
   and manager.team_entry_id = entry.id
   and manager.user_id = auth.uid()
   and manager.status = 'active'
   and manager.role in ('captain', 'delegate')
  where entry.organization_id = v_tournament.organization_id
    and entry.tournament_id = p_tournament_id
    and entry.category_id = v_category_id
    and entry.status = 'approved'
    and (player.roster_player_id is not null or manager.id is not null)
  order by
    (player.roster_player_id is not null) desc,
    (manager.id is not null) desc,
    entry.name
  limit 1;

  v_is_historical := v_tournament.status in ('completed', 'archived')
    or v_tournament.season_status = 'archived';
  v_can_read_team_private := not v_is_historical
    and v_manager_role in ('captain', 'delegate');

  select revision.id, revision.phase_id, revision.group_id
  into v_revision_id, v_phase_id, v_group_id
  from public.tournament_standings_revisions revision
  join public.tournament_phases phase on phase.id = revision.phase_id
  where revision.fixture_version_id = v_fixture_id
    and revision.status = 'published'
  order by phase.sequence_number desc, revision.group_id nulls first,
    revision.revision_number desc
  limit 1;

  select jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', v_tournament.id,
      'organizationId', v_tournament.organization_id,
      'organizationName', v_tournament.organization_name,
      'name', v_tournament.name,
      'description', v_tournament.description,
      'status', v_tournament.status,
      'seasonName', v_tournament.season_name,
      'seasonStatus', v_tournament.season_status,
      'sportModality', v_tournament.sport_modality,
      'competitionFormat', v_tournament.competition_format,
      'startDate', v_tournament.start_date,
      'endDate', v_tournament.end_date,
      'logoPath', v_tournament.logo_path,
      'readOnly', v_is_historical
    ),
    'audience', jsonb_build_object(
      'organizationRole', v_organization_role,
      'managerRole', v_manager_role,
      'isPlayer', v_my_player_id is not null,
      'canManageTournament', public.has_tournament_organization_capability(
        v_tournament.organization_id,
        'tournaments.update'
      ),
      'canManageTeam', v_can_read_team_private
    ),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', category.id,
        'name', category.name,
        'slug', category.slug,
        'description', category.description,
        'sportModality', coalesce(
          category.sport_modality,
          v_tournament.sport_modality
        ),
        'teamSize', category.team_size
      ) order by category.sort_order, category.name), '[]'::jsonb)
      from public.tournament_categories category
      where category.organization_id = v_tournament.organization_id
        and category.tournament_id = p_tournament_id
        and category.status = 'active'
        and (
          v_organization_role is not null
          or exists (
            select 1
            from public.tournament_team_entries entry
            left join public.get_my_current_tournament_roster_players() player
              on player.team_entry_id = entry.id
            left join public.tournament_team_managers manager
              on manager.organization_id = entry.organization_id
             and manager.team_entry_id = entry.id
             and manager.user_id = auth.uid()
             and manager.status = 'active'
             and manager.role in ('captain', 'delegate')
            where entry.tournament_id = p_tournament_id
              and entry.category_id = category.id
              and entry.status = 'approved'
              and (
                player.roster_player_id is not null
                or manager.id is not null
              )
          )
        )
    ),
    'activeCategoryId', v_category_id,
    'competition', jsonb_build_object(
      'hasPublishedFixture', v_fixture_id is not null,
      'fixtureVersionId', v_fixture_id,
      'revisionId', v_revision_id,
      'phaseId', v_phase_id,
      'groupId', v_group_id,
      'phases', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', phase.id,
          'name', phase.name,
          'type', phase.phase_type,
          'sequence', phase.sequence_number,
          'status', phase.status
        ) order by phase.sequence_number), '[]'::jsonb)
        from public.tournament_phases phase
        where phase.fixture_version_id = v_fixture_id
          and phase.status <> 'archived'
      ),
      'groups', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', group_row.id,
          'phaseId', group_row.phase_id,
          'name', group_row.name,
          'code', group_row.code
        ) order by group_row.sort_order, group_row.code), '[]'::jsonb)
        from public.tournament_groups group_row
        where group_row.fixture_version_id = v_fixture_id
          and group_row.status = 'published'
      )
    ),
    'nextMatches', (
      select coalesce(jsonb_agg(match_payload order by scheduled_at nulls last, match_number), '[]'::jsonb)
      from (
        select
          match_row.scheduled_at,
          match_row.match_number,
          jsonb_build_object(
            'matchId', match_row.id,
            'matchNumber', match_row.match_number,
            'roundName', round_row.name,
            'scheduledAt', match_row.scheduled_at,
            'status', match_row.status,
            'venueName', venue.name,
            'courtName', court.name,
            'home', jsonb_build_object(
              'participantId', home.id,
              'teamEntryId', home.team_entry_id,
              'name', home.snapshot_name,
              'shortName', home.snapshot_short_name,
              'shieldPath', home.snapshot_shield_path
            ),
            'away', jsonb_build_object(
              'participantId', away.id,
              'teamEntryId', away.team_entry_id,
              'name', away.snapshot_name,
              'shortName', away.snapshot_short_name,
              'shieldPath', away.snapshot_shield_path
            ),
            'isMyTeam', v_my_team_id is not null and (
              home.team_entry_id = v_my_team_id
              or away.team_entry_id = v_my_team_id
            ),
            'myAvailability', case
              when v_is_historical then null
              else availability.response
            end,
            'myCallupStatus', case
              when v_is_historical then null
              else squad_player.callup_status
            end,
            'myLineupStatus', case
              when v_is_historical then null
              else squad_player.lineup_status
            end
          ) match_payload
        from public.tournament_matches match_row
        join public.tournament_rounds round_row on round_row.id = match_row.round_id
        left join public.tournament_competition_participants home
          on home.id = match_row.home_participant_id
        left join public.tournament_competition_participants away
          on away.id = match_row.away_participant_id
        left join public.tournament_venues venue on venue.id = match_row.venue_id
        left join public.tournament_courts court on court.id = match_row.court_id
        left join public.tournament_match_availability_responses availability
          on availability.match_id = match_row.id
         and availability.roster_player_id = v_my_player_id
        left join public.tournament_match_squads squad
          on squad.match_id = match_row.id
         and squad.team_entry_id = v_my_team_id
         and squad.status in ('submitted', 'locked')
        left join public.tournament_match_squad_players squad_player
          on squad_player.match_squad_id = squad.id
         and squad_player.roster_player_id = v_my_player_id
        where match_row.fixture_version_id = v_fixture_id
          and match_row.status in ('scheduled', 'ready', 'postponed')
          and (match_row.scheduled_at is null or match_row.scheduled_at >= now())
        order by match_row.scheduled_at nulls last, match_row.match_number
        limit 3
      ) matches
    ),
    'recentResults', (
      select coalesce(jsonb_agg(match_payload order by official_at desc), '[]'::jsonb)
      from (
        select
          operation.official_at,
          jsonb_build_object(
            'matchId', match_row.id,
            'roundName', round_row.name,
            'scheduledAt', match_row.scheduled_at,
            'officialAt', operation.official_at,
            'home', jsonb_build_object(
              'teamEntryId', home.team_entry_id,
              'name', home.snapshot_name,
              'shortName', home.snapshot_short_name
            ),
            'away', jsonb_build_object(
              'teamEntryId', away.team_entry_id,
              'name', away.snapshot_name,
              'shortName', away.snapshot_short_name
            ),
            'score', jsonb_build_object(
              'home', score.home_score,
              'away', score.away_score,
              'homePenalties', score.home_penalties,
              'awayPenalties', score.away_penalties
            ),
            'outcomeType', outcome.outcome_type,
            'isMyTeam', v_my_team_id is not null and (
              home.team_entry_id = v_my_team_id
              or away.team_entry_id = v_my_team_id
            )
          ) match_payload
        from public.tournament_matches match_row
        join public.tournament_rounds round_row on round_row.id = match_row.round_id
        join public.tournament_match_operations operation
          on operation.match_id = match_row.id
         and operation.status = 'official'
        join public.tournament_match_outcomes outcome
          on outcome.match_operation_id = operation.id
        left join public.tournament_match_scores score
          on score.match_operation_id = operation.id
        left join public.tournament_competition_participants home
          on home.id = match_row.home_participant_id
        left join public.tournament_competition_participants away
          on away.id = match_row.away_participant_id
        where match_row.fixture_version_id = v_fixture_id
        order by operation.official_at desc
        limit 3
      ) results
    ),
    'standings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'position', standing.position,
        'participantId', standing.participant_id,
        'teamEntryId', standing.team_entry_id,
        'teamName', participant.snapshot_name,
        'shortName', participant.snapshot_short_name,
        'played', standing.played,
        'goalDifference', standing.goal_difference,
        'points', standing.points,
        'isMyTeam', standing.team_entry_id = v_my_team_id,
        'classificationStatus', standing.classification_status
      ) order by standing.position), '[]'::jsonb)
      from public.tournament_team_standings standing
      join public.tournament_competition_participants participant
        on participant.id = standing.participant_id
      where standing.revision_id = v_revision_id
        and standing.position <= 5
    ),
    'topScorers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'rosterPlayerId', ranking.roster_player_id,
        'name', ranking.display_name,
        'teamEntryId', ranking.team_entry_id,
        'teamName', ranking.team_name,
        'goals', ranking.goals,
        'assists', ranking.assists,
        'appearances', ranking.appearances,
        'isMe', ranking.roster_player_id = v_my_player_id
      ) order by ranking.goals desc, ranking.assists desc, ranking.display_name), '[]'::jsonb)
      from (
        select
          statistic.roster_player_id,
          player.display_name,
          statistic.team_entry_id,
          entry.name team_name,
          statistic.goals,
          statistic.assists,
          statistic.appearances
        from public.tournament_player_statistics statistic
        join public.tournament_roster_players player
          on player.id = statistic.roster_player_id
        join public.tournament_team_entries entry
          on entry.id = statistic.team_entry_id
        where statistic.revision_id = v_revision_id
        order by statistic.goals desc, statistic.assists desc,
          player.display_name, statistic.roster_player_id
        limit 5
      ) ranking
    ),
    'myStatistics', (
      select jsonb_build_object(
        'appearances', statistic.appearances,
        'starts', statistic.starts,
        'goals', statistic.goals,
        'assists', statistic.assists,
        'yellowCards', statistic.yellow_cards,
        'redCards', statistic.red_cards + statistic.second_yellows
      )
      from public.tournament_player_statistics statistic
      where statistic.revision_id = v_revision_id
        and statistic.roster_player_id = v_my_player_id
    ),
    'mySuspensions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', suspension.id,
        'sourceType', suspension.source_type,
        'reason', suspension.reason,
        'totalMatches', suspension.total_matches,
        'servedMatches', suspension.served_matches,
        'remainingMatches', greatest(
          suspension.total_matches - suspension.served_matches,
          0
        ),
        'status', suspension.status,
        'sourceMatchId', suspension.source_match_id
      ) order by suspension.created_at desc), '[]'::jsonb)
      from public.tournament_player_suspensions suspension
      join public.tournament_standings_revisions revision
        on revision.id = suspension.revision_id
       and revision.status = 'published'
      where suspension.tournament_id = p_tournament_id
        and suspension.category_id = v_category_id
        and suspension.roster_player_id = v_my_player_id
        and suspension.status in ('active', 'reduced', 'served')
    ),
    'myTeam', (
      select jsonb_build_object(
        'id', entry.id,
        'name', entry.name,
        'shortName', entry.short_name,
        'shieldPath', entry.shield_path,
        'primaryColor', entry.primary_color,
        'secondaryColor', entry.secondary_color,
        'managerRole', v_manager_role,
        'canManage', v_can_read_team_private,
        'roster', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', player.id,
            'displayName', player.display_name,
            'shirtNumber', player.shirt_number,
            'primaryPosition', player.primary_position,
            'isGoalkeeper', player.is_goalkeeper,
            'isMe', player.id = v_my_player_id
          ) order by player.shirt_number nulls last, player.display_name), '[]'::jsonb)
          from public.tournament_rosters roster
          join public.tournament_roster_players player
            on player.roster_id = roster.id
           and player.status = 'active'
          where roster.team_entry_id = entry.id
            and roster.status in ('approved', 'locked')
            and roster.id = (
              select roster_latest.id
              from public.tournament_rosters roster_latest
              where roster_latest.team_entry_id = entry.id
                and roster_latest.status in ('approved', 'locked')
              order by roster_latest.version desc
              limit 1
            )
        ),
        'activeSuspensions', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'rosterPlayerId', suspension.roster_player_id,
            'playerName', player.display_name,
            'reason', suspension.reason,
            'remainingMatches', greatest(
              suspension.total_matches - suspension.served_matches,
              0
            )
          ) order by player.display_name), '[]'::jsonb)
          from public.tournament_player_suspensions suspension
          join public.tournament_roster_players player
            on player.id = suspension.roster_player_id
          join public.tournament_standings_revisions revision
            on revision.id = suspension.revision_id
           and revision.status = 'published'
          where v_can_read_team_private
            and suspension.team_entry_id = entry.id
            and suspension.category_id = v_category_id
            and suspension.status in ('active', 'reduced')
        ),
        'nextMatchResponses', (
          select jsonb_build_object(
            'available', count(*) filter (where response.response = 'available'),
            'unavailable', count(*) filter (where response.response = 'unavailable'),
            'maybe', count(*) filter (where response.response = 'maybe'),
            'total', count(*)
          )
          from public.tournament_match_availability_responses response
          where v_can_read_team_private
            and response.team_entry_id = entry.id
            and response.match_id = (
              select next_match.id
              from public.tournament_matches next_match
              left join public.tournament_competition_participants home
                on home.id = next_match.home_participant_id
              left join public.tournament_competition_participants away
                on away.id = next_match.away_participant_id
              where next_match.fixture_version_id = v_fixture_id
                and next_match.status in ('scheduled', 'ready', 'postponed')
                and (home.team_entry_id = entry.id or away.team_entry_id = entry.id)
                and (
                  next_match.scheduled_at is null
                  or next_match.scheduled_at >= now()
                )
              order by next_match.scheduled_at nulls last, next_match.match_number
              limit 1
            )
        )
      )
      from public.tournament_team_entries entry
      where entry.id = v_my_team_id
    ),
    'alerts', (
      select coalesce(jsonb_agg(alert_payload order by priority, label), '[]'::jsonb)
      from (
        select
          1 priority,
          suspension.reason label,
          jsonb_build_object(
            'type', 'suspension',
            'label', suspension.reason,
            'detail', concat(
              greatest(suspension.total_matches - suspension.served_matches, 0),
              ' fecha(s) pendiente(s)'
            )
          ) alert_payload
        from public.tournament_player_suspensions suspension
        join public.tournament_standings_revisions revision
          on revision.id = suspension.revision_id
         and revision.status = 'published'
        where not v_is_historical
          and suspension.roster_player_id = v_my_player_id
          and suspension.category_id = v_category_id
          and suspension.status in ('active', 'reduced')
        union all
        select
          2 priority,
          'Convocatoria' label,
          jsonb_build_object(
            'type', 'callup',
            'label', 'Convocatoria actualizada',
            'detail', case squad_player.lineup_status
              when 'starter' then 'Figurás como titular.'
              when 'substitute' then 'Figurás como suplente.'
              else 'Consultá el estado de tu partido.'
            end
          )
        from public.tournament_match_squad_players squad_player
        join public.tournament_match_squads squad
          on squad.id = squad_player.match_squad_id
         and squad.status in ('submitted', 'locked')
        join public.tournament_matches match_row
          on match_row.id = squad.match_id
         and match_row.fixture_version_id = v_fixture_id
        where not v_is_historical
          and squad_player.roster_player_id = v_my_player_id
          and squad_player.callup_status = 'called_up'
          and (match_row.scheduled_at is null or match_row.scheduled_at >= now())
        order by priority
        limit 4
      ) alerts
    )
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.get_my_tournament_memberships(
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;

  with authorized_relations as (
    select
      tournament.organization_id,
      tournament.id tournament_id,
      category.id category_id,
      membership.role organization_role
    from public.tournaments tournament
    join public.tournament_organizations organization
      on organization.id = tournament.organization_id
     and organization.status = 'active'
    join public.tournament_categories category
      on category.organization_id = tournament.organization_id
     and category.tournament_id = tournament.id
     and category.status = 'active'
    join public.tournament_organization_members membership
      on membership.organization_id = tournament.organization_id
     and membership.user_id = auth.uid()
     and membership.status = 'active'
    union all
    select
      entry.organization_id,
      entry.tournament_id,
      entry.category_id,
      null::text
    from public.tournament_team_entries entry
    join public.tournament_team_managers manager
      on manager.organization_id = entry.organization_id
     and manager.team_entry_id = entry.id
     and manager.user_id = auth.uid()
     and manager.status = 'active'
     and manager.role in ('captain', 'delegate')
    join public.tournament_organizations organization
      on organization.id = entry.organization_id
     and organization.status = 'active'
    where entry.status = 'approved'
    union all
    select
      entry.organization_id,
      entry.tournament_id,
      entry.category_id,
      null::text
    from public.tournament_team_entries entry
    join public.get_my_current_tournament_roster_players() player
      on player.team_entry_id = entry.id
    join public.tournament_organizations organization
      on organization.id = entry.organization_id
     and organization.status = 'active'
    where entry.status = 'approved'
  ),
  authorized_categories as (
    select
      relation.organization_id,
      relation.tournament_id,
      relation.category_id,
      max(relation.organization_role) organization_role
    from authorized_relations relation
    group by
      relation.organization_id,
      relation.tournament_id,
      relation.category_id
  ),
  scoped as (
    select
      access.organization_id,
      access.tournament_id,
      access.category_id,
      organization.name organization_name,
      organization.logo_path organization_logo_path,
      tournament.name tournament_name,
      tournament.status tournament_status,
      tournament.start_date,
      tournament.end_date,
      season.name season_name,
      season.status season_status,
      category.name category_name,
      coalesce(
        access.organization_role,
        membership.role
      ) organization_role,
      own_team.team_entry_id,
      own_team.team_name,
      own_team.team_short_name,
      own_team.team_shield_path,
      own_team.primary_color,
      own_team.manager_role,
      own_team.roster_player_id,
      case
        when own_team.manager_role is not null then own_team.manager_role
        when own_team.roster_player_id is not null then 'player'
        else coalesce(access.organization_role, membership.role)
      end relation_role,
      fixture.id fixture_version_id
    from authorized_categories access
    join public.tournament_organizations organization
      on organization.id = access.organization_id
    join public.tournaments tournament
      on tournament.organization_id = access.organization_id
     and tournament.id = access.tournament_id
    join public.tournament_seasons season
      on season.organization_id = tournament.organization_id
     and season.id = tournament.season_id
    join public.tournament_categories category
      on category.organization_id = access.organization_id
     and category.tournament_id = access.tournament_id
     and category.id = access.category_id
    left join public.tournament_organization_members membership
      on membership.organization_id = access.organization_id
     and membership.user_id = auth.uid()
     and membership.status = 'active'
    left join lateral (
      select
        entry.id team_entry_id,
        entry.name team_name,
        entry.short_name team_short_name,
        entry.shield_path team_shield_path,
        entry.primary_color,
        manager.role manager_role,
        player.roster_player_id
      from public.tournament_team_entries entry
      left join public.tournament_team_managers manager
        on manager.organization_id = entry.organization_id
       and manager.team_entry_id = entry.id
       and manager.user_id = auth.uid()
       and manager.status = 'active'
       and manager.role in ('captain', 'delegate')
      left join public.get_my_current_tournament_roster_players() player
        on player.team_entry_id = entry.id
      where entry.organization_id = access.organization_id
        and entry.tournament_id = access.tournament_id
        and entry.category_id = access.category_id
        and entry.status = 'approved'
        and (
          manager.id is not null
          or player.roster_player_id is not null
        )
      order by
        (player.roster_player_id is not null) desc,
        (manager.id is not null) desc,
        entry.name
      limit 1
    ) own_team on true
    left join public.tournament_fixture_versions fixture
      on fixture.organization_id = access.organization_id
     and fixture.tournament_id = access.tournament_id
     and fixture.category_id = access.category_id
     and fixture.status = 'published'
  ),
  enriched as (
    select
      scoped.*,
      upcoming.match_payload next_match,
      standing.position
    from scoped
    left join lateral (
      select jsonb_build_object(
        'matchId', match_row.id,
        'scheduledAt', match_row.scheduled_at,
        'status', match_row.status,
        'roundName', round_row.name,
        'homeName', home.snapshot_name,
        'awayName', away.snapshot_name,
        'isMyTeam', scoped.team_entry_id is not null and (
          home.team_entry_id = scoped.team_entry_id
          or away.team_entry_id = scoped.team_entry_id
        )
      ) match_payload
      from public.tournament_matches match_row
      join public.tournament_rounds round_row on round_row.id = match_row.round_id
      left join public.tournament_competition_participants home
        on home.id = match_row.home_participant_id
      left join public.tournament_competition_participants away
        on away.id = match_row.away_participant_id
      where match_row.fixture_version_id = scoped.fixture_version_id
        and match_row.status in ('scheduled', 'ready', 'postponed')
        and (
          scoped.team_entry_id is null
          or home.team_entry_id = scoped.team_entry_id
          or away.team_entry_id = scoped.team_entry_id
        )
        and (match_row.scheduled_at is null or match_row.scheduled_at >= now())
      order by match_row.scheduled_at nulls last, match_row.match_number
      limit 1
    ) upcoming on true
    left join lateral (
      select standings.position
      from public.tournament_standings_revisions revision
      join public.tournament_phases phase on phase.id = revision.phase_id
      join public.tournament_team_standings standings
        on standings.revision_id = revision.id
       and standings.team_entry_id = scoped.team_entry_id
      where revision.fixture_version_id = scoped.fixture_version_id
        and revision.status = 'published'
      order by phase.sequence_number desc, revision.group_id nulls first,
        revision.revision_number desc
      limit 1
    ) standing on true
  ),
  ordered as (
    select enriched.*,
      count(*) over () total_count
    from enriched
    order by
      case enriched.tournament_status
        when 'active' then 0
        when 'scheduled' then 1
        when 'registration' then 2
        when 'completed' then 3
        when 'archived' then 4
        else 5
      end,
      enriched.start_date desc nulls last,
      enriched.tournament_name,
      enriched.category_name
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',
    coalesce(jsonb_agg(jsonb_build_object(
      'organizationId', organization_id,
      'organizationName', organization_name,
      'logoPath', organization_logo_path,
      'tournamentId', tournament_id,
      'tournamentName', tournament_name,
      'tournamentStatus', tournament_status,
      'seasonName', season_name,
      'seasonStatus', season_status,
      'categoryId', category_id,
      'categoryName', category_name,
      'teamEntryId', team_entry_id,
      'teamName', team_name,
      'teamShortName', team_short_name,
      'teamShieldPath', team_shield_path,
      'primaryColor', primary_color,
      'role', relation_role,
      'organizationRole', organization_role,
      'position', position,
      'nextMatch', next_match,
      'hasPublishedFixture', fixture_version_id is not null,
      'readOnly', tournament_status in ('completed', 'archived')
    ) order by
      case tournament_status
        when 'active' then 0
        when 'scheduled' then 1
        when 'registration' then 2
        when 'completed' then 3
        when 'archived' then 4
        else 5
      end,
      start_date desc nulls last,
      tournament_name,
      category_name), '[]'::jsonb),
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', coalesce(max(total_count), 0),
      'hasMore', v_offset + count(*) < coalesce(max(total_count), 0)
    )
  )
  into v_result
  from ordered;

  return coalesce(v_result, jsonb_build_object(
    'items', '[]'::jsonb,
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', 0,
      'hasMore', false
    )
  ));
end;
$$;

create or replace function public.get_published_tournament_teams(
  p_tournament_id uuid,
  p_category_id uuid,
  p_limit integer default 16,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture_id uuid;
  v_revision_id uuid;
  v_my_team_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 16), 1), 32);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.can_read_tournament_participant_hub(
    p_tournament_id,
    p_category_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_HUB_FORBIDDEN';
  end if;

  select fixture.id
  into v_fixture_id
  from public.tournament_fixture_versions fixture
  where fixture.tournament_id = p_tournament_id
    and fixture.category_id = p_category_id
    and fixture.status = 'published';

  select entry.id
  into v_my_team_id
  from public.tournament_team_entries entry
  left join public.get_my_current_tournament_roster_players() player
    on player.team_entry_id = entry.id
  left join public.tournament_team_managers manager
    on manager.organization_id = entry.organization_id
   and manager.team_entry_id = entry.id
   and manager.user_id = auth.uid()
   and manager.status = 'active'
   and manager.role in ('captain', 'delegate')
  where entry.tournament_id = p_tournament_id
    and entry.category_id = p_category_id
    and entry.status = 'approved'
    and (
      player.roster_player_id is not null
      or manager.id is not null
    )
  order by (player.roster_player_id is not null) desc, entry.name
  limit 1;

  select revision.id
  into v_revision_id
  from public.tournament_standings_revisions revision
  join public.tournament_phases phase on phase.id = revision.phase_id
  where revision.fixture_version_id = v_fixture_id
    and revision.status = 'published'
  order by phase.sequence_number desc, revision.group_id nulls first,
    revision.revision_number desc
  limit 1;

  with roster_payloads as (
    select
      roster.team_entry_id,
      jsonb_agg(jsonb_build_object(
        'id', player.id,
        'displayName', player.display_name,
        'shirtNumber', player.shirt_number,
        'primaryPosition', player.primary_position,
        'isGoalkeeper', player.is_goalkeeper
      ) order by player.shirt_number nulls last, player.display_name) roster
    from public.tournament_rosters roster
    join public.tournament_roster_players player
      on player.roster_id = roster.id
     and player.status = 'active'
    where roster.status in ('approved', 'locked')
      and roster.version = (
        select max(latest.version)
        from public.tournament_rosters latest
        where latest.team_entry_id = roster.team_entry_id
          and latest.status in ('approved', 'locked')
      )
    group by roster.team_entry_id
  ),
  feed as (
    select
      participant.id participant_id,
      participant.team_entry_id,
      participant.snapshot_name name,
      participant.snapshot_short_name short_name,
      participant.snapshot_shield_path shield_path,
      participant.snapshot_primary_color primary_color,
      participant.snapshot_secondary_color secondary_color,
      participant.status,
      coalesce(roster.roster, '[]'::jsonb) roster,
      standing.position,
      standing.played,
      standing.points,
      next_match.payload next_match,
      count(*) over () total_count
    from public.tournament_competition_participants participant
    left join roster_payloads roster
      on roster.team_entry_id = participant.team_entry_id
    left join public.tournament_team_standings standing
      on standing.revision_id = v_revision_id
     and standing.team_entry_id = participant.team_entry_id
    left join lateral (
      select jsonb_build_object(
        'matchId', match_row.id,
        'scheduledAt', match_row.scheduled_at,
        'status', match_row.status,
        'roundName', round_row.name,
        'homeName', home.snapshot_name,
        'awayName', away.snapshot_name
      ) payload
      from public.tournament_matches match_row
      join public.tournament_rounds round_row on round_row.id = match_row.round_id
      left join public.tournament_competition_participants home
        on home.id = match_row.home_participant_id
      left join public.tournament_competition_participants away
        on away.id = match_row.away_participant_id
      where match_row.fixture_version_id = v_fixture_id
        and match_row.status in ('scheduled', 'ready', 'postponed')
        and (
          home.team_entry_id = participant.team_entry_id
          or away.team_entry_id = participant.team_entry_id
        )
        and (match_row.scheduled_at is null or match_row.scheduled_at >= now())
      order by match_row.scheduled_at nulls last, match_row.match_number
      limit 1
    ) next_match on true
    where participant.participant_set_id = (
      select fixture.participant_set_id
      from public.tournament_fixture_versions fixture
      where fixture.id = v_fixture_id
    )
      and participant.status in ('active', 'withdrawn')
  ),
  paged as (
    select *
    from feed
    order by position nulls last, name, participant_id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'participantId', participant_id,
      'teamEntryId', team_entry_id,
      'name', name,
      'shortName', short_name,
      'shieldPath', shield_path,
      'primaryColor', primary_color,
      'secondaryColor', secondary_color,
      'status', status,
      'roster', case
        when status = 'active' then roster
        else '[]'::jsonb
      end,
      'position', position,
      'played', played,
      'points', points,
      'nextMatch', next_match,
      'isMyTeam', team_entry_id = v_my_team_id
    ) order by position nulls last, name, participant_id), '[]'::jsonb),
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', coalesce(max(total_count), 0),
      'hasMore', v_offset + count(*) < coalesce(max(total_count), 0)
    ),
    'hasPublishedFixture', v_fixture_id is not null
  )
  into v_result
  from paged;

  return coalesce(v_result, jsonb_build_object(
    'items', '[]'::jsonb,
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', 0,
      'hasMore', false
    ),
    'hasPublishedFixture', v_fixture_id is not null
  ));
end;
$$;

create or replace function public.get_published_tournament_standings(
  p_tournament_id uuid,
  p_category_id uuid,
  p_phase_id uuid,
  p_group_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fixture_id uuid;
  v_revision_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.can_read_tournament_participant_hub(
    p_tournament_id,
    p_category_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_HUB_FORBIDDEN';
  end if;

  select fixture.id
  into v_fixture_id
  from public.tournament_fixture_versions fixture
  join public.tournament_phases phase
    on phase.fixture_version_id = fixture.id
   and phase.id = p_phase_id
   and phase.status <> 'archived'
  where fixture.tournament_id = p_tournament_id
    and fixture.category_id = p_category_id
    and fixture.status = 'published'
    and (
      p_group_id is null
      or exists (
        select 1
        from public.tournament_groups group_row
        where group_row.id = p_group_id
          and group_row.fixture_version_id = fixture.id
          and group_row.phase_id = phase.id
          and group_row.status = 'published'
      )
    );

  if v_fixture_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_HUB_FORBIDDEN';
  end if;

  select revision.id
  into v_revision_id
  from public.tournament_standings_revisions revision
  where revision.fixture_version_id = v_fixture_id
    and revision.phase_id = p_phase_id
    and revision.group_id is not distinct from p_group_id
    and revision.status = 'published'
  order by revision.revision_number desc
  limit 1;

  select jsonb_build_object(
    'revision', case
      when revision.id is null then null
      else jsonb_build_object(
        'id', revision.id,
        'number', revision.revision_number,
        'status', 'published',
        'publishedAt', revision.published_at
      )
    end,
    'standings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', standing.position,
        'participantId', standing.participant_id,
        'teamEntryId', standing.team_entry_id,
        'teamName', participant.snapshot_name,
        'shortName', participant.snapshot_short_name,
        'shieldPath', participant.snapshot_shield_path,
        'played', standing.played,
        'won', standing.won,
        'drawn', standing.drawn,
        'lost', standing.lost,
        'goalsFor', standing.goals_for,
        'goalsAgainst', standing.goals_against,
        'goalDifference', standing.goal_difference,
        'points', standing.points,
        'classificationStatus', standing.classification_status
      ) order by standing.position)
      from public.tournament_team_standings standing
      join public.tournament_competition_participants participant
        on participant.id = standing.participant_id
      where standing.revision_id = revision.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.tournament_standings_revisions revision
  where revision.id = v_revision_id;

  return coalesce(v_result, jsonb_build_object(
    'revision', null,
    'standings', '[]'::jsonb
  ));
end;
$$;

create or replace function public.get_published_tournament_statistics(
  p_tournament_id uuid,
  p_category_id uuid,
  p_phase_id uuid,
  p_group_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fixture_id uuid;
  v_revision_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.can_read_tournament_participant_hub(
    p_tournament_id,
    p_category_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_HUB_FORBIDDEN';
  end if;

  select fixture.id
  into v_fixture_id
  from public.tournament_fixture_versions fixture
  join public.tournament_phases phase
    on phase.fixture_version_id = fixture.id
   and phase.id = p_phase_id
   and phase.status <> 'archived'
  where fixture.tournament_id = p_tournament_id
    and fixture.category_id = p_category_id
    and fixture.status = 'published'
    and (
      p_group_id is null
      or exists (
        select 1
        from public.tournament_groups group_row
        where group_row.id = p_group_id
          and group_row.fixture_version_id = fixture.id
          and group_row.phase_id = phase.id
          and group_row.status = 'published'
      )
    );

  if v_fixture_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_HUB_FORBIDDEN';
  end if;

  select revision.id
  into v_revision_id
  from public.tournament_standings_revisions revision
  where revision.fixture_version_id = v_fixture_id
    and revision.phase_id = p_phase_id
    and revision.group_id is not distinct from p_group_id
    and revision.status = 'published'
  order by revision.revision_number desc
  limit 1;

  return jsonb_build_object(
    'revisionId', v_revision_id,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rosterPlayerId', statistic.roster_player_id,
        'teamEntryId', statistic.team_entry_id,
        'name', player.display_name,
        'goals', statistic.goals,
        'ownGoals', statistic.own_goals,
        'assists', statistic.assists,
        'appearances', statistic.appearances,
        'starts', statistic.starts,
        'substituteAppearances', statistic.substitute_appearances,
        'yellowCards', statistic.yellow_cards,
        'secondYellows', statistic.second_yellows,
        'redCards', statistic.red_cards,
        'captaincies', statistic.captaincies
      ) order by
        statistic.goals desc,
        statistic.assists desc,
        player.display_name,
        statistic.roster_player_id)
      from public.tournament_player_statistics statistic
      join public.tournament_roster_players player
        on player.id = statistic.roster_player_id
      where statistic.revision_id = v_revision_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participantId', statistic.participant_id,
        'teamEntryId', statistic.team_entry_id,
        'teamName', participant.snapshot_name,
        'shortName', participant.snapshot_short_name,
        'shieldPath', participant.snapshot_shield_path,
        'goals', statistic.goals,
        'yellowCards', statistic.yellow_cards,
        'secondYellows', statistic.second_yellows,
        'redCards', statistic.red_cards,
        'homePlayed', statistic.home_played,
        'awayPlayed', statistic.away_played
      ) order by statistic.goals desc, participant.snapshot_name)
      from public.tournament_team_statistics statistic
      join public.tournament_competition_participants participant
        on participant.id = statistic.participant_id
      where statistic.revision_id = v_revision_id
    ), '[]'::jsonb),
    'discipline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rosterPlayerId', ledger.roster_player_id,
        'teamEntryId', ledger.team_entry_id,
        'name', player.display_name,
        'yellowCards', ledger.yellow_cards,
        'secondYellows', ledger.second_yellows,
        'directReds', ledger.direct_reds,
        'fairPlayPoints', ledger.fair_play_points,
        'automaticSuspensions', ledger.automatic_suspensions,
        'suspensions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', suspension.id,
            'sourceType', suspension.source_type,
            'totalMatches', suspension.total_matches,
            'servedMatches', suspension.served_matches,
            'remainingMatches', greatest(
              suspension.total_matches - suspension.served_matches,
              0
            ),
            'status', suspension.status
          ) order by suspension.created_at)
          from public.tournament_player_suspensions suspension
          where suspension.revision_id = ledger.revision_id
            and suspension.roster_player_id = ledger.roster_player_id
            and suspension.status in ('active', 'reduced', 'served')
        ), '[]'::jsonb)
      ) order by ledger.fair_play_points desc, player.display_name)
      from public.tournament_discipline_ledgers ledger
      join public.tournament_roster_players player
        on player.id = ledger.roster_player_id
      where ledger.revision_id = v_revision_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on table public.tournament_participant_hub_preferences
  from public, anon, authenticated;

revoke all on function public.get_my_current_tournament_roster_players()
  from public, anon, authenticated;
revoke all on function public.can_read_tournament_participant_hub(uuid, uuid)
  from public, anon;
revoke all on function public.set_my_tournament_hub_category(uuid, uuid)
  from public, anon;
revoke all on function public.get_my_tournament_memberships(integer, integer)
  from public, anon;
revoke all on function public.get_tournament_participant_hub(uuid, uuid)
  from public, anon;
revoke all on function public.get_published_tournament_matches(
  uuid, uuid, text, uuid, integer, integer
) from public, anon;
revoke all on function public.get_tournament_participant_match(uuid)
  from public, anon;
revoke all on function public.get_published_tournament_teams(
  uuid, uuid, integer, integer
) from public, anon;
revoke all on function public.get_published_tournament_standings(
  uuid, uuid, uuid, uuid
) from public, anon;
revoke all on function public.get_published_tournament_statistics(
  uuid, uuid, uuid, uuid
) from public, anon;

grant execute on function public.set_my_tournament_hub_category(uuid, uuid)
  to authenticated;
grant execute on function public.get_my_tournament_memberships(integer, integer)
  to authenticated;
grant execute on function public.get_tournament_participant_hub(uuid, uuid)
  to authenticated;
grant execute on function public.get_published_tournament_matches(
  uuid, uuid, text, uuid, integer, integer
) to authenticated;
grant execute on function public.get_tournament_participant_match(uuid)
  to authenticated;
grant execute on function public.get_published_tournament_teams(
  uuid, uuid, integer, integer
) to authenticated;
grant execute on function public.get_published_tournament_standings(
  uuid, uuid, uuid, uuid
) to authenticated;
grant execute on function public.get_published_tournament_statistics(
  uuid, uuid, uuid, uuid
) to authenticated;
