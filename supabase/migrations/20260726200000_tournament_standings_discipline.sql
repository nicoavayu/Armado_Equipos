-- Arma2 Torneos: versioned standings, statistics, qualification and discipline.
-- Local/dedicated staging only. Never apply this migration to production.

create extension if not exists pgcrypto;

create or replace function public.tournament_role_capabilities(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then array[
      'organization.read', 'organization.update', 'organization.archive',
      'members.read', 'members.invite', 'members.update_role', 'members.remove',
      'workspace.access', 'workspace.manage',
      'seasons.read', 'seasons.create', 'seasons.update', 'seasons.archive',
      'tournaments.read', 'tournaments.create', 'tournaments.update',
      'tournaments.change_status', 'tournaments.archive',
      'categories.read', 'categories.create', 'categories.update', 'categories.archive',
      'competition_rules.read', 'competition_rules.update',
      'team_entries.read', 'team_entries.create', 'team_entries.update',
      'team_entries.submit', 'team_entries.review', 'team_entries.approve',
      'team_entries.reject', 'team_entries.withdraw', 'team_entries.archive',
      'team_managers.read', 'team_managers.invite', 'team_managers.revoke',
      'rosters.read', 'rosters.update', 'rosters.submit', 'rosters.review',
      'rosters.approve', 'rosters.lock',
      'roster_players.read', 'roster_players.add', 'roster_players.update',
      'roster_players.remove', 'provisional_players.create',
      'provisional_players.update', 'player_duplicates.override',
      'participants.read', 'participants.freeze', 'participants.reopen',
      'draw.read', 'draw.manage', 'draw.execute', 'draw.publish',
      'fixture.read', 'fixture.generate', 'fixture.create_manual',
      'fixture.update_draft', 'fixture.publish', 'fixture.supersede', 'fixture.archive',
      'groups.read', 'groups.manage', 'rounds.read', 'rounds.manage', 'rounds.lock',
      'matches.read', 'matches.create', 'matches.schedule', 'matches.reschedule',
      'matches.postpone', 'matches.cancel',
      'venues.read', 'venues.create', 'venues.update', 'venues.archive',
      'courts.read', 'courts.create', 'courts.update', 'courts.archive',
      'schedule_windows.read', 'schedule_windows.manage', 'schedule_conflicts.override',
      'match_operations.read', 'match_operations.open',
      'match_operations.update_draft', 'match_operations.submit',
      'match_operations.review', 'match_operations.validate',
      'match_operations.make_official', 'match_operations.request_correction',
      'match_operations.correct', 'match_operations.void',
      'match_squads.read', 'match_squads.manage', 'match_squads.submit',
      'match_squads.lock', 'match_availability.read',
      'match_availability.record_manual', 'match_events.read',
      'match_events.create', 'match_events.update_draft', 'match_events.void',
      'match_outcomes.manage', 'match_scores.manage',
      'match_administrative_results.manage',
      'standings.read', 'standings.rebuild', 'standings.publish', 'standings.override',
      'statistics.read', 'statistics.rebuild',
      'qualification.read', 'qualification.resolve', 'qualification.override',
      'discipline.read', 'discipline.manage', 'discipline.resolve',
      'discipline.override', 'suspensions.read', 'suspensions.manage',
      'suspensions.mark_served'
    ]::text[]
    when 'admin' then array[
      'organization.read', 'organization.update',
      'members.read', 'members.invite', 'members.update_role', 'members.remove',
      'workspace.access', 'workspace.manage',
      'seasons.read', 'seasons.create', 'seasons.update', 'seasons.archive',
      'tournaments.read', 'tournaments.create', 'tournaments.update',
      'tournaments.change_status', 'tournaments.archive',
      'categories.read', 'categories.create', 'categories.update', 'categories.archive',
      'competition_rules.read', 'competition_rules.update',
      'team_entries.read', 'team_entries.create', 'team_entries.update',
      'team_entries.submit', 'team_entries.review', 'team_entries.approve',
      'team_entries.reject', 'team_entries.withdraw', 'team_entries.archive',
      'team_managers.read', 'team_managers.invite', 'team_managers.revoke',
      'rosters.read', 'rosters.update', 'rosters.submit', 'rosters.review',
      'rosters.approve', 'rosters.lock',
      'roster_players.read', 'roster_players.add', 'roster_players.update',
      'roster_players.remove', 'provisional_players.create',
      'provisional_players.update', 'player_duplicates.override',
      'participants.read', 'participants.freeze', 'participants.reopen',
      'draw.read', 'draw.manage', 'draw.execute', 'draw.publish',
      'fixture.read', 'fixture.generate', 'fixture.create_manual',
      'fixture.update_draft', 'fixture.publish', 'fixture.supersede', 'fixture.archive',
      'groups.read', 'groups.manage', 'rounds.read', 'rounds.manage', 'rounds.lock',
      'matches.read', 'matches.create', 'matches.schedule', 'matches.reschedule',
      'matches.postpone', 'matches.cancel',
      'venues.read', 'venues.create', 'venues.update', 'venues.archive',
      'courts.read', 'courts.create', 'courts.update', 'courts.archive',
      'schedule_windows.read', 'schedule_windows.manage', 'schedule_conflicts.override',
      'match_operations.read', 'match_operations.open',
      'match_operations.update_draft', 'match_operations.submit',
      'match_operations.review', 'match_operations.validate',
      'match_operations.make_official', 'match_operations.request_correction',
      'match_operations.correct', 'match_operations.void',
      'match_squads.read', 'match_squads.manage', 'match_squads.submit',
      'match_squads.lock', 'match_availability.read',
      'match_availability.record_manual', 'match_events.read',
      'match_events.create', 'match_events.update_draft', 'match_events.void',
      'match_outcomes.manage', 'match_scores.manage',
      'match_administrative_results.manage',
      'standings.read', 'standings.rebuild', 'standings.publish', 'standings.override',
      'statistics.read', 'statistics.rebuild',
      'qualification.read', 'qualification.resolve', 'qualification.override',
      'discipline.read', 'discipline.manage', 'discipline.resolve',
      'discipline.override', 'suspensions.read', 'suspensions.manage',
      'suspensions.mark_served'
    ]::text[]
    when 'collaborator' then array[
      'organization.read', 'members.read', 'workspace.access',
      'seasons.read', 'tournaments.read', 'categories.read',
      'competition_rules.read', 'team_entries.read', 'team_managers.read',
      'rosters.read', 'roster_players.read',
      'participants.read', 'draw.read', 'fixture.read', 'groups.read',
      'rounds.read', 'matches.read', 'venues.read', 'courts.read',
      'schedule_windows.read', 'match_operations.read', 'match_squads.read',
      'match_availability.read', 'match_events.read',
      'standings.read', 'statistics.read', 'qualification.read',
      'discipline.read', 'suspensions.read'
    ]::text[]
    else array[]::text[]
  end;
$$;

create table public.tournament_standings_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  fixture_version_id uuid not null,
  phase_id uuid not null,
  group_id uuid,
  revision_number integer not null,
  status text not null default 'draft',
  source_fingerprint text not null,
  configuration_snapshot jsonb not null,
  rebuild_reason text not null,
  calculated_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  calculated_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete restrict,
  published_at timestamptz,
  superseded_at timestamptz,
  constraint tournament_standings_revisions_fixture_fk
    foreign key (organization_id, tournament_id, category_id, fixture_version_id)
    references public.tournament_fixture_versions
      (organization_id, tournament_id, category_id, id) on delete restrict,
  constraint tournament_standings_revisions_phase_fk
    foreign key (organization_id, tournament_id, category_id, fixture_version_id, phase_id)
    references public.tournament_phases
      (organization_id, tournament_id, category_id, fixture_version_id, id) on delete restrict,
  constraint tournament_standings_revisions_group_fk
    foreign key (
      organization_id, tournament_id, category_id, fixture_version_id, phase_id, group_id
    )
    references public.tournament_groups (
      organization_id, tournament_id, category_id, fixture_version_id, phase_id, id
    ) on delete restrict,
  constraint tournament_standings_revisions_tournament_fk
    foreign key (organization_id, tournament_id, season_id)
    references public.tournaments(organization_id, id, season_id) on delete restrict,
  constraint tournament_standings_revisions_number_check check (revision_number > 0),
  constraint tournament_standings_revisions_status_check
    check (status in ('draft', 'published', 'superseded')),
  constraint tournament_standings_revisions_fingerprint_check
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint tournament_standings_revisions_config_check
    check (jsonb_typeof(configuration_snapshot) = 'object'
      and pg_column_size(configuration_snapshot) <= 65536),
  constraint tournament_standings_revisions_reason_check
    check (rebuild_reason = btrim(rebuild_reason)
      and char_length(rebuild_reason) between 3 and 500),
  constraint tournament_standings_revisions_lifecycle_check check (
    (status = 'draft' and published_by is null and published_at is null and superseded_at is null)
    or (status = 'published' and published_by is not null
      and published_at is not null and superseded_at is null)
    or (status = 'superseded' and published_by is not null
      and published_at is not null and superseded_at is not null)
  ),
  constraint tournament_standings_revisions_scope_unique
    unique (organization_id, tournament_id, category_id, fixture_version_id, id),
  constraint tournament_standings_revisions_org_id_unique
    unique (organization_id, id),
  constraint tournament_standings_revisions_number_unique
    unique nulls not distinct (fixture_version_id, phase_id, group_id, revision_number),
  constraint tournament_standings_revisions_idempotency_unique
    unique (organization_id, calculated_by, idempotency_key)
);

create unique index tournament_standings_revisions_published_unique
  on public.tournament_standings_revisions
  (fixture_version_id, phase_id, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'published';
create unique index tournament_standings_revisions_draft_unique
  on public.tournament_standings_revisions
  (fixture_version_id, phase_id, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'draft';
create index tournament_standings_revisions_context_idx
  on public.tournament_standings_revisions
  (organization_id, tournament_id, category_id, phase_id, group_id, revision_number desc);

create table public.tournament_projection_sources (
  revision_id uuid not null,
  organization_id uuid not null,
  match_operation_id uuid not null,
  match_id uuid not null,
  official_at timestamptz not null,
  primary key (revision_id, match_operation_id),
  constraint tournament_projection_sources_revision_fk
    foreign key (organization_id, revision_id)
    references public.tournament_standings_revisions(organization_id, id) on delete restrict,
  constraint tournament_projection_sources_operation_fk
    foreign key (organization_id, match_id, match_operation_id)
    references public.tournament_match_operations(organization_id, match_id, id) on delete restrict
);

create index tournament_projection_sources_match_idx
  on public.tournament_projection_sources(match_id, revision_id);

create table public.tournament_team_standings (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null,
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  phase_id uuid not null,
  group_id uuid,
  participant_id uuid not null,
  team_entry_id uuid not null,
  position integer,
  played integer not null default 0,
  won integer not null default 0,
  drawn integer not null default 0,
  lost integer not null default 0,
  goals_for integer not null default 0,
  goals_against integer not null default 0,
  goal_difference integer not null default 0,
  base_points integer not null default 0,
  points_adjustment integer not null default 0,
  points integer not null default 0,
  walkovers integer not null default 0,
  administrative_results integer not null default 0,
  fair_play_points integer not null default 0,
  classification_status text not null default 'pending',
  tiebreak_trace jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint tournament_team_standings_revision_fk
    foreign key (organization_id, revision_id)
    references public.tournament_standings_revisions(organization_id, id) on delete restrict,
  constraint tournament_team_standings_participant_fk
    foreign key (participant_id)
    references public.tournament_competition_participants(id) on delete restrict,
  constraint tournament_team_standings_entry_fk
    foreign key (organization_id, tournament_id, team_entry_id)
    references public.tournament_team_entries(organization_id, tournament_id, id) on delete restrict,
  constraint tournament_team_standings_values_check check (
    position is null or position > 0
  ),
  constraint tournament_team_standings_counts_check check (
    played >= 0 and won >= 0 and drawn >= 0 and lost >= 0
    and goals_for >= 0 and goals_against >= 0
    and walkovers >= 0 and administrative_results >= 0 and fair_play_points >= 0
    and played = won + drawn + lost
    and goal_difference = goals_for - goals_against
    and points = base_points + points_adjustment
  ),
  constraint tournament_team_standings_classification_check
    check (classification_status in (
      'pending', 'qualified', 'eliminated', 'playoff', 'manual_review'
    )),
  constraint tournament_team_standings_trace_check
    check (jsonb_typeof(tiebreak_trace) = 'object'
      and pg_column_size(tiebreak_trace) <= 16384),
  constraint tournament_team_standings_revision_participant_unique
    unique (revision_id, participant_id),
  constraint tournament_team_standings_revision_position_unique
    unique (revision_id, position)
);

create index tournament_team_standings_table_idx
  on public.tournament_team_standings(revision_id, position, participant_id);

create table public.tournament_team_statistics (
  revision_id uuid not null,
  organization_id uuid not null,
  participant_id uuid not null,
  team_entry_id uuid not null,
  goals integer not null default 0,
  own_goals_benefited integer not null default 0,
  yellow_cards integer not null default 0,
  second_yellows integer not null default 0,
  red_cards integer not null default 0,
  home_played integer not null default 0,
  away_played integer not null default 0,
  suspended_matches integer not null default 0,
  administrative_matches integer not null default 0,
  recent_form jsonb not null default '[]'::jsonb,
  streak_type text,
  streak_count integer not null default 0,
  primary key (revision_id, participant_id),
  constraint tournament_team_statistics_revision_fk
    foreign key (organization_id, revision_id)
    references public.tournament_standings_revisions(organization_id, id) on delete restrict,
  constraint tournament_team_statistics_participant_fk
    foreign key (participant_id)
    references public.tournament_competition_participants(id) on delete restrict,
  constraint tournament_team_statistics_counts_check check (
    goals >= 0 and own_goals_benefited >= 0 and yellow_cards >= 0
    and second_yellows >= 0 and red_cards >= 0 and home_played >= 0
    and away_played >= 0 and suspended_matches >= 0
    and administrative_matches >= 0 and streak_count >= 0
  ),
  constraint tournament_team_statistics_form_check
    check (jsonb_typeof(recent_form) = 'array' and jsonb_array_length(recent_form) <= 5),
  constraint tournament_team_statistics_streak_check
    check (streak_type is null or streak_type in ('win', 'draw', 'loss', 'unbeaten'))
);

create table public.tournament_player_statistics (
  revision_id uuid not null,
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  roster_player_id uuid not null,
  team_entry_id uuid not null,
  squad_calls integer not null default 0,
  appearances integer not null default 0,
  starts integer not null default 0,
  substitute_appearances integer not null default 0,
  minutes_played integer,
  goals integer not null default 0,
  own_goals integer not null default 0,
  assists integer not null default 0,
  penalty_goals integer not null default 0,
  penalties_missed integer not null default 0,
  yellow_cards integer not null default 0,
  second_yellows integer not null default 0,
  red_cards integer not null default 0,
  captaincies integer not null default 0,
  primary key (revision_id, roster_player_id),
  constraint tournament_player_statistics_revision_fk
    foreign key (organization_id, revision_id)
    references public.tournament_standings_revisions(organization_id, id) on delete restrict,
  constraint tournament_player_statistics_player_fk
    foreign key (organization_id, team_entry_id, roster_player_id)
    references public.tournament_roster_players
      (organization_id, team_entry_id, id) on delete restrict,
  constraint tournament_player_statistics_entry_fk
    foreign key (organization_id, tournament_id, team_entry_id)
    references public.tournament_team_entries(organization_id, tournament_id, id) on delete restrict,
  constraint tournament_player_statistics_counts_check check (
    squad_calls >= 0 and appearances >= 0 and starts >= 0
    and substitute_appearances >= 0 and minutes_played is null
    and goals >= 0 and own_goals >= 0 and assists >= 0
    and penalty_goals >= 0 and penalties_missed >= 0
    and yellow_cards >= 0 and second_yellows >= 0 and red_cards >= 0
    and captaincies >= 0
  )
);

create index tournament_player_statistics_rankings_idx
  on public.tournament_player_statistics(revision_id, goals desc, assists desc, roster_player_id);

create table public.tournament_discipline_ledgers (
  revision_id uuid not null,
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  phase_id uuid not null,
  group_id uuid,
  roster_player_id uuid not null,
  team_entry_id uuid not null,
  yellow_cards integer not null default 0,
  second_yellows integer not null default 0,
  direct_reds integer not null default 0,
  fair_play_points integer not null default 0,
  automatic_suspensions integer not null default 0,
  primary key (revision_id, roster_player_id),
  constraint tournament_discipline_ledgers_revision_fk
    foreign key (organization_id, revision_id)
    references public.tournament_standings_revisions(organization_id, id) on delete restrict,
  constraint tournament_discipline_ledgers_player_fk
    foreign key (organization_id, team_entry_id, roster_player_id)
    references public.tournament_roster_players
      (organization_id, team_entry_id, id) on delete restrict,
  constraint tournament_discipline_ledgers_counts_check check (
    yellow_cards >= 0 and second_yellows >= 0 and direct_reds >= 0
    and fair_play_points >= 0 and automatic_suspensions >= 0
  )
);

create table public.tournament_player_suspensions (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null,
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  phase_id uuid not null,
  group_id uuid,
  roster_player_id uuid not null,
  team_entry_id uuid not null,
  source_type text not null,
  source_key text not null,
  source_event_id uuid,
  source_match_id uuid,
  rule_snapshot jsonb not null,
  total_matches integer not null,
  served_matches integer not null default 0,
  status text not null default 'pending',
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_player_suspensions_revision_fk
    foreign key (organization_id, revision_id)
    references public.tournament_standings_revisions(organization_id, id) on delete restrict,
  constraint tournament_player_suspensions_player_fk
    foreign key (organization_id, team_entry_id, roster_player_id)
    references public.tournament_roster_players
      (organization_id, team_entry_id, id) on delete restrict,
  constraint tournament_player_suspensions_event_fk
    foreign key (source_event_id)
    references public.tournament_match_events(id) on delete restrict,
  constraint tournament_player_suspensions_match_fk
    foreign key (organization_id, source_match_id)
    references public.tournament_matches(organization_id, id) on delete restrict,
  constraint tournament_player_suspensions_source_check
    check (source_type in ('yellow_accumulation', 'second_yellow', 'direct_red', 'manual')),
  constraint tournament_player_suspensions_source_key_check
    check (source_key = btrim(source_key) and char_length(source_key) between 3 and 160),
  constraint tournament_player_suspensions_rule_check
    check (jsonb_typeof(rule_snapshot) = 'object' and pg_column_size(rule_snapshot) <= 8192),
  constraint tournament_player_suspensions_matches_check
    check (total_matches between 1 and 24 and served_matches between 0 and total_matches),
  constraint tournament_player_suspensions_status_check
    check (status in ('pending', 'active', 'served', 'reduced', 'revoked', 'superseded')),
  constraint tournament_player_suspensions_reason_check
    check (reason = btrim(reason) and char_length(reason) between 3 and 500),
  constraint tournament_player_suspensions_lifecycle_check check (
    (status = 'served' and served_matches = total_matches)
    or (status <> 'served' and served_matches <= total_matches)
  ),
  constraint tournament_player_suspensions_source_unique
    unique (revision_id, roster_player_id, source_type, source_key)
);

create index tournament_player_suspensions_current_idx
  on public.tournament_player_suspensions
  (organization_id, tournament_id, category_id, roster_player_id, status)
  where status in ('active', 'reduced');

create table public.tournament_suspension_served_matches (
  suspension_id uuid not null,
  organization_id uuid not null,
  match_id uuid not null,
  marked_by uuid not null references auth.users(id) on delete restrict,
  marked_at timestamptz not null default now(),
  note text,
  primary key (suspension_id, match_id),
  constraint tournament_suspension_served_matches_suspension_fk
    foreign key (suspension_id)
    references public.tournament_player_suspensions(id) on delete restrict,
  constraint tournament_suspension_served_matches_match_fk
    foreign key (organization_id, match_id)
    references public.tournament_matches(organization_id, id) on delete restrict,
  constraint tournament_suspension_served_matches_note_check
    check (note is null or char_length(note) <= 500)
);

create table public.tournament_disciplinary_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  suspension_id uuid not null,
  action text not null,
  previous_state jsonb not null,
  new_state jsonb not null,
  reason text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint tournament_disciplinary_overrides_suspension_fk
    foreign key (suspension_id)
    references public.tournament_player_suspensions(id) on delete restrict,
  constraint tournament_disciplinary_overrides_action_check
    check (action in ('reduce', 'revoke', 'add_match')),
  constraint tournament_disciplinary_overrides_states_check
    check (jsonb_typeof(previous_state) = 'object' and jsonb_typeof(new_state) = 'object'),
  constraint tournament_disciplinary_overrides_reason_check
    check (reason = btrim(reason) and char_length(reason) between 3 and 1000),
  constraint tournament_disciplinary_overrides_idempotency_unique
    unique (organization_id, actor_user_id, idempotency_key)
);

create table public.tournament_points_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  participant_set_id uuid not null,
  fixture_version_id uuid not null,
  phase_id uuid not null,
  group_id uuid,
  participant_id uuid not null,
  points integer not null,
  status text not null default 'active',
  reason text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint tournament_points_adjustments_participant_fk
    foreign key (
      organization_id, tournament_id, category_id, participant_set_id, participant_id
    )
    references public.tournament_competition_participants(
      organization_id, tournament_id, category_id, participant_set_id, id
    ) on delete restrict,
  constraint tournament_points_adjustments_phase_fk
    foreign key (
      organization_id, tournament_id, category_id, fixture_version_id, phase_id
    )
    references public.tournament_phases(
      organization_id, tournament_id, category_id, fixture_version_id, id
    ) on delete restrict,
  constraint tournament_points_adjustments_group_fk
    foreign key (
      organization_id, tournament_id, category_id, fixture_version_id, phase_id, group_id
    )
    references public.tournament_groups(
      organization_id, tournament_id, category_id, fixture_version_id, phase_id, id
    ) on delete restrict,
  constraint tournament_points_adjustments_points_check check (points between -99 and 99),
  constraint tournament_points_adjustments_status_check check (status in ('active', 'revoked')),
  constraint tournament_points_adjustments_reason_check
    check (reason = btrim(reason) and char_length(reason) between 3 and 1000),
  constraint tournament_points_adjustments_lifecycle_check
    check ((status = 'active' and revoked_at is null)
      or (status = 'revoked' and revoked_at is not null)),
  constraint tournament_points_adjustments_idempotency_unique
    unique (organization_id, actor_user_id, idempotency_key)
);

create table public.tournament_qualification_slots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  fixture_version_id uuid not null,
  source_phase_id uuid not null,
  source_group_id uuid,
  match_source_id uuid not null,
  slot_type text not null,
  rank_number integer not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint tournament_qualification_slots_source_fk
    foreign key (match_source_id)
    references public.tournament_match_sources(id) on delete restrict,
  constraint tournament_qualification_slots_type_check
    check (slot_type in (
      'group_position', 'league_position', 'best_third', 'winner_of_match',
      'loser_of_match', 'winner_of_tie', 'loser_of_tie', 'manual'
    )),
  constraint tournament_qualification_slots_rank_check check (rank_number > 0),
  constraint tournament_qualification_slots_status_check check (status in ('active', 'archived')),
  constraint tournament_qualification_slots_source_unique unique (match_source_id)
);

create table public.tournament_qualification_resolutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  fixture_version_id uuid not null,
  standings_revision_id uuid not null,
  slot_id uuid not null,
  participant_id uuid not null,
  target_match_id uuid not null,
  target_side text not null,
  status text not null default 'resolved',
  reason text,
  resolved_by uuid not null references auth.users(id) on delete restrict,
  resolved_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint tournament_qualification_resolutions_revision_fk
    foreign key (organization_id, standings_revision_id)
    references public.tournament_standings_revisions(organization_id, id) on delete restrict,
  constraint tournament_qualification_resolutions_slot_fk
    foreign key (slot_id) references public.tournament_qualification_slots(id) on delete restrict,
  constraint tournament_qualification_resolutions_participant_fk
    foreign key (participant_id)
    references public.tournament_competition_participants(id) on delete restrict,
  constraint tournament_qualification_resolutions_match_fk
    foreign key (
      organization_id, tournament_id, category_id, fixture_version_id, target_match_id
    )
    references public.tournament_matches(
      organization_id, tournament_id, category_id, fixture_version_id, id
    ) on delete restrict,
  constraint tournament_qualification_resolutions_side_check check (target_side in ('home', 'away')),
  constraint tournament_qualification_resolutions_status_check
    check (status in ('resolved', 'blocked', 'manual', 'superseded')),
  constraint tournament_qualification_resolutions_reason_check
    check (reason is null or char_length(reason) <= 1000)
);

create unique index tournament_qualification_resolutions_current_unique
  on public.tournament_qualification_resolutions(slot_id)
  where status in ('resolved', 'blocked', 'manual');

create or replace function public.can_read_tournament_projection_scope(
  p_organization_id uuid,
  p_tournament_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournament_organizations organization
    join public.tournaments tournament
      on tournament.organization_id = organization.id
    where organization.id = p_organization_id
      and tournament.id = p_tournament_id
      and organization.status = 'active'
      and tournament.status <> 'archived'
      and (
        public.has_tournament_organization_capability(p_organization_id, 'standings.read')
        or exists (
          select 1
          from public.tournament_team_entries entry
          join public.tournament_team_managers manager on manager.team_entry_id = entry.id
          where entry.organization_id = p_organization_id
            and entry.tournament_id = p_tournament_id
            and manager.user_id = auth.uid()
            and manager.status = 'active'
        )
        or exists (
          select 1
          from public.tournament_team_entries entry
          join public.tournament_roster_players player on player.team_entry_id = entry.id
          where entry.organization_id = p_organization_id
            and entry.tournament_id = p_tournament_id
            and player.arma2_user_id = auth.uid()
            and player.status = 'active'
        )
      )
  );
$$;

create or replace function public.create_tournament_points_adjustment(
  p_organization_id uuid,
  p_fixture_version_id uuid,
  p_phase_id uuid,
  p_group_id uuid,
  p_participant_id uuid,
  p_points integer,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.tournament_fixture_versions%rowtype;
  v_adjustment public.tournament_points_adjustments%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_adjustment
  from public.tournament_points_adjustments
  where organization_id = p_organization_id
    and actor_user_id = auth.uid()
    and idempotency_key = p_idempotency_key;
  if v_adjustment.id is not null then return v_adjustment.id; end if;

  select * into v_fixture
  from public.tournament_fixture_versions
  where id = p_fixture_version_id
    and organization_id = p_organization_id
    and status = 'published'
  for share;
  if v_fixture.id is null
    or not public.has_tournament_organization_capability(
      p_organization_id, 'standings.override'
    )
    or not exists (
      select 1 from public.tournament_scoring_rules scoring
      where scoring.tournament_id = v_fixture.tournament_id
        and scoring.organization_id = p_organization_id
        and scoring.allow_manual_points_adjustment
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_STANDINGS_FORBIDDEN';
  end if;
  if p_points is null or p_points = 0 or p_points not between -99 and 99
    or p_idempotency_key is null
    or char_length(btrim(coalesce(p_reason, ''))) < 3
    or not exists (
      select 1
      from public.tournament_phases phase
      join public.tournament_competition_participants participant
        on participant.organization_id = phase.organization_id
        and participant.tournament_id = phase.tournament_id
        and participant.category_id = phase.category_id
        and participant.participant_set_id = v_fixture.participant_set_id
      where phase.id = p_phase_id
        and phase.fixture_version_id = v_fixture.id
        and participant.id = p_participant_id
        and (
          p_group_id is null
          or exists (
            select 1 from public.tournament_group_members member
            where member.group_id = p_group_id
              and member.participant_id = participant.id
          )
        )
    )
  then
    raise exception using errcode = '22023', message = 'TORNEOS_STANDINGS_SCOPE_INVALID';
  end if;

  insert into public.tournament_points_adjustments (
    organization_id, tournament_id, category_id, participant_set_id,
    fixture_version_id, phase_id, group_id, participant_id, points,
    reason, actor_user_id, idempotency_key
  ) values (
    p_organization_id, v_fixture.tournament_id, v_fixture.category_id,
    v_fixture.participant_set_id, v_fixture.id, p_phase_id, p_group_id,
    p_participant_id, p_points, btrim(p_reason), auth.uid(), p_idempotency_key
  ) returning * into v_adjustment;

  perform public.append_tournament_audit(
    p_organization_id, 'standings.points_adjust', 'points_adjustment',
    v_adjustment.id, null, v_fixture.tournament_id,
    jsonb_build_object(
      'participantId', p_participant_id, 'points', p_points,
      'phaseId', p_phase_id, 'groupId', p_group_id, 'reason', btrim(p_reason)
    )
  );
  return v_adjustment.id;
end;
$$;

create or replace function public.revoke_tournament_points_adjustment(
  p_adjustment_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adjustment public.tournament_points_adjustments%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_adjustment
  from public.tournament_points_adjustments
  where id = p_adjustment_id for update;
  if v_adjustment.id is null or not public.has_tournament_organization_capability(
    v_adjustment.organization_id, 'standings.override'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_STANDINGS_FORBIDDEN';
  end if;
  if v_adjustment.status = 'revoked' then return v_adjustment.id; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'TORNEOS_STANDINGS_REASON_REQUIRED';
  end if;
  update public.tournament_points_adjustments
  set status = 'revoked', revoked_at = now()
  where id = v_adjustment.id;
  perform public.append_tournament_audit(
    v_adjustment.organization_id, 'standings.points_adjust_revoke',
    'points_adjustment', v_adjustment.id, null, v_adjustment.tournament_id,
    jsonb_build_object('reason', btrim(p_reason))
  );
  return v_adjustment.id;
end;
$$;

create or replace function public.tournament_projection_source_fingerprint(
  p_fixture_version_id uuid,
  p_phase_id uuid,
  p_group_id uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(public.digest(
    coalesce(string_agg(
      operation.id::text || ':' || operation.operation_version::text || ':'
      || operation.official_at::text || ':' || coalesce(score.home_score::text, '-') || ':'
      || coalesce(score.away_score::text, '-') || ':' || outcome.outcome_type,
      '|' order by match_row.match_number, operation.id
    ), 'empty'),
    'sha256'
  ), 'hex')
  from public.tournament_matches match_row
  join public.tournament_match_operations operation
    on operation.match_id = match_row.id and operation.status = 'official'
  join public.tournament_match_outcomes outcome
    on outcome.match_operation_id = operation.id
  left join public.tournament_match_scores score
    on score.match_operation_id = operation.id
  where match_row.fixture_version_id = p_fixture_version_id
    and match_row.phase_id = p_phase_id
    and match_row.group_id is not distinct from p_group_id;
$$;

create or replace function public.rank_tournament_standings(p_revision_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_rule record;
  v_pass integer;
  v_partitions_before integer;
  v_partitions_after integer;
begin
  create temporary table if not exists pg_temp.tournament_rank_work (
    participant_id uuid primary key,
    rank_key text not null default '',
    criterion_value numeric not null default 0,
    trace jsonb not null default '{}'::jsonb
  ) on commit drop;
  truncate pg_temp.tournament_rank_work;

  insert into pg_temp.tournament_rank_work(participant_id, rank_key, trace)
  select participant_id,
    lpad((1000000 - points)::text, 7, '0'),
    jsonb_build_object('points', points)
  from public.tournament_team_standings
  where revision_id = p_revision_id;

  for v_rule in
    select rule.criterion, rule.sort_order
    from public.tournament_standings_revisions revision
    join public.tournament_tiebreak_rules rule
      on rule.tournament_id = revision.tournament_id
    where revision.id = p_revision_id
    order by rule.sort_order
  loop
    if v_rule.criterion = 'goal_difference' then
      update pg_temp.tournament_rank_work work set criterion_value = standing.goal_difference
      from public.tournament_team_standings standing
      where standing.revision_id = p_revision_id
        and standing.participant_id = work.participant_id;
    elsif v_rule.criterion = 'goals_for' then
      update pg_temp.tournament_rank_work work set criterion_value = standing.goals_for
      from public.tournament_team_standings standing
      where standing.revision_id = p_revision_id
        and standing.participant_id = work.participant_id;
    elsif v_rule.criterion = 'matches_won' then
      update pg_temp.tournament_rank_work work set criterion_value = standing.won
      from public.tournament_team_standings standing
      where standing.revision_id = p_revision_id
        and standing.participant_id = work.participant_id;
    elsif v_rule.criterion = 'fair_play' then
      update pg_temp.tournament_rank_work work set criterion_value = -standing.fair_play_points
      from public.tournament_team_standings standing
      where standing.revision_id = p_revision_id
        and standing.participant_id = work.participant_id;
    elsif v_rule.criterion = 'head_to_head' then
      for v_pass in 1..16 loop
        select count(distinct rank_key) into v_partitions_before
        from pg_temp.tournament_rank_work;

        update pg_temp.tournament_rank_work set criterion_value = 0;
        update pg_temp.tournament_rank_work work
        set criterion_value = coalesce(
          mini.points * 1000000 + mini.goal_difference * 1000 + mini.goals_for,
          0
        )
        from (
        select team.participant_id,
          sum(case
            when team.goals_for > team.goals_against then scoring.points_win
            when team.goals_for = team.goals_against then scoring.points_draw
            else scoring.points_loss
          end)::numeric as points,
          sum(team.goals_for - team.goals_against)::numeric as goal_difference,
          sum(team.goals_for)::numeric as goals_for
        from (
          select home_work.rank_key, match_row.home_participant_id as participant_id,
            score.home_score::integer as goals_for, score.away_score::integer as goals_against,
            revision.tournament_id
          from public.tournament_standings_revisions revision
          join public.tournament_projection_sources source on source.revision_id = revision.id
          join public.tournament_matches match_row on match_row.id = source.match_id
          join public.tournament_match_scores score on score.match_operation_id = source.match_operation_id
          join pg_temp.tournament_rank_work home_work
            on home_work.participant_id = match_row.home_participant_id
          join pg_temp.tournament_rank_work away_work
            on away_work.participant_id = match_row.away_participant_id
            and away_work.rank_key = home_work.rank_key
          where revision.id = p_revision_id
          union all
          select away_work.rank_key, match_row.away_participant_id,
            score.away_score::integer, score.home_score::integer,
            revision.tournament_id
          from public.tournament_standings_revisions revision
          join public.tournament_projection_sources source on source.revision_id = revision.id
          join public.tournament_matches match_row on match_row.id = source.match_id
          join public.tournament_match_scores score on score.match_operation_id = source.match_operation_id
          join pg_temp.tournament_rank_work away_work
            on away_work.participant_id = match_row.away_participant_id
          join pg_temp.tournament_rank_work home_work
            on home_work.participant_id = match_row.home_participant_id
            and home_work.rank_key = away_work.rank_key
          where revision.id = p_revision_id
        ) team
        join public.tournament_scoring_rules scoring on scoring.tournament_id = team.tournament_id
        group by team.rank_key, team.participant_id
        ) mini
        where mini.participant_id = work.participant_id;

        update pg_temp.tournament_rank_work
        set rank_key = rank_key || ':' ||
              lpad((1000000000 - criterion_value)::bigint::text, 10, '0'),
          trace = trace || jsonb_build_object(
            'head_to_head_' || v_pass::text,
            jsonb_build_object(
              'composite', criterion_value,
              'pointsWeight', 1000000,
              'goalDifferenceWeight', 1000,
              'goalsForWeight', 1
            )
          );

        select count(distinct rank_key) into v_partitions_after
        from pg_temp.tournament_rank_work;
        exit when v_partitions_after = v_partitions_before
          or not exists (
            select 1
            from pg_temp.tournament_rank_work work
            join pg_temp.tournament_rank_work peer
              on peer.participant_id <> work.participant_id
              and peer.rank_key = work.rank_key
          );
      end loop;
      continue;
    else
      update pg_temp.tournament_rank_work work
      set criterion_value = 0;
    end if;

    update pg_temp.tournament_rank_work
    set rank_key = rank_key || ':' || lpad((1000000000 - criterion_value)::bigint::text, 10, '0'),
        trace = trace || jsonb_build_object(v_rule.criterion, criterion_value);
  end loop;

  update public.tournament_team_standings standing
  set classification_status = 'manual_review',
      tiebreak_trace = work.trace || jsonb_build_object(
        'manualReview', true,
        'reason', 'Los criterios deportivos configurados no resolvieron el empate.'
      )
  from pg_temp.tournament_rank_work work
  where standing.revision_id = p_revision_id
    and standing.participant_id = work.participant_id
    and exists (
      select 1
      from pg_temp.tournament_rank_work peer
      where peer.participant_id <> work.participant_id
        and peer.rank_key = work.rank_key
    );

  update pg_temp.tournament_rank_work
  set rank_key = rank_key || ':' || participant_id::text,
      trace = trace || jsonb_build_object(
        'deterministicSeed', participant_id,
        'seedPurpose', 'Orden visual estable hasta resolver el empate manual.'
      );

  update public.tournament_team_standings standing
  set position = ranked.position,
      tiebreak_trace = coalesce(standing.tiebreak_trace, '{}'::jsonb) || ranked.trace
  from (
    select participant_id, trace,
      row_number() over (order by rank_key)::integer as position
    from pg_temp.tournament_rank_work
  ) ranked
  where standing.revision_id = p_revision_id
    and standing.participant_id = ranked.participant_id;
end;
$$;

create or replace function public.rebuild_tournament_standings(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_phase_id uuid,
  p_group_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.tournament_standings_revisions%rowtype;
  v_fixture public.tournament_fixture_versions%rowtype;
  v_phase public.tournament_phases%rowtype;
  v_scoring public.tournament_scoring_rules%rowtype;
  v_discipline public.tournament_discipline_rules%rowtype;
  v_number integer;
  v_fingerprint text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id, 'standings.rebuild'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_STANDINGS_FORBIDDEN';
  end if;
  if p_idempotency_key is null or char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'TORNEOS_STANDINGS_REASON_REQUIRED';
  end if;

  select * into v_revision
  from public.tournament_standings_revisions
  where organization_id = p_organization_id
    and calculated_by = auth.uid()
    and idempotency_key = p_idempotency_key;
  if v_revision.id is not null then return v_revision.id; end if;

  select fixture.* into v_fixture
  from public.tournament_fixture_versions fixture
  join public.tournaments tournament
    on tournament.organization_id = fixture.organization_id
    and tournament.id = fixture.tournament_id
  where fixture.organization_id = p_organization_id
    and fixture.tournament_id = p_tournament_id
    and fixture.category_id = p_category_id
    and fixture.status = 'published'
    and tournament.status <> 'archived'
  for update of fixture;
  if v_fixture.id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_STANDINGS_SCOPE_INVALID';
  end if;

  select * into v_phase from public.tournament_phases
  where organization_id = p_organization_id
    and tournament_id = p_tournament_id
    and category_id = p_category_id
    and fixture_version_id = v_fixture.id
    and id = p_phase_id
  for share;
  if v_phase.id is null or (
    p_group_id is not null and not exists (
      select 1 from public.tournament_groups group_row
      where group_row.id = p_group_id
        and group_row.organization_id = p_organization_id
        and group_row.tournament_id = p_tournament_id
        and group_row.category_id = p_category_id
        and group_row.fixture_version_id = v_fixture.id
        and group_row.phase_id = p_phase_id
        and group_row.status = 'published'
    )
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_STANDINGS_SCOPE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_tournament_id::text || ':'
    || p_category_id::text || ':' || p_phase_id::text || ':'
    || coalesce(p_group_id::text, 'all'),
    0
  ));

  if exists (
    select 1 from public.tournament_standings_revisions
    where fixture_version_id = v_fixture.id and phase_id = p_phase_id
      and group_id is not distinct from p_group_id and status = 'draft'
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_STANDINGS_DRAFT_EXISTS';
  end if;

  select * into strict v_scoring from public.tournament_scoring_rules
  where tournament_id = p_tournament_id;
  select * into strict v_discipline from public.tournament_discipline_rules
  where tournament_id = p_tournament_id;

  select coalesce(max(revision_number), 0) + 1 into v_number
  from public.tournament_standings_revisions
  where fixture_version_id = v_fixture.id and phase_id = p_phase_id
    and group_id is not distinct from p_group_id;
  v_fingerprint := public.tournament_projection_source_fingerprint(
    v_fixture.id, p_phase_id, p_group_id
  );

  insert into public.tournament_standings_revisions (
    organization_id, season_id, tournament_id, category_id, fixture_version_id,
    phase_id, group_id, revision_number, source_fingerprint,
    configuration_snapshot, rebuild_reason, calculated_by, idempotency_key
  ) values (
    p_organization_id, v_fixture.season_id, p_tournament_id, p_category_id,
    v_fixture.id, p_phase_id, p_group_id, v_number, v_fingerprint,
    jsonb_build_object(
      'scoring', to_jsonb(v_scoring) - 'created_at' - 'updated_at',
      'tiebreaks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'criterion', criterion, 'order', sort_order
        ) order by sort_order)
        from public.tournament_tiebreak_rules where tournament_id = p_tournament_id
      ), '[]'::jsonb),
      'discipline', to_jsonb(v_discipline) - 'created_at' - 'updated_at',
      'algorithmVersion', 1
    ),
    btrim(p_reason), auth.uid(), p_idempotency_key
  ) returning * into v_revision;

  insert into public.tournament_projection_sources (
    revision_id, organization_id, match_operation_id, match_id, official_at
  )
  select v_revision.id, p_organization_id, operation.id, match_row.id, operation.official_at
  from public.tournament_matches match_row
  join public.tournament_match_operations operation
    on operation.match_id = match_row.id and operation.status = 'official'
  join public.tournament_match_outcomes outcome
    on outcome.match_operation_id = operation.id
  where match_row.fixture_version_id = v_fixture.id
    and match_row.phase_id = p_phase_id
    and match_row.group_id is not distinct from p_group_id
    and (outcome.counts_for_standings or outcome.counts_for_player_stats);

  insert into public.tournament_team_standings (
    revision_id, organization_id, tournament_id, category_id, phase_id, group_id,
    participant_id, team_entry_id, played, won, drawn, lost, goals_for,
    goals_against, goal_difference, base_points, points_adjustment, points,
    walkovers, administrative_results, fair_play_points
  )
  with participants as (
    select participant.id, participant.team_entry_id
    from public.tournament_competition_participants participant
    where participant.participant_set_id = v_fixture.participant_set_id
      and participant.status = 'active'
      and (
        p_group_id is null
        or exists (
          select 1 from public.tournament_group_members member
          where member.group_id = p_group_id and member.participant_id = participant.id
        )
      )
  ), team_matches as (
    select match_row.home_participant_id as participant_id,
      score.home_score::integer as gf, score.away_score::integer as ga,
      outcome.outcome_type
    from public.tournament_projection_sources source
    join public.tournament_matches match_row on match_row.id = source.match_id
    join public.tournament_match_outcomes outcome
      on outcome.match_operation_id = source.match_operation_id
    join public.tournament_match_scores score
      on score.match_operation_id = source.match_operation_id
    where source.revision_id = v_revision.id and outcome.counts_for_standings
    union all
    select match_row.away_participant_id, score.away_score::integer,
      score.home_score::integer, outcome.outcome_type
    from public.tournament_projection_sources source
    join public.tournament_matches match_row on match_row.id = source.match_id
    join public.tournament_match_outcomes outcome
      on outcome.match_operation_id = source.match_operation_id
    join public.tournament_match_scores score
      on score.match_operation_id = source.match_operation_id
    where source.revision_id = v_revision.id and outcome.counts_for_standings
  ), cards as (
    select event.team_entry_id,
      sum(case
        when event.event_type in ('yellow_card', 'second_yellow')
          then v_discipline.yellow_fair_play_points
        when event.event_type = 'red_card' then v_discipline.red_fair_play_points
        else 0
      end)::integer fair_play
    from public.tournament_projection_sources source
    join public.tournament_match_events event
      on event.match_operation_id = source.match_operation_id and event.voided_at is null
    where source.revision_id = v_revision.id
    group by event.team_entry_id
  ), aggregated as (
    select participant.id participant_id, participant.team_entry_id,
      count(team_match.*)::integer played,
      count(*) filter (where team_match.gf > team_match.ga)::integer won,
      count(*) filter (where team_match.gf = team_match.ga)::integer drawn,
      count(*) filter (where team_match.gf < team_match.ga)::integer lost,
      coalesce(sum(team_match.gf), 0)::integer gf,
      coalesce(sum(team_match.ga), 0)::integer ga,
      coalesce(sum(case
        when team_match.gf > team_match.ga
          and team_match.outcome_type like 'walkover_%'
          then coalesce(v_scoring.points_walkover_win, v_scoring.points_win)
        when team_match.gf < team_match.ga
          and team_match.outcome_type like 'walkover_%'
          then coalesce(v_scoring.points_walkover_loss, v_scoring.points_loss)
        when team_match.gf > team_match.ga then v_scoring.points_win
        when team_match.gf = team_match.ga then v_scoring.points_draw
        else v_scoring.points_loss
      end), 0)::integer base_points,
      count(*) filter (where team_match.outcome_type like 'walkover_%')::integer walkovers,
      count(*) filter (where team_match.outcome_type = 'administrative_result')::integer administrative
    from participants participant
    left join team_matches team_match on team_match.participant_id = participant.id
    group by participant.id, participant.team_entry_id
  )
  select v_revision.id, p_organization_id, p_tournament_id, p_category_id,
    p_phase_id, p_group_id, aggregated.participant_id, aggregated.team_entry_id,
    aggregated.played, aggregated.won, aggregated.drawn, aggregated.lost,
    aggregated.gf, aggregated.ga, aggregated.gf - aggregated.ga,
    aggregated.base_points,
    coalesce(adjustment.points, 0),
    aggregated.base_points + coalesce(adjustment.points, 0),
    aggregated.walkovers, aggregated.administrative,
    coalesce(cards.fair_play, 0)
  from aggregated
  left join cards on cards.team_entry_id = aggregated.team_entry_id
  left join lateral (
    select sum(points)::integer points
    from public.tournament_points_adjustments
    where organization_id = p_organization_id
      and tournament_id = p_tournament_id and category_id = p_category_id
      and participant_set_id = v_fixture.participant_set_id
      and fixture_version_id = v_fixture.id
      and phase_id = p_phase_id and group_id is not distinct from p_group_id
      and participant_id = aggregated.participant_id and status = 'active'
  ) adjustment on true;

  perform public.rank_tournament_standings(v_revision.id);

  insert into public.tournament_player_statistics (
    revision_id, organization_id, tournament_id, category_id,
    roster_player_id, team_entry_id, squad_calls, appearances, starts,
    substitute_appearances, goals, own_goals, assists, penalty_goals,
    penalties_missed, yellow_cards, second_yellows, red_cards, captaincies
  )
  with players as (
    select operation_player.roster_player_id, operation_player.team_entry_id,
      count(distinct operation_player.match_operation_id)::integer squad_calls,
      count(distinct operation_player.match_operation_id)
        filter (where operation_player.attendance_status in ('present', 'late'))::integer appearances,
      count(distinct operation_player.match_operation_id)
        filter (where operation_player.lineup_status = 'starter'
          and operation_player.attendance_status in ('present', 'late'))::integer starts,
      count(distinct operation_player.match_operation_id)
        filter (where operation_player.lineup_status = 'substitute'
          and operation_player.attendance_status in ('present', 'late'))::integer substitutes,
      count(distinct operation_player.match_operation_id)
        filter (where operation_player.is_captain)::integer captaincies
    from public.tournament_projection_sources source
    join public.tournament_match_operation_players operation_player
      on operation_player.match_operation_id = source.match_operation_id
    join public.tournament_match_outcomes outcome
      on outcome.match_operation_id = source.match_operation_id
    where source.revision_id = v_revision.id and outcome.counts_for_player_stats
    group by operation_player.roster_player_id, operation_player.team_entry_id
  ), events as (
    select event.roster_player_id,
      count(*) filter (where event.event_type = 'goal')::integer goals,
      count(*) filter (where event.event_type = 'own_goal')::integer own_goals,
      count(*) filter (where event.event_type = 'assist')::integer assists,
      count(*) filter (where event.event_type = 'penalty_goal')::integer penalty_goals,
      count(*) filter (where event.event_type = 'penalty_missed')::integer penalties_missed,
      count(*) filter (where event.event_type = 'yellow_card')::integer yellow_cards,
      count(*) filter (where event.event_type = 'second_yellow')::integer second_yellows,
      count(*) filter (where event.event_type = 'red_card')::integer red_cards
    from public.tournament_projection_sources source
    join public.tournament_match_events event
      on event.match_operation_id = source.match_operation_id and event.voided_at is null
    join public.tournament_match_outcomes outcome
      on outcome.match_operation_id = source.match_operation_id
    where source.revision_id = v_revision.id and outcome.counts_for_player_stats
      and event.roster_player_id is not null
    group by event.roster_player_id
  )
  select v_revision.id, p_organization_id, p_tournament_id, p_category_id,
    player.roster_player_id, player.team_entry_id, player.squad_calls,
    player.appearances, player.starts, player.substitutes,
    coalesce(event.goals, 0), coalesce(event.own_goals, 0),
    coalesce(event.assists, 0), coalesce(event.penalty_goals, 0),
    coalesce(event.penalties_missed, 0), coalesce(event.yellow_cards, 0),
    coalesce(event.second_yellows, 0), coalesce(event.red_cards, 0),
    player.captaincies
  from players player
  left join events event on event.roster_player_id = player.roster_player_id;

  insert into public.tournament_team_statistics (
    revision_id, organization_id, participant_id, team_entry_id, goals,
    own_goals_benefited, yellow_cards, second_yellows, red_cards,
    home_played, away_played, suspended_matches, administrative_matches
  )
  select v_revision.id, p_organization_id, standing.participant_id,
    standing.team_entry_id, standing.goals_for,
    (select count(*)::integer
      from public.tournament_projection_sources source
      join public.tournament_match_events event
        on event.match_operation_id = source.match_operation_id
        and event.voided_at is null
      where source.revision_id = v_revision.id
        and event.event_type = 'own_goal'
        and event.team_entry_id = standing.team_entry_id),
    coalesce(sum(player_stats.yellow_cards), 0)::integer,
    coalesce(sum(player_stats.second_yellows), 0)::integer,
    coalesce(sum(player_stats.red_cards), 0)::integer,
    (select count(*)::integer from public.tournament_projection_sources source
      join public.tournament_matches match_row on match_row.id = source.match_id
      where source.revision_id = v_revision.id
        and match_row.home_participant_id = standing.participant_id),
    (select count(*)::integer from public.tournament_projection_sources source
      join public.tournament_matches match_row on match_row.id = source.match_id
      where source.revision_id = v_revision.id
        and match_row.away_participant_id = standing.participant_id),
    (select count(*)::integer from public.tournament_projection_sources source
      join public.tournament_match_outcomes outcome
        on outcome.match_operation_id = source.match_operation_id
      join public.tournament_match_operations operation
        on operation.id = source.match_operation_id
      where source.revision_id = v_revision.id
        and outcome.outcome_type = 'suspended'
        and standing.team_entry_id in (
          operation.home_team_entry_id, operation.away_team_entry_id
        )),
    standing.administrative_results
  from public.tournament_team_standings standing
  left join public.tournament_player_statistics player_stats
    on player_stats.revision_id = standing.revision_id
    and player_stats.team_entry_id = standing.team_entry_id
  where standing.revision_id = v_revision.id
  group by standing.participant_id, standing.team_entry_id, standing.goals_for,
    standing.administrative_results;

  with form as (
    select standing.participant_id,
      source.official_at,
      case
        when (
          match_row.home_participant_id = standing.participant_id
          and score.home_score > score.away_score
        ) or (
          match_row.away_participant_id = standing.participant_id
          and score.away_score > score.home_score
        ) then 'W'
        when score.home_score = score.away_score then 'D'
        else 'L'
      end result,
      row_number() over (
        partition by standing.participant_id
        order by source.official_at desc, source.match_id
      ) form_order
    from public.tournament_team_standings standing
    join public.tournament_projection_sources source
      on source.revision_id = standing.revision_id
    join public.tournament_matches match_row
      on match_row.id = source.match_id
      and standing.participant_id in (
        match_row.home_participant_id, match_row.away_participant_id
      )
    join public.tournament_match_outcomes outcome
      on outcome.match_operation_id = source.match_operation_id
      and outcome.counts_for_standings
    join public.tournament_match_scores score
      on score.match_operation_id = source.match_operation_id
    where standing.revision_id = v_revision.id
  ), form_with_first as (
    select form.*,
      first_value(result) over (
        partition by participant_id order by form_order
      ) first_result
    from form
  ), streaks as (
    select form_with_first.*,
      sum(case when result = first_result then 0 else 1 end) over (
        partition by participant_id order by form_order
      ) break_count
    from form_with_first
  ), summary as (
    select participant_id,
      jsonb_agg(result order by form_order) filter (where form_order <= 5) recent_form,
      max(case when form_order = 1 then result end) first_result,
      count(*) filter (where break_count = 0)::integer streak_count
    from streaks
    group by participant_id
  )
  update public.tournament_team_statistics stats
  set recent_form = coalesce(summary.recent_form, '[]'::jsonb),
    streak_type = case summary.first_result
      when 'W' then 'win' when 'D' then 'draw' when 'L' then 'loss' end,
    streak_count = summary.streak_count
  from summary
  where stats.revision_id = v_revision.id
    and stats.participant_id = summary.participant_id;

  insert into public.tournament_discipline_ledgers (
    revision_id, organization_id, tournament_id, category_id, phase_id, group_id,
    roster_player_id, team_entry_id, yellow_cards, second_yellows, direct_reds,
    fair_play_points, automatic_suspensions
  )
  select v_revision.id, p_organization_id, p_tournament_id, p_category_id,
    p_phase_id, p_group_id, player.roster_player_id, player.team_entry_id,
    player.yellow_cards, player.second_yellows, player.red_cards,
    player.yellow_cards * v_discipline.yellow_fair_play_points
      + (player.second_yellows + player.red_cards) * v_discipline.red_fair_play_points,
    floor(player.yellow_cards::numeric / v_discipline.yellows_for_suspension)::integer
      + player.red_cards
      + case when v_discipline.double_yellow_counts_as_red
        then player.second_yellows else 0 end
  from public.tournament_player_statistics player
  where player.revision_id = v_revision.id
    and (player.yellow_cards + player.second_yellows + player.red_cards) > 0;

  insert into public.tournament_player_suspensions (
    revision_id, organization_id, tournament_id, category_id, phase_id, group_id,
    roster_player_id, team_entry_id, source_type, source_key, source_event_id,
    source_match_id, rule_snapshot, total_matches, reason
  )
  select v_revision.id, p_organization_id, p_tournament_id, p_category_id,
    p_phase_id, p_group_id, ledger.roster_player_id, ledger.team_entry_id,
    'yellow_accumulation', 'yellow-' || series.number::text, null, null,
    jsonb_build_object(
      'threshold', v_discipline.yellows_for_suspension,
      'matches', v_discipline.suspension_matches
    ),
    v_discipline.suspension_matches,
    'Acumulación de ' || v_discipline.yellows_for_suspension::text || ' amarillas'
  from public.tournament_discipline_ledgers ledger
  cross join lateral generate_series(
    1, floor(ledger.yellow_cards::numeric / v_discipline.yellows_for_suspension)::integer
  ) series(number)
  where ledger.revision_id = v_revision.id;

  insert into public.tournament_player_suspensions (
    revision_id, organization_id, tournament_id, category_id, phase_id, group_id,
    roster_player_id, team_entry_id, source_type, source_key, source_event_id,
    source_match_id, rule_snapshot, total_matches, reason
  )
  select v_revision.id, p_organization_id, p_tournament_id, p_category_id,
    p_phase_id, p_group_id, event.roster_player_id, event.team_entry_id,
    case when event.event_type = 'red_card' then 'direct_red' else 'second_yellow' end,
    event.match_id::text || ':' || event.event_type || ':' ||
      event.sequence_number::text,
    event.id, event.match_id,
    jsonb_build_object(
      'eventType', event.event_type,
      'matches', case when event.event_type = 'red_card'
        then coalesce(v_discipline.direct_red_suggested_matches, v_discipline.suspension_matches)
        else v_discipline.suspension_matches end
    ),
    case when event.event_type = 'red_card'
      then coalesce(v_discipline.direct_red_suggested_matches, v_discipline.suspension_matches)
      else v_discipline.suspension_matches end,
    case when event.event_type = 'red_card' then 'Roja directa' else 'Segunda amarilla' end
  from public.tournament_projection_sources source
  join public.tournament_match_events event
    on event.match_operation_id = source.match_operation_id and event.voided_at is null
  where source.revision_id = v_revision.id
    and (
      event.event_type = 'red_card'
      or (event.event_type = 'second_yellow' and v_discipline.double_yellow_counts_as_red)
    );

  perform public.append_tournament_audit(
    p_organization_id, 'standings.rebuild', 'standings_revision',
    v_revision.id, null, p_tournament_id,
    jsonb_build_object(
      'categoryId', p_category_id, 'phaseId', p_phase_id,
      'groupId', p_group_id, 'revisionNumber', v_number,
      'sourceFingerprint', v_fingerprint, 'reason', btrim(p_reason)
    )
  );
  return v_revision.id;
end;
$$;

create or replace function public.rebuild_tournament_discipline(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_phase_id uuid,
  p_group_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.rebuild_tournament_standings(
    p_organization_id, p_tournament_id, p_category_id, p_phase_id,
    p_group_id, p_reason, p_idempotency_key
  );
$$;

create or replace function public.publish_tournament_standings_revision(
  p_revision_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.tournament_standings_revisions%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_revision from public.tournament_standings_revisions
  where id = p_revision_id for update;
  if v_revision.id is null or not public.has_tournament_organization_capability(
    v_revision.organization_id, 'standings.publish'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_STANDINGS_FORBIDDEN';
  end if;
  if v_revision.status <> 'draft' then
    if v_revision.status = 'published' then return v_revision.id; end if;
    raise exception using errcode = '55000', message = 'TORNEOS_STANDINGS_NOT_PUBLISHABLE';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'TORNEOS_STANDINGS_REASON_REQUIRED';
  end if;
  if v_revision.source_fingerprint <> public.tournament_projection_source_fingerprint(
    v_revision.fixture_version_id, v_revision.phase_id, v_revision.group_id
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_STANDINGS_STALE';
  end if;

  update public.tournament_standings_revisions
  set status = 'superseded', superseded_at = now()
  where fixture_version_id = v_revision.fixture_version_id
    and phase_id = v_revision.phase_id
    and group_id is not distinct from v_revision.group_id
    and status = 'published';

  update public.tournament_player_suspensions suspension
  set status = 'superseded', updated_at = now()
  from public.tournament_standings_revisions revision
  where suspension.revision_id = revision.id
    and revision.fixture_version_id = v_revision.fixture_version_id
    and revision.phase_id = v_revision.phase_id
    and revision.group_id is not distinct from v_revision.group_id
    and revision.status = 'superseded'
    and suspension.status in ('active', 'reduced');

  with transferable as (
    select current_suspension.id current_suspension_id,
      served.organization_id, served.match_id, served.marked_by,
      served.marked_at, served.note,
      row_number() over (
        partition by current_suspension.id order by served.marked_at, served.match_id
      ) served_order,
      current_suspension.total_matches
    from public.tournament_player_suspensions current_suspension
    join public.tournament_player_suspensions previous_suspension
      on previous_suspension.organization_id = current_suspension.organization_id
      and previous_suspension.tournament_id = current_suspension.tournament_id
      and previous_suspension.roster_player_id = current_suspension.roster_player_id
      and previous_suspension.source_type = current_suspension.source_type
      and previous_suspension.source_key = current_suspension.source_key
      and previous_suspension.status in ('superseded', 'served')
    join public.tournament_standings_revisions previous_revision
      on previous_revision.id = previous_suspension.revision_id
      and previous_revision.status = 'superseded'
    join public.tournament_suspension_served_matches served
      on served.suspension_id = previous_suspension.id
    where current_suspension.revision_id = v_revision.id
      and current_suspension.status = 'pending'
  )
  insert into public.tournament_suspension_served_matches (
    suspension_id, organization_id, match_id, marked_by, marked_at, note
  )
  select current_suspension_id, organization_id, match_id, marked_by,
    marked_at, note
  from transferable
  where served_order <= total_matches
  on conflict (suspension_id, match_id) do nothing;

  update public.tournament_player_suspensions suspension
  set served_matches = least(suspension.total_matches, (
      select count(*) from public.tournament_suspension_served_matches served
      where served.suspension_id = suspension.id
    )),
    status = case when (
      select count(*) from public.tournament_suspension_served_matches served
      where served.suspension_id = suspension.id
    ) >= suspension.total_matches then 'served' else suspension.status end,
    updated_at = now()
  where suspension.revision_id = v_revision.id;

  update public.tournament_standings_revisions
  set status = 'published', published_by = auth.uid(), published_at = now()
  where id = v_revision.id;
  update public.tournament_player_suspensions
  set status = 'active', updated_at = now()
  where revision_id = v_revision.id and status = 'pending';

  perform public.append_tournament_audit(
    v_revision.organization_id, 'standings.publish', 'standings_revision',
    v_revision.id, null, v_revision.tournament_id,
    jsonb_build_object(
      'categoryId', v_revision.category_id, 'phaseId', v_revision.phase_id,
      'groupId', v_revision.group_id, 'reason', btrim(p_reason)
    )
  );
  return v_revision.id;
end;
$$;

create or replace function public.resolve_tournament_qualification(
  p_revision_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.tournament_standings_revisions%rowtype;
  v_source public.tournament_match_sources%rowtype;
  v_slot public.tournament_qualification_slots%rowtype;
  v_participant uuid;
  v_existing uuid;
  v_count integer := 0;
  v_blocked integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_revision from public.tournament_standings_revisions
  where id = p_revision_id and status = 'published' for share;
  if v_revision.id is null or not public.has_tournament_organization_capability(
    v_revision.organization_id, 'qualification.resolve'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_QUALIFICATION_FORBIDDEN';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'TORNEOS_QUALIFICATION_REASON_REQUIRED';
  end if;
  if exists (
    select 1 from public.tournament_matches match_row
    where match_row.fixture_version_id = v_revision.fixture_version_id
      and match_row.phase_id = v_revision.phase_id
      and match_row.group_id is not distinct from v_revision.group_id
      and match_row.home_participant_id is not null
      and match_row.away_participant_id is not null
      and not exists (
        select 1 from public.tournament_match_operations operation
        where operation.match_id = match_row.id and operation.status = 'official'
      )
  ) or exists (
    select 1 from public.tournament_match_outcomes outcome
    join public.tournament_match_operations operation
      on operation.id = outcome.match_operation_id and operation.status = 'official'
    join public.tournament_matches match_row on match_row.id = operation.match_id
    where match_row.fixture_version_id = v_revision.fixture_version_id
      and match_row.phase_id = v_revision.phase_id
      and match_row.group_id is not distinct from v_revision.group_id
      and outcome.requires_resolution
  ) or exists (
    select 1
    from public.tournament_match_reviews review
    join public.tournament_match_operations operation
      on operation.id = review.match_operation_id
    join public.tournament_matches match_row on match_row.id = operation.match_id
    where match_row.fixture_version_id = v_revision.fixture_version_id
      and match_row.phase_id = v_revision.phase_id
      and match_row.group_id is not distinct from v_revision.group_id
      and review.status = 'open'
      and review.review_type in (
        'correction', 'dispute_future', 'administrative_resolution'
      )
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_QUALIFICATION_INCOMPLETE';
  end if;
  if exists (
    select 1 from public.tournament_team_standings standing
    where standing.revision_id = v_revision.id
      and standing.classification_status = 'manual_review'
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_QUALIFICATION_AMBIGUOUS';
  end if;

  for v_source in
    select source.*
    from public.tournament_match_sources source
    where source.fixture_version_id = v_revision.fixture_version_id
      and (
        (source.source_type = 'group_position'
          and source.group_id is not distinct from v_revision.group_id)
        or (source.source_type = 'league_position'
          and source.source_phase_id = v_revision.phase_id)
        or (
          source.source_type in ('winner_of_match', 'loser_of_match')
          and exists (
            select 1 from public.tournament_matches source_match
            where source_match.id = source.source_match_id
              and source_match.phase_id = v_revision.phase_id
              and source_match.group_id is not distinct from v_revision.group_id
          )
        )
      )
    order by source.match_id, source.side
  loop
    if v_source.source_type in ('winner_of_match', 'loser_of_match') then
      select case
        when v_source.source_type = 'winner_of_match' then
          case when score.home_score > score.away_score
            then source_match.home_participant_id
            when score.away_score > score.home_score
            then source_match.away_participant_id end
        else
          case when score.home_score < score.away_score
            then source_match.home_participant_id
            when score.away_score < score.home_score
            then source_match.away_participant_id end
        end
      into v_participant
      from public.tournament_matches source_match
      join public.tournament_match_operations operation
        on operation.match_id = source_match.id and operation.status = 'official'
      join public.tournament_match_outcomes outcome
        on outcome.match_operation_id = operation.id
        and not outcome.requires_resolution
      join public.tournament_match_scores score
        on score.match_operation_id = operation.id
      where source_match.id = v_source.source_match_id;
    else
      select standing.participant_id into v_participant
      from public.tournament_team_standings standing
      where standing.revision_id = v_revision.id
        and standing.position = coalesce(
          v_source.position_number, v_source.rank_number
        );
    end if;
    if v_participant is null then
      raise exception using errcode = '55000', message = 'TORNEOS_QUALIFICATION_AMBIGUOUS';
    end if;

    insert into public.tournament_qualification_slots (
      organization_id, tournament_id, category_id, fixture_version_id,
      source_phase_id, source_group_id, match_source_id, slot_type, rank_number
    ) values (
      v_revision.organization_id, v_revision.tournament_id, v_revision.category_id,
      v_revision.fixture_version_id, v_revision.phase_id, v_revision.group_id,
      v_source.id, v_source.source_type,
      coalesce(v_source.position_number, v_source.rank_number, 1)
    )
    on conflict (match_source_id) do update set status = 'active'
    returning * into v_slot;

    select case when v_source.side = 'home'
      then match_row.home_participant_id else match_row.away_participant_id end
    into v_existing
    from public.tournament_matches match_row
    where match_row.id = v_source.match_id
    for update;

    if v_existing is not null and v_existing <> v_participant and exists (
      select 1 from public.tournament_match_operations operation
      where operation.match_id = v_source.match_id
    ) then
      update public.tournament_qualification_resolutions
      set status = 'superseded', superseded_at = now()
      where slot_id = v_slot.id and status in ('resolved', 'blocked', 'manual');

      insert into public.tournament_qualification_resolutions (
        organization_id, tournament_id, category_id, fixture_version_id,
        standings_revision_id, slot_id, participant_id, target_match_id,
        target_side, status, reason, resolved_by
      ) values (
        v_revision.organization_id, v_revision.tournament_id, v_revision.category_id,
        v_revision.fixture_version_id, v_revision.id, v_slot.id, v_participant,
        v_source.match_id, v_source.side, 'blocked',
        'El cruce posterior ya tiene un acta y requiere resolución manual.',
        auth.uid()
      )
      on conflict do nothing;
      v_blocked := v_blocked + 1;
      continue;
    end if;

    update public.tournament_qualification_resolutions
    set status = 'superseded', superseded_at = now()
    where slot_id = v_slot.id and status in ('resolved', 'blocked', 'manual');

    insert into public.tournament_qualification_resolutions (
      organization_id, tournament_id, category_id, fixture_version_id,
      standings_revision_id, slot_id, participant_id, target_match_id,
      target_side, status, reason, resolved_by
    ) values (
      v_revision.organization_id, v_revision.tournament_id, v_revision.category_id,
      v_revision.fixture_version_id, v_revision.id, v_slot.id, v_participant,
      v_source.match_id, v_source.side, 'resolved', btrim(p_reason), auth.uid()
    );

    update public.tournament_matches
    set home_participant_id = case when v_source.side = 'home'
        then v_participant else home_participant_id end,
      away_participant_id = case when v_source.side = 'away'
        then v_participant else away_participant_id end,
      updated_at = now()
    where id = v_source.match_id;
    v_count := v_count + 1;
  end loop;

  perform public.append_tournament_audit(
    v_revision.organization_id, 'qualification.resolve', 'standings_revision',
    v_revision.id, null, v_revision.tournament_id,
    jsonb_build_object('resolved', v_count, 'blocked', v_blocked, 'reason', btrim(p_reason))
  );
  return jsonb_build_object('resolved', v_count, 'blocked', v_blocked);
end;
$$;

create or replace function public.create_tournament_disciplinary_override(
  p_suspension_id uuid,
  p_action text,
  p_matches integer,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suspension public.tournament_player_suspensions%rowtype;
  v_override public.tournament_disciplinary_overrides%rowtype;
  v_previous jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_override from public.tournament_disciplinary_overrides
  where actor_user_id = auth.uid() and idempotency_key = p_idempotency_key;
  if v_override.id is not null then return v_override.id; end if;

  select * into v_suspension from public.tournament_player_suspensions
  where id = p_suspension_id for update;
  if v_suspension.id is null or not public.has_tournament_organization_capability(
    v_suspension.organization_id, 'discipline.override'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_DISCIPLINE_FORBIDDEN';
  end if;
  if p_action not in ('reduce', 'revoke', 'add_match')
    or char_length(btrim(coalesce(p_reason, ''))) < 3
    or p_idempotency_key is null
  then
    raise exception using errcode = '22023', message = 'TORNEOS_DISCIPLINE_OVERRIDE_INVALID';
  end if;
  v_previous := jsonb_build_object(
    'status', v_suspension.status, 'totalMatches', v_suspension.total_matches,
    'servedMatches', v_suspension.served_matches
  );

  if p_action = 'revoke' then
    update public.tournament_player_suspensions
    set status = 'revoked', updated_at = now()
    where id = v_suspension.id;
  elsif p_action = 'reduce' then
    if p_matches is null or p_matches < v_suspension.served_matches
      or p_matches >= v_suspension.total_matches
    then
      raise exception using errcode = '22023', message = 'TORNEOS_DISCIPLINE_OVERRIDE_INVALID';
    end if;
    update public.tournament_player_suspensions
    set total_matches = p_matches,
      status = case when served_matches >= p_matches then 'served' else 'reduced' end,
      updated_at = now()
    where id = v_suspension.id;
  else
    if p_matches is null or p_matches < 1
      or v_suspension.total_matches + p_matches > 24
    then
      raise exception using errcode = '22023', message = 'TORNEOS_DISCIPLINE_OVERRIDE_INVALID';
    end if;
    update public.tournament_player_suspensions
    set total_matches = total_matches + p_matches, status = 'active', updated_at = now()
    where id = v_suspension.id;
  end if;

  select * into v_suspension from public.tournament_player_suspensions
  where id = p_suspension_id;
  insert into public.tournament_disciplinary_overrides (
    organization_id, tournament_id, suspension_id, action, previous_state,
    new_state, reason, actor_user_id, idempotency_key
  ) values (
    v_suspension.organization_id, v_suspension.tournament_id, v_suspension.id,
    p_action, v_previous,
    jsonb_build_object(
      'status', v_suspension.status, 'totalMatches', v_suspension.total_matches,
      'servedMatches', v_suspension.served_matches
    ),
    btrim(p_reason), auth.uid(), p_idempotency_key
  ) returning * into v_override;

  perform public.append_tournament_audit(
    v_suspension.organization_id, 'discipline.override', 'player_suspension',
    v_suspension.id, v_suspension.team_entry_id, v_suspension.tournament_id,
    jsonb_build_object(
      'action', p_action, 'previous', v_previous,
      'new', v_override.new_state, 'reason', btrim(p_reason)
    )
  );
  return v_override.id;
end;
$$;

create or replace function public.mark_tournament_suspension_served(
  p_suspension_id uuid,
  p_match_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suspension public.tournament_player_suspensions%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_suspension from public.tournament_player_suspensions
  where id = p_suspension_id for update;
  if v_suspension.id is null or not public.has_tournament_organization_capability(
    v_suspension.organization_id, 'suspensions.mark_served'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_DISCIPLINE_FORBIDDEN';
  end if;
  if v_suspension.status not in ('active', 'reduced') then
    if v_suspension.status = 'served' then return v_suspension.id; end if;
    raise exception using errcode = '55000', message = 'TORNEOS_SUSPENSION_NOT_ACTIVE';
  end if;
  if not exists (
    select 1
    from public.tournament_matches match_row
    join public.tournament_competition_participants home
      on home.id = match_row.home_participant_id
    join public.tournament_competition_participants away
      on away.id = match_row.away_participant_id
    join public.tournament_match_operations operation
      on operation.match_id = match_row.id and operation.status = 'official'
    where match_row.id = p_match_id
      and match_row.organization_id = v_suspension.organization_id
      and match_row.tournament_id = v_suspension.tournament_id
      and match_row.id is distinct from v_suspension.source_match_id
      and v_suspension.team_entry_id in (home.team_entry_id, away.team_entry_id)
      and (
        (
          v_suspension.source_match_id is null
          and operation.official_at > v_suspension.created_at
        )
        or exists (
          select 1
          from public.tournament_match_operations source_operation
          where source_operation.match_id = v_suspension.source_match_id
            and source_operation.status in ('official', 'superseded')
            and operation.official_at > source_operation.official_at
        )
      )
      and not exists (
        select 1 from public.tournament_match_operation_players operation_player
        where operation_player.match_operation_id = operation.id
          and operation_player.roster_player_id = v_suspension.roster_player_id
          and operation_player.attendance_status in ('present', 'late')
      )
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_SUSPENSION_MATCH_INVALID';
  end if;

  insert into public.tournament_suspension_served_matches (
    suspension_id, organization_id, match_id, marked_by, note
  ) values (
    v_suspension.id, v_suspension.organization_id, p_match_id, auth.uid(), p_note
  ) on conflict (suspension_id, match_id) do nothing;

  update public.tournament_player_suspensions suspension
  set served_matches = least(total_matches, (
      select count(*) from public.tournament_suspension_served_matches served
      where served.suspension_id = suspension.id
    )),
    status = case when (
      select count(*) from public.tournament_suspension_served_matches served
      where served.suspension_id = suspension.id
    ) >= total_matches then 'served' else status end,
    updated_at = now()
  where suspension.id = v_suspension.id;

  perform public.append_tournament_audit(
    v_suspension.organization_id, 'suspension.mark_served', 'player_suspension',
    v_suspension.id, v_suspension.team_entry_id, v_suspension.tournament_id,
    jsonb_build_object('matchId', p_match_id, 'note', p_note)
  );
  return v_suspension.id;
end;
$$;

create or replace function public.get_tournament_standings_context(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_phase_id uuid,
  p_group_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_revision public.tournament_standings_revisions%rowtype;
  v_can_manage boolean;
begin
  if auth.uid() is null or not public.can_read_tournament_projection_scope(
    p_organization_id, p_tournament_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_STANDINGS_FORBIDDEN';
  end if;
  v_can_manage := public.has_tournament_organization_capability(
    p_organization_id, 'standings.rebuild'
  );
  select * into v_revision
  from public.tournament_standings_revisions
  where organization_id = p_organization_id and tournament_id = p_tournament_id
    and category_id = p_category_id and phase_id = p_phase_id
    and group_id is not distinct from p_group_id
    and (status = 'published' or (v_can_manage and status = 'draft'))
  order by case status when 'draft' then 0 else 1 end, revision_number desc
  limit 1;

  return jsonb_build_object(
    'canManage', v_can_manage,
    'revision', case when v_revision.id is null then null else jsonb_build_object(
      'id', v_revision.id, 'number', v_revision.revision_number,
      'status', v_revision.status, 'calculatedAt', v_revision.calculated_at,
      'publishedAt', v_revision.published_at, 'reason', v_revision.rebuild_reason,
      'sourceFingerprint', v_revision.source_fingerprint
    ) end,
    'standings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', standing.position, 'participantId', standing.participant_id,
        'teamEntryId', standing.team_entry_id, 'teamName', participant.snapshot_name,
        'shortName', participant.snapshot_short_name,
        'shieldPath', participant.snapshot_shield_path,
        'played', standing.played, 'won', standing.won, 'drawn', standing.drawn,
        'lost', standing.lost, 'goalsFor', standing.goals_for,
        'goalsAgainst', standing.goals_against,
        'goalDifference', standing.goal_difference, 'points', standing.points,
        'pointsAdjustment', standing.points_adjustment,
        'walkovers', standing.walkovers,
        'administrativeResults', standing.administrative_results,
        'fairPlayPoints', standing.fair_play_points,
        'classificationStatus', standing.classification_status,
        'tiebreakTrace', standing.tiebreak_trace
      ) order by standing.position)
      from public.tournament_team_standings standing
      join public.tournament_competition_participants participant
        on participant.id = standing.participant_id
      where standing.revision_id = v_revision.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_tournament_statistics_context(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_phase_id uuid,
  p_group_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_revision_id uuid;
  v_can_manage boolean;
begin
  if auth.uid() is null or not public.can_read_tournament_projection_scope(
    p_organization_id, p_tournament_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_STATISTICS_FORBIDDEN';
  end if;
  v_can_manage := public.has_tournament_organization_capability(
    p_organization_id, 'statistics.rebuild'
  );
  select id into v_revision_id
  from public.tournament_standings_revisions
  where organization_id = p_organization_id and tournament_id = p_tournament_id
    and category_id = p_category_id and phase_id = p_phase_id
    and group_id is not distinct from p_group_id
    and (status = 'published' or (v_can_manage and status = 'draft'))
  order by case status when 'draft' then 0 else 1 end, revision_number desc limit 1;

  return jsonb_build_object(
    'revisionId', v_revision_id,
    'canManage', v_can_manage,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rosterPlayerId', stats.roster_player_id, 'teamEntryId', stats.team_entry_id,
        'name', player.display_name, 'avatarUrl', player.avatar_url,
        'goals', stats.goals, 'ownGoals', stats.own_goals,
        'assists', stats.assists, 'appearances', stats.appearances,
        'starts', stats.starts, 'substituteAppearances', stats.substitute_appearances,
        'yellowCards', stats.yellow_cards, 'secondYellows', stats.second_yellows,
        'redCards', stats.red_cards, 'captaincies', stats.captaincies
      ) order by stats.goals desc, stats.assists desc, player.display_name)
      from public.tournament_player_statistics stats
      join public.tournament_roster_players player on player.id = stats.roster_player_id
      where stats.revision_id = v_revision_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participantId', stats.participant_id, 'teamEntryId', stats.team_entry_id,
        'name', participant.snapshot_name, 'shieldPath', participant.snapshot_shield_path,
        'goals', stats.goals, 'yellowCards', stats.yellow_cards,
        'secondYellows', stats.second_yellows, 'redCards', stats.red_cards,
        'homePlayed', stats.home_played, 'awayPlayed', stats.away_played,
        'administrativeMatches', stats.administrative_matches
      ) order by stats.goals desc, participant.snapshot_name)
      from public.tournament_team_statistics stats
      join public.tournament_competition_participants participant
        on participant.id = stats.participant_id
      where stats.revision_id = v_revision_id
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
            'id', suspension.id, 'sourceType', suspension.source_type,
            'totalMatches', suspension.total_matches,
            'servedMatches', suspension.served_matches,
            'status', suspension.status, 'reason', suspension.reason
          ) order by suspension.created_at)
          from public.tournament_player_suspensions suspension
          where suspension.revision_id = ledger.revision_id
            and suspension.roster_player_id = ledger.roster_player_id
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

create or replace function public.get_player_tournament_statistics(
  p_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'revisionId', stats.revision_id, 'rosterPlayerId', stats.roster_player_id,
      'teamEntryId', stats.team_entry_id, 'goals', stats.goals,
      'assists', stats.assists, 'appearances', stats.appearances,
      'starts', stats.starts, 'yellowCards', stats.yellow_cards,
      'secondYellows', stats.second_yellows, 'redCards', stats.red_cards
    ) order by revision.published_at desc)
    from public.tournament_player_statistics stats
    join public.tournament_roster_players player
      on player.id = stats.roster_player_id and player.arma2_user_id = auth.uid()
    join public.tournament_standings_revisions revision
      on revision.id = stats.revision_id and revision.status = 'published'
    where stats.tournament_id = p_tournament_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_player_tournament_suspensions(
  p_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', suspension.id, 'teamEntryId', suspension.team_entry_id,
      'sourceType', suspension.source_type, 'reason', suspension.reason,
      'totalMatches', suspension.total_matches,
      'servedMatches', suspension.served_matches, 'status', suspension.status,
      'servedIn', coalesce((
        select jsonb_agg(served.match_id order by served.marked_at)
        from public.tournament_suspension_served_matches served
        where served.suspension_id = suspension.id
      ), '[]'::jsonb)
    ) order by suspension.created_at desc)
    from public.tournament_player_suspensions suspension
    join public.tournament_roster_players player
      on player.id = suspension.roster_player_id and player.arma2_user_id = auth.uid()
    join public.tournament_standings_revisions revision
      on revision.id = suspension.revision_id and revision.status = 'published'
    where suspension.tournament_id = p_tournament_id
      and suspension.status <> 'superseded'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.reject_tournament_projection_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception using errcode = '42501', message = 'TORNEOS_PROJECTION_IMMUTABLE';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.reject_suspended_tournament_squad_player()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_match_id uuid;
begin
  select squad.match_id into v_match_id
  from public.tournament_match_squads squad where squad.id = new.match_squad_id;
  if exists (
    select 1
    from public.tournament_player_suspensions suspension
    join public.tournament_standings_revisions revision
      on revision.id = suspension.revision_id and revision.status = 'published'
    where suspension.roster_player_id = new.roster_player_id
      and suspension.status in ('active', 'reduced')
      and suspension.served_matches < suspension.total_matches
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_PLAYER_SUSPENDED';
  end if;
  return new;
end;
$$;

create trigger tournament_standings_revisions_no_delete
before delete on public.tournament_standings_revisions
for each row execute function public.reject_tournament_projection_mutation();
create trigger tournament_team_standings_immutable
before update or delete on public.tournament_team_standings
for each row execute function public.reject_tournament_projection_mutation();
create trigger tournament_team_statistics_immutable
before update or delete on public.tournament_team_statistics
for each row execute function public.reject_tournament_projection_mutation();
create trigger tournament_player_statistics_immutable
before update or delete on public.tournament_player_statistics
for each row execute function public.reject_tournament_projection_mutation();
create trigger tournament_discipline_ledgers_immutable
before update or delete on public.tournament_discipline_ledgers
for each row execute function public.reject_tournament_projection_mutation();
create trigger tournament_squad_player_suspension_guard
before insert or update on public.tournament_match_squad_players
for each row execute function public.reject_suspended_tournament_squad_player();

alter table public.tournament_standings_revisions enable row level security;
alter table public.tournament_projection_sources enable row level security;
alter table public.tournament_team_standings enable row level security;
alter table public.tournament_team_statistics enable row level security;
alter table public.tournament_player_statistics enable row level security;
alter table public.tournament_discipline_ledgers enable row level security;
alter table public.tournament_player_suspensions enable row level security;
alter table public.tournament_suspension_served_matches enable row level security;
alter table public.tournament_disciplinary_overrides enable row level security;
alter table public.tournament_points_adjustments enable row level security;
alter table public.tournament_qualification_slots enable row level security;
alter table public.tournament_qualification_resolutions enable row level security;

create policy tournament_standings_revisions_select_scope
on public.tournament_standings_revisions for select to authenticated
using (
  public.can_read_tournament_projection_scope(organization_id, tournament_id)
  and (
    status = 'published'
    or public.has_tournament_organization_capability(organization_id, 'standings.rebuild')
  )
);
create policy tournament_projection_sources_select_scope
on public.tournament_projection_sources for select to authenticated
using (exists (
  select 1 from public.tournament_standings_revisions revision
  where revision.id = revision_id
    and revision.organization_id = organization_id
    and (
      revision.status = 'published'
      or public.has_tournament_organization_capability(organization_id, 'standings.rebuild')
    )
    and public.can_read_tournament_projection_scope(
      revision.organization_id, revision.tournament_id
    )
));
create policy tournament_team_standings_select_scope
on public.tournament_team_standings for select to authenticated
using (exists (
  select 1 from public.tournament_standings_revisions revision
  where revision.id = revision_id and revision.organization_id = organization_id
    and (
      revision.status = 'published'
      or public.has_tournament_organization_capability(organization_id, 'standings.rebuild')
    )
    and public.can_read_tournament_projection_scope(
      revision.organization_id, revision.tournament_id
    )
));
create policy tournament_team_statistics_select_scope
on public.tournament_team_statistics for select to authenticated
using (exists (
  select 1 from public.tournament_standings_revisions revision
  where revision.id = revision_id and revision.organization_id = organization_id
    and (
      revision.status = 'published'
      or public.has_tournament_organization_capability(organization_id, 'statistics.rebuild')
    )
    and public.can_read_tournament_projection_scope(
      revision.organization_id, revision.tournament_id
    )
));
create policy tournament_player_statistics_select_scope
on public.tournament_player_statistics for select to authenticated
using (exists (
  select 1 from public.tournament_standings_revisions revision
  where revision.id = revision_id and revision.organization_id = organization_id
    and (
      revision.status = 'published'
      or public.has_tournament_organization_capability(organization_id, 'statistics.rebuild')
    )
    and public.can_read_tournament_projection_scope(
      revision.organization_id, revision.tournament_id
    )
));
create policy tournament_discipline_ledgers_select_scope
on public.tournament_discipline_ledgers for select to authenticated
using (exists (
  select 1 from public.tournament_standings_revisions revision
  where revision.id = revision_id and revision.organization_id = organization_id
    and revision.status = 'published'
    and public.can_read_tournament_projection_scope(
      revision.organization_id, revision.tournament_id
    )
));
create policy tournament_player_suspensions_select_scope
on public.tournament_player_suspensions for select to authenticated
using (exists (
  select 1 from public.tournament_standings_revisions revision
  where revision.id = revision_id and revision.organization_id = organization_id
    and revision.status = 'published'
    and public.can_read_tournament_projection_scope(
      revision.organization_id, revision.tournament_id
    )
));
create policy tournament_suspension_served_matches_select_scope
on public.tournament_suspension_served_matches for select to authenticated
using (exists (
  select 1 from public.tournament_player_suspensions suspension
  where suspension.id = suspension_id and suspension.organization_id = organization_id
    and public.can_read_tournament_projection_scope(
      suspension.organization_id, suspension.tournament_id
    )
));
create policy tournament_disciplinary_overrides_select_manage
on public.tournament_disciplinary_overrides for select to authenticated
using (public.has_tournament_organization_capability(organization_id, 'discipline.manage'));
create policy tournament_points_adjustments_select_manage
on public.tournament_points_adjustments for select to authenticated
using (public.has_tournament_organization_capability(organization_id, 'standings.override'));
create policy tournament_qualification_slots_select_scope
on public.tournament_qualification_slots for select to authenticated
using (public.can_read_tournament_projection_scope(organization_id, tournament_id));
create policy tournament_qualification_resolutions_select_scope
on public.tournament_qualification_resolutions for select to authenticated
using (
  (
    status <> 'blocked'
    and public.can_read_tournament_projection_scope(organization_id, tournament_id)
  )
  or public.has_tournament_organization_capability(organization_id, 'qualification.resolve')
);

revoke all on table public.tournament_standings_revisions from anon, authenticated;
revoke all on table public.tournament_projection_sources from anon, authenticated;
revoke all on table public.tournament_team_standings from anon, authenticated;
revoke all on table public.tournament_team_statistics from anon, authenticated;
revoke all on table public.tournament_player_statistics from anon, authenticated;
revoke all on table public.tournament_discipline_ledgers from anon, authenticated;
revoke all on table public.tournament_player_suspensions from anon, authenticated;
revoke all on table public.tournament_suspension_served_matches from anon, authenticated;
revoke all on table public.tournament_disciplinary_overrides from anon, authenticated;
revoke all on table public.tournament_points_adjustments from anon, authenticated;
revoke all on table public.tournament_qualification_slots from anon, authenticated;
revoke all on table public.tournament_qualification_resolutions from anon, authenticated;

grant select on table public.tournament_standings_revisions to authenticated;
grant select on table public.tournament_projection_sources to authenticated;
grant select on table public.tournament_team_standings to authenticated;
grant select on table public.tournament_team_statistics to authenticated;
grant select on table public.tournament_player_statistics to authenticated;
grant select on table public.tournament_discipline_ledgers to authenticated;
grant select on table public.tournament_player_suspensions to authenticated;
grant select on table public.tournament_suspension_served_matches to authenticated;
grant select on table public.tournament_disciplinary_overrides to authenticated;
grant select on table public.tournament_points_adjustments to authenticated;
grant select on table public.tournament_qualification_slots to authenticated;
grant select on table public.tournament_qualification_resolutions to authenticated;

revoke all on function public.can_read_tournament_projection_scope(uuid, uuid) from public, anon;
revoke all on function public.tournament_projection_source_fingerprint(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rank_tournament_standings(uuid) from public, anon, authenticated;
revoke all on function public.rebuild_tournament_standings(uuid, uuid, uuid, uuid, uuid, text, uuid) from public, anon;
revoke all on function public.rebuild_tournament_discipline(uuid, uuid, uuid, uuid, uuid, text, uuid) from public, anon;
revoke all on function public.publish_tournament_standings_revision(uuid, text) from public, anon;
revoke all on function public.resolve_tournament_qualification(uuid, text) from public, anon;
revoke all on function public.create_tournament_disciplinary_override(uuid, text, integer, text, uuid) from public, anon;
revoke all on function public.mark_tournament_suspension_served(uuid, uuid, text) from public, anon;
revoke all on function public.get_tournament_standings_context(uuid, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.get_tournament_statistics_context(uuid, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.get_player_tournament_statistics(uuid) from public, anon;
revoke all on function public.get_player_tournament_suspensions(uuid) from public, anon;
revoke all on function public.create_tournament_points_adjustment(
  uuid, uuid, uuid, uuid, uuid, integer, text, uuid
) from public, anon;
revoke all on function public.revoke_tournament_points_adjustment(uuid, text)
  from public, anon;
revoke all on function public.reject_tournament_projection_mutation() from public, anon, authenticated;
revoke all on function public.reject_suspended_tournament_squad_player() from public, anon, authenticated;

grant execute on function public.can_read_tournament_projection_scope(uuid, uuid) to authenticated;
grant execute on function public.rebuild_tournament_standings(uuid, uuid, uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.rebuild_tournament_discipline(uuid, uuid, uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.publish_tournament_standings_revision(uuid, text) to authenticated;
grant execute on function public.resolve_tournament_qualification(uuid, text) to authenticated;
grant execute on function public.create_tournament_disciplinary_override(uuid, text, integer, text, uuid) to authenticated;
grant execute on function public.mark_tournament_suspension_served(uuid, uuid, text) to authenticated;
grant execute on function public.get_tournament_standings_context(uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.get_tournament_statistics_context(uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.get_player_tournament_statistics(uuid) to authenticated;
grant execute on function public.get_player_tournament_suspensions(uuid) to authenticated;
grant execute on function public.create_tournament_points_adjustment(
  uuid, uuid, uuid, uuid, uuid, integer, text, uuid
) to authenticated;
grant execute on function public.revoke_tournament_points_adjustment(uuid, text)
  to authenticated;

comment on table public.tournament_standings_revisions is
  'Atomic, rebuildable and versioned projection from published fixture and official reports.';
comment on table public.tournament_team_standings is
  'Immutable table rows belonging to one standings revision.';
comment on table public.tournament_player_suspensions is
  'Explainable automatic or manual suspensions; only published revisions are enforceable.';
