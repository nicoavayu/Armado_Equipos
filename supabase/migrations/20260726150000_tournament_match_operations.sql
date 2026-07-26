-- Arma2 Torneos: match availability, squads, official reports and corrections.
-- Local/dedicated staging only. Never apply this migration to the Arma2 production project.

create extension if not exists pgcrypto;

alter table public.tournament_matches
  add constraint tournament_matches_org_id_unique unique (organization_id, id);

alter table public.tournament_roster_players
  add constraint tournament_roster_players_org_id_unique
  unique (organization_id, id);

alter table public.tournament_roster_players
  add constraint tournament_roster_players_org_entry_id_unique
  unique (organization_id, team_entry_id, id);

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
      'match_administrative_results.manage'
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
      'match_administrative_results.manage'
    ]::text[]
    when 'collaborator' then array[
      'organization.read', 'members.read', 'workspace.access',
      'seasons.read', 'tournaments.read', 'categories.read',
      'competition_rules.read', 'team_entries.read', 'team_managers.read',
      'rosters.read', 'roster_players.read',
      'participants.read', 'draw.read', 'fixture.read', 'groups.read',
      'rounds.read', 'matches.read', 'venues.read', 'courts.read',
      'schedule_windows.read', 'match_operations.read', 'match_squads.read',
      'match_availability.read', 'match_events.read'
    ]::text[]
    else array[]::text[]
  end;
$$;

create table public.tournament_match_squads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  match_id uuid not null,
  team_entry_id uuid not null,
  roster_id uuid not null,
  status text not null default 'draft',
  submitted_by uuid references auth.users(id) on delete restrict,
  submitted_at timestamptz,
  locked_by uuid references auth.users(id) on delete restrict,
  locked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_match_squads_match_fk
    foreign key (organization_id, match_id)
    references public.tournament_matches(organization_id, id) on delete restrict,
  constraint tournament_match_squads_entry_fk
    foreign key (organization_id, team_entry_id)
    references public.tournament_team_entries(organization_id, id) on delete restrict,
  constraint tournament_match_squads_roster_fk
    foreign key (organization_id, team_entry_id, roster_id)
    references public.tournament_rosters(organization_id, team_entry_id, id) on delete restrict,
  constraint tournament_match_squads_status_check
    check (status in ('draft', 'submitted', 'locked', 'superseded')),
  constraint tournament_match_squads_lifecycle_check check (
    (status = 'draft' and submitted_at is null and locked_at is null)
    or (status = 'submitted' and submitted_by is not null and submitted_at is not null and locked_at is null)
    or (status in ('locked', 'superseded') and submitted_by is not null
      and submitted_at is not null and locked_by is not null and locked_at is not null)
  ),
  constraint tournament_match_squads_org_match_team_unique
    unique (organization_id, match_id, team_entry_id, id)
);

create unique index tournament_match_squads_active_unique
  on public.tournament_match_squads(match_id, team_entry_id)
  where status <> 'superseded';
create index tournament_match_squads_match_status_idx
  on public.tournament_match_squads(match_id, status, team_entry_id);

create table public.tournament_match_squad_players (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  match_squad_id uuid not null,
  match_id uuid not null,
  roster_player_id uuid not null,
  team_entry_id uuid not null,
  availability_status text not null default 'pending',
  callup_status text not null default 'not_called_up',
  lineup_status text not null default 'not_in_match_squad',
  shirt_number_snapshot smallint,
  position_snapshot text,
  display_name_snapshot text not null,
  avatar_url_snapshot text,
  is_goalkeeper boolean not null default false,
  is_captain boolean not null default false,
  attendance_status text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_match_squad_players_squad_fk
    foreign key (organization_id, match_id, team_entry_id, match_squad_id)
    references public.tournament_match_squads
      (organization_id, match_id, team_entry_id, id) on delete restrict,
  constraint tournament_match_squad_players_roster_player_fk
    foreign key (organization_id, team_entry_id, roster_player_id)
    references public.tournament_roster_players
      (organization_id, team_entry_id, id) on delete restrict,
  constraint tournament_match_squad_players_availability_check check (
    availability_status in ('pending', 'available', 'unavailable', 'maybe', 'no_response')
  ),
  constraint tournament_match_squad_players_callup_check
    check (callup_status in ('called_up', 'not_called_up', 'removed')),
  constraint tournament_match_squad_players_lineup_check
    check (lineup_status in ('starter', 'substitute', 'not_in_match_squad')),
  constraint tournament_match_squad_players_attendance_check
    check (attendance_status in ('unknown', 'present', 'absent', 'late', 'excused')),
  constraint tournament_match_squad_players_number_check
    check (shirt_number_snapshot is null or shirt_number_snapshot between 0 and 99),
  constraint tournament_match_squad_players_position_check
    check (position_snapshot is null or position_snapshot in ('ARQ', 'DEF', 'MED', 'DEL')),
  constraint tournament_match_squad_players_name_check
    check (display_name_snapshot = btrim(display_name_snapshot)
      and char_length(display_name_snapshot) between 2 and 100),
  constraint tournament_match_squad_players_shape_check check (
    (callup_status = 'called_up' and lineup_status in ('starter', 'substitute'))
    or (callup_status <> 'called_up' and lineup_status = 'not_in_match_squad')
  ),
  constraint tournament_match_squad_players_unique unique (match_squad_id, roster_player_id)
);

create unique index tournament_match_squad_players_one_captain_idx
  on public.tournament_match_squad_players(match_squad_id)
  where is_captain and callup_status = 'called_up';
create index tournament_match_squad_players_lineup_idx
  on public.tournament_match_squad_players(match_squad_id, lineup_status, display_name_snapshot);

create table public.tournament_match_availability_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  match_id uuid not null,
  team_entry_id uuid not null,
  roster_player_id uuid not null,
  user_id uuid references auth.users(id) on delete restrict,
  response text not null,
  comment text,
  response_source text not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  manual_reason text,
  responded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_match_availability_match_fk
    foreign key (organization_id, match_id)
    references public.tournament_matches(organization_id, id) on delete restrict,
  constraint tournament_match_availability_entry_fk
    foreign key (organization_id, team_entry_id)
    references public.tournament_team_entries(organization_id, id) on delete restrict,
  constraint tournament_match_availability_player_fk
    foreign key (organization_id, team_entry_id, roster_player_id)
    references public.tournament_roster_players
      (organization_id, team_entry_id, id) on delete restrict,
  constraint tournament_match_availability_response_check
    check (response in ('available', 'unavailable', 'maybe')),
  constraint tournament_match_availability_source_check
    check (response_source in ('self', 'manual')),
  constraint tournament_match_availability_comment_check
    check (comment is null or char_length(comment) <= 500),
  constraint tournament_match_availability_manual_check check (
    (response_source = 'self' and user_id is not null and recorded_by = user_id
      and manual_reason is null)
    or (response_source = 'manual' and char_length(btrim(manual_reason)) between 3 and 500)
  ),
  constraint tournament_match_availability_unique unique (match_id, roster_player_id)
);

create index tournament_match_availability_team_idx
  on public.tournament_match_availability_responses(match_id, team_entry_id, response);

create table public.tournament_match_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  fixture_version_id uuid not null,
  phase_id uuid not null,
  round_id uuid not null,
  match_id uuid not null,
  home_team_entry_id uuid not null,
  away_team_entry_id uuid not null,
  status text not null default 'draft',
  match_status text not null default 'ready',
  operation_version integer not null,
  source_operation_id uuid,
  match_snapshot jsonb not null,
  home_team_snapshot jsonb not null,
  away_team_snapshot jsonb not null,
  notes text,
  opened_by uuid not null references auth.users(id) on delete restrict,
  opened_at timestamptz not null default now(),
  submitted_by uuid references auth.users(id) on delete restrict,
  submitted_at timestamptz,
  validated_by uuid references auth.users(id) on delete restrict,
  validated_at timestamptz,
  official_by uuid references auth.users(id) on delete restrict,
  official_at timestamptz,
  closed_at timestamptz,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_match_operations_match_fk
    foreign key (organization_id, tournament_id, category_id, fixture_version_id, match_id)
    references public.tournament_matches
      (organization_id, tournament_id, category_id, fixture_version_id, id) on delete restrict,
  constraint tournament_match_operations_home_entry_fk
    foreign key (organization_id, tournament_id, home_team_entry_id)
    references public.tournament_team_entries(organization_id, tournament_id, id) on delete restrict,
  constraint tournament_match_operations_away_entry_fk
    foreign key (organization_id, tournament_id, away_team_entry_id)
    references public.tournament_team_entries(organization_id, tournament_id, id) on delete restrict,
  constraint tournament_match_operations_source_fk
    foreign key (source_operation_id)
    references public.tournament_match_operations(id) on delete restrict,
  constraint tournament_match_operations_status_check check (status in (
    'draft', 'submitted', 'under_review', 'validated', 'official',
    'correction_requested', 'superseded', 'voided'
  )),
  constraint tournament_match_operations_match_status_check check (match_status in (
    'ready', 'in_progress', 'suspended', 'abandoned', 'played',
    'awaiting_validation', 'official', 'administrative', 'voided'
  )),
  constraint tournament_match_operations_version_check check (operation_version > 0),
  constraint tournament_match_operations_teams_check
    check (home_team_entry_id <> away_team_entry_id),
  constraint tournament_match_operations_snapshot_check check (
    jsonb_typeof(match_snapshot) = 'object'
    and jsonb_typeof(home_team_snapshot) = 'object'
    and jsonb_typeof(away_team_snapshot) = 'object'
    and pg_column_size(match_snapshot) <= 16384
    and pg_column_size(home_team_snapshot) <= 8192
    and pg_column_size(away_team_snapshot) <= 8192
  ),
  constraint tournament_match_operations_notes_check
    check (notes is null or char_length(notes) <= 4000),
  constraint tournament_match_operations_lifecycle_check check (
    (status = 'draft' and submitted_at is null and validated_at is null and official_at is null)
    or (status in ('submitted', 'under_review')
      and submitted_by is not null and submitted_at is not null and official_at is null)
    or (status = 'validated' and submitted_by is not null and submitted_at is not null
      and validated_by is not null and validated_at is not null and official_at is null)
    or (status in ('official', 'correction_requested', 'superseded') and submitted_by is not null
      and submitted_at is not null and validated_by is not null and validated_at is not null
      and official_by is not null and official_at is not null and closed_at is not null)
    or status = 'voided'
  ),
  constraint tournament_match_operations_match_version_unique unique (match_id, operation_version),
  constraint tournament_match_operations_org_match_id_unique
    unique (organization_id, match_id, id),
  constraint tournament_match_operations_org_id_unique
    unique (organization_id, id)
);

create unique index tournament_match_operations_active_unique
  on public.tournament_match_operations(match_id)
  where status in ('draft', 'submitted', 'under_review', 'validated');
create unique index tournament_match_operations_official_unique
  on public.tournament_match_operations(match_id)
  where status = 'official';
create index tournament_match_operations_scope_idx
  on public.tournament_match_operations
  (organization_id, tournament_id, category_id, match_status, updated_at desc);

create table public.tournament_match_operation_players (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  match_operation_id uuid not null,
  match_id uuid not null,
  team_entry_id uuid not null,
  roster_player_id uuid not null,
  display_name_snapshot text not null,
  avatar_url_snapshot text,
  shirt_number_snapshot smallint,
  position_snapshot text,
  is_goalkeeper boolean not null default false,
  is_captain boolean not null default false,
  lineup_status text not null,
  attendance_status text not null,
  created_at timestamptz not null default now(),
  constraint tournament_match_operation_players_operation_fk
    foreign key (organization_id, match_id, match_operation_id)
    references public.tournament_match_operations(organization_id, match_id, id) on delete restrict,
  constraint tournament_match_operation_players_entry_fk
    foreign key (organization_id, team_entry_id)
    references public.tournament_team_entries(organization_id, id) on delete restrict,
  constraint tournament_match_operation_players_roster_player_fk
    foreign key (organization_id, team_entry_id, roster_player_id)
    references public.tournament_roster_players
      (organization_id, team_entry_id, id) on delete restrict,
  constraint tournament_match_operation_players_lineup_check
    check (lineup_status in ('starter', 'substitute', 'not_in_match_squad')),
  constraint tournament_match_operation_players_attendance_check
    check (attendance_status in ('unknown', 'present', 'absent', 'late', 'excused')),
  constraint tournament_match_operation_players_name_check
    check (display_name_snapshot = btrim(display_name_snapshot)
      and char_length(display_name_snapshot) between 2 and 100),
  constraint tournament_match_operation_players_unique
    unique (match_operation_id, roster_player_id)
);

create index tournament_match_operation_players_team_idx
  on public.tournament_match_operation_players(match_operation_id, team_entry_id, lineup_status);

create table public.tournament_match_outcomes (
  match_operation_id uuid primary key,
  organization_id uuid not null,
  match_id uuid not null,
  outcome_type text not null,
  started_at timestamptz,
  ended_at timestamptz,
  suspension_minute smallint,
  suspension_period text,
  events_remain_valid boolean not null default true,
  reason_code text,
  reason_text text,
  administrative_home_score smallint,
  administrative_away_score smallint,
  counts_for_standings boolean not null default false,
  counts_for_player_stats boolean not null default false,
  requires_resolution boolean not null default false,
  resolved_by uuid references auth.users(id) on delete restrict,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint tournament_match_outcomes_operation_fk
    foreign key (organization_id, match_id, match_operation_id)
    references public.tournament_match_operations(organization_id, match_id, id) on delete restrict,
  constraint tournament_match_outcomes_type_check check (outcome_type in (
    'played', 'postponed_before_start', 'suspended', 'abandoned',
    'home_no_show', 'away_no_show', 'double_no_show',
    'walkover_home', 'walkover_away', 'administrative_result',
    'cancelled', 'not_played', 'resumed_future'
  )),
  constraint tournament_match_outcomes_period_check
    check (suspension_period is null or suspension_period in ('first_half', 'halftime', 'second_half', 'extra_time', 'penalties', 'unknown')),
  constraint tournament_match_outcomes_minute_check
    check (suspension_minute is null or suspension_minute between 0 and 240),
  constraint tournament_match_outcomes_reason_check
    check (reason_text is null or char_length(reason_text) <= 2000),
  constraint tournament_match_outcomes_admin_score_check check (
    (administrative_home_score is null and administrative_away_score is null)
    or (administrative_home_score between 0 and 99 and administrative_away_score between 0 and 99)
  ),
  constraint tournament_match_outcomes_resolution_check check (
    (resolved_at is null and resolved_by is null)
    or (resolved_at is not null and resolved_by is not null)
  ),
  constraint tournament_match_outcomes_suspension_check check (
    outcome_type <> 'suspended'
    or (suspension_minute is not null and suspension_period is not null and reason_text is not null)
  )
);

create table public.tournament_match_scores (
  match_operation_id uuid primary key,
  organization_id uuid not null,
  match_id uuid not null,
  home_score smallint not null,
  away_score smallint not null,
  home_score_first_half smallint,
  away_score_first_half smallint,
  home_penalties smallint,
  away_penalties smallint,
  score_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_match_scores_operation_fk
    foreign key (organization_id, match_id, match_operation_id)
    references public.tournament_match_operations(organization_id, match_id, id) on delete restrict,
  constraint tournament_match_scores_values_check check (
    home_score between 0 and 99 and away_score between 0 and 99
    and (home_score_first_half is null or home_score_first_half between 0 and home_score)
    and (away_score_first_half is null or away_score_first_half between 0 and away_score)
    and (home_penalties is null or home_penalties between 0 and 99)
    and (away_penalties is null or away_penalties between 0 and 99)
  ),
  constraint tournament_match_scores_type_check
    check (score_type in ('played', 'administrative', 'walkover', 'series_leg', 'penalty_shootout_future')),
  constraint tournament_match_scores_penalties_check
    check ((home_penalties is null) = (away_penalties is null))
);

create table public.tournament_match_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  match_operation_id uuid not null,
  match_id uuid not null,
  team_entry_id uuid not null,
  roster_player_id uuid,
  related_roster_player_id uuid,
  related_event_id uuid,
  event_type text not null,
  minute smallint,
  period text not null default 'unknown',
  sequence_number integer not null,
  unidentified_player_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete restrict,
  void_reason text,
  constraint tournament_match_events_operation_fk
    foreign key (organization_id, match_id, match_operation_id)
    references public.tournament_match_operations(organization_id, match_id, id) on delete restrict,
  constraint tournament_match_events_entry_fk
    foreign key (organization_id, team_entry_id)
    references public.tournament_team_entries(organization_id, id) on delete restrict,
  constraint tournament_match_events_player_fk
    foreign key (organization_id, roster_player_id)
    references public.tournament_roster_players(organization_id, id) on delete restrict,
  constraint tournament_match_events_related_player_fk
    foreign key (organization_id, related_roster_player_id)
    references public.tournament_roster_players(organization_id, id) on delete restrict,
  constraint tournament_match_events_related_event_fk
    foreign key (related_event_id)
    references public.tournament_match_events(id) on delete restrict,
  constraint tournament_match_events_type_check check (event_type in (
    'goal', 'own_goal', 'assist', 'yellow_card', 'second_yellow', 'red_card',
    'substitution_in', 'substitution_out', 'penalty_goal', 'penalty_missed',
    'match_started', 'halftime', 'second_half_started', 'match_ended',
    'suspension', 'resumption_future', 'incident', 'no_show'
  )),
  constraint tournament_match_events_period_check
    check (period in ('pre_match', 'first_half', 'halftime', 'second_half', 'extra_time', 'penalties', 'post_match', 'unknown')),
  constraint tournament_match_events_minute_check
    check (minute is null or minute between 0 and 240),
  constraint tournament_match_events_sequence_check check (sequence_number > 0),
  constraint tournament_match_events_metadata_check
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  constraint tournament_match_events_void_check check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null
      and char_length(btrim(void_reason)) between 3 and 500)
  ),
  constraint tournament_match_events_player_shape_check check (
    roster_player_id is not null
    or event_type in (
      'match_started', 'halftime', 'second_half_started', 'match_ended',
      'suspension', 'resumption_future', 'incident', 'no_show'
    )
    or (
      event_type in ('goal', 'own_goal', 'penalty_goal')
      and char_length(btrim(unidentified_player_reason)) between 3 and 500
    )
  ),
  constraint tournament_match_events_sequence_unique
    unique (match_operation_id, sequence_number)
);

create index tournament_match_events_timeline_idx
  on public.tournament_match_events(match_operation_id, sequence_number)
  where voided_at is null;
create unique index tournament_match_events_one_assist_per_goal_idx
  on public.tournament_match_events(match_operation_id, related_event_id)
  where event_type = 'assist' and voided_at is null;
create unique index tournament_match_events_one_substitution_in_per_out_idx
  on public.tournament_match_events(match_operation_id, related_event_id)
  where event_type = 'substitution_in' and voided_at is null;

create table public.tournament_match_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  match_operation_id uuid not null,
  review_type text not null,
  status text not null default 'open',
  reason text not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete restrict,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  constraint tournament_match_reviews_operation_fk
    foreign key (organization_id, match_operation_id)
    references public.tournament_match_operations(organization_id, id) on delete restrict,
  constraint tournament_match_reviews_type_check
    check (review_type in ('validation', 'correction', 'dispute_future', 'administrative_resolution')),
  constraint tournament_match_reviews_status_check
    check (status in ('open', 'approved', 'rejected', 'superseded')),
  constraint tournament_match_reviews_reason_check
    check (reason = btrim(reason) and char_length(reason) between 3 and 2000),
  constraint tournament_match_reviews_resolution_check check (
    (status = 'open' and resolved_by is null and resolved_at is null and resolution is null)
    or (status <> 'open' and resolved_by is not null and resolved_at is not null
      and char_length(btrim(resolution)) between 3 and 2000)
  )
);

create unique index tournament_match_reviews_open_unique
  on public.tournament_match_reviews(match_operation_id, review_type)
  where status = 'open';
create index tournament_match_reviews_operation_idx
  on public.tournament_match_reviews(match_operation_id, requested_at desc);

create table public.tournament_match_resumptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  match_operation_id uuid not null,
  scheduled_at timestamptz,
  venue_id uuid,
  court_id uuid,
  status text not null default 'pending',
  reason text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint tournament_match_resumptions_operation_fk
    foreign key (organization_id, match_operation_id)
    references public.tournament_match_operations(organization_id, id) on delete restrict,
  constraint tournament_match_resumptions_venue_fk
    foreign key (organization_id, venue_id)
    references public.tournament_venues(organization_id, id) on delete restrict,
  constraint tournament_match_resumptions_court_fk
    foreign key (organization_id, court_id)
    references public.tournament_courts(organization_id, id) on delete restrict,
  constraint tournament_match_resumptions_status_check
    check (status in ('pending', 'scheduled', 'completed', 'cancelled')),
  constraint tournament_match_resumptions_reason_check
    check (reason = btrim(reason) and char_length(reason) between 3 and 1000),
  constraint tournament_match_resumptions_schedule_check check (
    (scheduled_at is null and venue_id is null and court_id is null and status = 'pending')
    or (scheduled_at is not null and venue_id is not null and court_id is not null
      and status in ('scheduled', 'completed', 'cancelled'))
  )
);

create unique index tournament_match_resumptions_open_unique
  on public.tournament_match_resumptions(match_operation_id)
  where status in ('pending', 'scheduled');

create or replace function public.raise_tournament_match_error(p_message text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = p_message;
end;
$$;

create or replace function public.tournament_match_team_entries(p_match_id uuid)
returns table(home_team_entry_id uuid, away_team_entry_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select home_participant.team_entry_id, away_participant.team_entry_id
  from public.tournament_matches match_row
  join public.tournament_fixture_versions fixture
    on fixture.id = match_row.fixture_version_id
  join public.tournament_competition_participants home_participant
    on home_participant.id = match_row.home_participant_id
    and home_participant.participant_set_id = match_row.participant_set_id
  join public.tournament_competition_participants away_participant
    on away_participant.id = match_row.away_participant_id
    and away_participant.participant_set_id = match_row.participant_set_id
  where match_row.id = p_match_id
    and fixture.status = 'published'
    and fixture.invalidated_at is null
    and home_participant.status = 'active'
    and away_participant.status = 'active';
$$;

create or replace function public.can_read_tournament_match_operation(
  p_organization_id uuid,
  p_match_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and public.has_tournament_organization_capability(
      p_organization_id, 'match_operations.read'
    )
    and exists (
    select 1
    from public.tournament_matches match_row
    where match_row.id = p_match_id
      and match_row.organization_id = p_organization_id
    );
$$;

create or replace function public.can_manage_tournament_match_squad(
  p_organization_id uuid,
  p_match_id uuid,
  p_team_entry_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.tournament_matches match_row
      cross join lateral public.tournament_match_team_entries(match_row.id) teams
      where match_row.id = p_match_id
        and match_row.organization_id = p_organization_id
        and p_team_entry_id in (teams.home_team_entry_id, teams.away_team_entry_id)
    )
    and (
      public.has_tournament_organization_capability(
        p_organization_id, 'match_squads.manage'
      )
      or public.is_tournament_team_manager(p_team_entry_id, false)
    );
$$;

create or replace function public.validate_tournament_match_player_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_player public.tournament_roster_players%rowtype;
  v_roster public.tournament_rosters%rowtype;
  v_squad public.tournament_match_squads%rowtype;
  v_teams record;
begin
  select * into v_player
  from public.tournament_roster_players
  where id = new.roster_player_id;
  if v_player.id is not null then
    select * into v_roster
    from public.tournament_rosters
    where id = v_player.roster_id;
  end if;
  select * into v_teams
  from public.tournament_match_team_entries(new.match_id);
  if v_player.id is null
    or v_player.organization_id <> new.organization_id
    or v_player.team_entry_id <> new.team_entry_id
    or v_player.status <> 'active'
    or v_player.eligibility_status <> 'eligible'
    or v_roster.id is null
    or v_roster.status not in ('approved', 'locked')
    or new.team_entry_id not in (
      v_teams.home_team_entry_id, v_teams.away_team_entry_id
    )
  then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_PLAYER_OUT_OF_SCOPE';
  end if;
  if tg_table_name = 'tournament_match_squad_players' then
    select * into v_squad
    from public.tournament_match_squads where id = new.match_squad_id;
    if v_squad.id is null or v_player.roster_id <> v_squad.roster_id then
      raise exception using errcode = '23514', message = 'TORNEOS_MATCH_PLAYER_OUT_OF_SCOPE';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_tournament_match_squad_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_roster public.tournament_rosters%rowtype;
  v_match public.tournament_matches%rowtype;
  v_teams record;
begin
  select * into v_match
  from public.tournament_matches
  where id = new.match_id and organization_id = new.organization_id;
  select * into v_roster
  from public.tournament_rosters
  where id = new.roster_id
    and organization_id = new.organization_id
    and team_entry_id = new.team_entry_id;
  select * into v_teams
  from public.tournament_match_team_entries(new.match_id);
  if v_match.id is null
    or v_roster.id is null
    or v_roster.status not in ('approved', 'locked')
    or new.team_entry_id not in (
      v_teams.home_team_entry_id, v_teams.away_team_entry_id
    )
  then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_SQUAD_SCOPE';
  end if;
  return new;
end;
$$;

create trigger tournament_match_squads_scope_guard
before insert or update on public.tournament_match_squads
for each row execute function public.validate_tournament_match_squad_scope();

create trigger tournament_match_squad_players_scope_guard
before insert or update on public.tournament_match_squad_players
for each row execute function public.validate_tournament_match_player_scope();

create trigger tournament_match_availability_scope_guard
before insert or update on public.tournament_match_availability_responses
for each row execute function public.validate_tournament_match_player_scope();

create or replace function public.protect_tournament_match_squad_players()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_squad_status text;
begin
  select status into v_squad_status
  from public.tournament_match_squads
  where id = coalesce(new.match_squad_id, old.match_squad_id);
  if v_squad_status is distinct from 'draft' then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_SQUAD_LOCKED';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger tournament_match_squad_players_history_guard
before insert or update or delete on public.tournament_match_squad_players
for each row execute function public.protect_tournament_match_squad_players();

create or replace function public.protect_tournament_match_operation_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_HISTORY_APPEND_ONLY';
  end if;
  if old.status in ('official', 'superseded', 'voided') and not (
    old.status = 'official'
    and new.status = 'superseded'
    and row(
      new.id, new.organization_id, new.match_id, new.operation_version,
      new.match_snapshot, new.home_team_snapshot, new.away_team_snapshot,
      new.opened_by, new.opened_at, new.submitted_by, new.submitted_at,
      new.validated_by, new.validated_at, new.official_by, new.official_at,
      new.closed_at
    ) is not distinct from row(
      old.id, old.organization_id, old.match_id, old.operation_version,
      old.match_snapshot, old.home_team_snapshot, old.away_team_snapshot,
      old.opened_by, old.opened_at, old.submitted_by, old.submitted_at,
      old.validated_by, old.validated_at, old.official_by, old.official_at,
      old.closed_at
    )
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_OFFICIAL_OPERATION_IMMUTABLE';
  end if;
  return new;
end;
$$;

create or replace function public.validate_tournament_match_operation_source()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_source public.tournament_match_operations%rowtype;
begin
  if new.source_operation_id is null then
    return new;
  end if;
  select * into v_source
  from public.tournament_match_operations
  where id = new.source_operation_id;
  if v_source.id is null
    or v_source.organization_id <> new.organization_id
    or v_source.match_id <> new.match_id
    or new.operation_version <> (
      select coalesce(max(operation.operation_version), 0) + 1
      from public.tournament_match_operations operation
      where operation.match_id = new.match_id
        and operation.id <> new.id
    )
  then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_CORRECTION_SCOPE';
  end if;
  return new;
end;
$$;

create trigger tournament_match_operations_source_guard
before insert or update on public.tournament_match_operations
for each row execute function public.validate_tournament_match_operation_source();

create trigger tournament_match_operations_history_guard
before update or delete on public.tournament_match_operations
for each row execute function public.protect_tournament_match_operation_history();

create or replace function public.reject_tournament_match_child_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'TORNEOS_MATCH_HISTORY_APPEND_ONLY';
end;
$$;

create trigger tournament_match_events_no_delete
before delete on public.tournament_match_events
for each row execute function public.reject_tournament_match_child_delete();
create trigger tournament_match_reviews_no_delete
before delete on public.tournament_match_reviews
for each row execute function public.reject_tournament_match_child_delete();

create or replace function public.protect_tournament_match_child_history()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_operation_id uuid;
  v_operation_status text;
begin
  if tg_op = 'DELETE' then
    v_operation_id := old.match_operation_id;
  else
    v_operation_id := new.match_operation_id;
  end if;
  select status into v_operation_status
  from public.tournament_match_operations
  where id = v_operation_id;
  if v_operation_status is distinct from 'draft' then
    raise exception using errcode = '42501',
      message = 'TORNEOS_OFFICIAL_OPERATION_IMMUTABLE';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger tournament_match_operation_players_history_guard
before insert or update or delete on public.tournament_match_operation_players
for each row execute function public.protect_tournament_match_child_history();
create trigger tournament_match_outcomes_history_guard
before insert or update or delete on public.tournament_match_outcomes
for each row execute function public.protect_tournament_match_child_history();
create trigger tournament_match_scores_history_guard
before insert or update or delete on public.tournament_match_scores
for each row execute function public.protect_tournament_match_child_history();
create trigger tournament_match_events_history_guard
before insert or update or delete on public.tournament_match_events
for each row execute function public.protect_tournament_match_child_history();
create trigger tournament_match_resumptions_history_guard
before insert or update or delete on public.tournament_match_resumptions
for each row execute function public.protect_tournament_match_child_history();

create or replace function public.protect_tournament_match_planning_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('postponed', 'cancelled', 'unscheduled')
    and new.status is distinct from old.status
    and exists (
      select 1
      from public.tournament_match_operations operation
      where operation.match_id = old.id
        and operation.status not in ('superseded', 'voided')
    )
  then
    raise exception using errcode = '55000',
      message = 'TORNEOS_MATCH_OPERATION_ACTIVE';
  end if;
  return new;
end;
$$;

create trigger tournament_matches_operation_transition_guard
before update on public.tournament_matches
for each row execute function public.protect_tournament_match_planning_transition();

create or replace function public.get_player_tournament_matches()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
  where auth.uid() is not null
    and player.arma2_user_id = auth.uid()
    and player.status = 'active'
    and player.eligibility_status = 'eligible'
    and match_row.status in ('scheduled', 'ready', 'postponed', 'cancelled');
$$;

create or replace function public.get_managed_tournament_matches()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
  where auth.uid() is not null
    and manager.user_id = auth.uid()
    and manager.status = 'active'
    and manager.role in ('captain', 'delegate')
    and match_row.status in ('scheduled', 'ready', 'postponed', 'cancelled');
$$;

create or replace function public.respond_match_availability(
  p_match_id uuid,
  p_response text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.tournament_roster_players%rowtype;
  v_match public.tournament_matches%rowtype;
  v_response public.tournament_match_availability_responses%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_response not in ('available', 'unavailable', 'maybe') then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_AVAILABILITY';
  end if;
  select * into v_match from public.tournament_matches where id = p_match_id for share;
  select player.* into v_player
  from public.tournament_roster_players player
  join public.tournament_rosters roster
    on roster.id = player.roster_id and roster.status in ('approved', 'locked')
  cross join lateral public.tournament_match_team_entries(p_match_id) teams
  where player.arma2_user_id = auth.uid()
    and player.team_entry_id in (teams.home_team_entry_id, teams.away_team_entry_id)
    and player.status = 'active' and player.eligibility_status = 'eligible'
  limit 1;
  if v_match.id is null or v_match.status not in ('scheduled', 'ready')
    or v_match.scheduled_at is null or now() >= v_match.scheduled_at
    or v_player.id is null
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.tournament_match_operations operation
    where operation.match_id = p_match_id
      and operation.status not in ('superseded', 'voided')
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_MATCH_OPERATION_ACTIVE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:match-availability:' || p_match_id || ':' || v_player.id, 0
  ));
  insert into public.tournament_match_availability_responses (
    organization_id, match_id, team_entry_id, roster_player_id, user_id,
    response, comment, response_source, recorded_by
  ) values (
    v_match.organization_id, p_match_id, v_player.team_entry_id, v_player.id,
    auth.uid(), p_response, nullif(btrim(p_comment), ''), 'self', auth.uid()
  )
  on conflict (match_id, roster_player_id) do update set
    response = excluded.response,
    comment = excluded.comment,
    user_id = excluded.user_id,
    response_source = 'self',
    recorded_by = excluded.recorded_by,
    manual_reason = null,
    responded_at = now(),
    updated_at = now()
  returning * into v_response;
  perform public.append_tournament_audit(
    v_match.organization_id, 'match_availability.responded',
    'match_availability', v_response.id, v_player.team_entry_id,
    v_match.tournament_id, jsonb_build_object('response', p_response, 'source', 'self')
  );
  return jsonb_build_object(
    'id', v_response.id, 'matchId', p_match_id,
    'rosterPlayerId', v_player.id, 'response', v_response.response
  );
end;
$$;

create or replace function public.record_manual_match_availability(
  p_organization_id uuid,
  p_match_id uuid,
  p_roster_player_id uuid,
  p_response text,
  p_reason text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_player public.tournament_roster_players%rowtype;
  v_response public.tournament_match_availability_responses%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_response not in ('available', 'unavailable', 'maybe')
    or char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_AVAILABILITY';
  end if;
  select * into v_match from public.tournament_matches
  where id = p_match_id and organization_id = p_organization_id for share;
  select player.* into v_player
  from public.tournament_roster_players player
  join public.tournament_rosters roster
    on roster.id = player.roster_id
    and roster.status in ('approved', 'locked')
  where player.id = p_roster_player_id
    and player.organization_id = p_organization_id
    and player.status = 'active'
    and player.eligibility_status = 'eligible';
  if v_match.id is null or v_match.status not in ('scheduled', 'ready')
    or v_match.scheduled_at is null or now() >= v_match.scheduled_at
    or v_player.id is null
    or not public.can_manage_tournament_match_squad(
      p_organization_id, p_match_id, v_player.team_entry_id
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.tournament_match_operations operation
    where operation.match_id = p_match_id
      and operation.status not in ('superseded', 'voided')
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_MATCH_OPERATION_ACTIVE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:match-availability:' || p_match_id || ':' || v_player.id, 0
  ));
  insert into public.tournament_match_availability_responses (
    organization_id, match_id, team_entry_id, roster_player_id, user_id,
    response, comment, response_source, recorded_by, manual_reason
  ) values (
    p_organization_id, p_match_id, v_player.team_entry_id, v_player.id,
    v_player.arma2_user_id, p_response, nullif(btrim(p_comment), ''),
    'manual', auth.uid(), btrim(p_reason)
  )
  on conflict (match_id, roster_player_id) do update set
    response = excluded.response, comment = excluded.comment,
    user_id = excluded.user_id, response_source = 'manual',
    recorded_by = excluded.recorded_by, manual_reason = excluded.manual_reason,
    responded_at = now(), updated_at = now()
  where public.tournament_match_availability_responses.response_source = 'manual'
  returning * into v_response;
  if v_response.id is null then
    raise exception using errcode = '55000',
      message = 'TORNEOS_MATCH_AVAILABILITY_SELF_AUTHORITATIVE';
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'match_availability.recorded_manual',
    'match_availability', v_response.id, v_player.team_entry_id,
    v_match.tournament_id, jsonb_build_object('response', p_response, 'source', 'manual')
  );
  return jsonb_build_object('id', v_response.id, 'response', v_response.response);
end;
$$;

create or replace function public.get_match_squad_context(
  p_organization_id uuid,
  p_match_id uuid,
  p_team_entry_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (
      public.has_tournament_organization_capability(
        p_organization_id, 'match_squads.read'
      )
      or public.can_manage_tournament_match_squad(
        p_organization_id, p_match_id, p_team_entry_id
      )
    )
      then public.raise_tournament_match_error('TORNEOS_MATCH_FORBIDDEN')
    else jsonb_build_object(
      'matchId', match_row.id,
      'teamEntryId', p_team_entry_id,
      'teamName', entry.name,
      'status', match_row.status,
      'teamSize', coalesce(category.team_size, tournament.team_size),
      'substitutesLimit', coalesce(tournament.substitutes_limit, tournament.team_size),
      'squad', (
        select jsonb_build_object(
          'id', squad.id,
          'status', squad.status,
          'submittedAt', squad.submitted_at,
          'lockedAt', squad.locked_at
        ) from public.tournament_match_squads squad
        where squad.match_id = match_row.id
          and squad.team_entry_id = p_team_entry_id
          and squad.status <> 'superseded'
      ),
      'players', coalesce((
        select jsonb_agg(jsonb_build_object(
          'rosterPlayerId', player.id,
          'displayName', player.display_name,
          'avatarUrl', player.avatar_url,
          'shirtNumber', player.shirt_number,
          'position', player.primary_position,
          'isGoalkeeper', player.is_goalkeeper,
          'eligibilityStatus', player.eligibility_status,
          'availability', availability.response,
          'selection', case when selection.id is null then null else jsonb_build_object(
            'callup_status', selection.callup_status,
            'lineup_status', selection.lineup_status,
            'is_goalkeeper', selection.is_goalkeeper,
            'is_captain', selection.is_captain,
            'attendance_status', selection.attendance_status
          ) end
        ) order by player.display_name)
        from public.tournament_roster_players player
        join public.tournament_rosters roster
          on roster.id = player.roster_id and roster.status in ('approved', 'locked')
        left join public.tournament_match_availability_responses availability
          on availability.match_id = match_row.id and availability.roster_player_id = player.id
        left join public.tournament_match_squads squad
          on squad.match_id = match_row.id and squad.team_entry_id = p_team_entry_id
          and squad.status <> 'superseded'
        left join public.tournament_match_squad_players selection
          on selection.match_squad_id = squad.id and selection.roster_player_id = player.id
        where player.team_entry_id = p_team_entry_id and player.status = 'active'
      ), '[]'::jsonb)
    )
  end
  from public.tournament_matches match_row
  join public.tournament_categories category on category.id = match_row.category_id
  join public.tournaments tournament on tournament.id = match_row.tournament_id
  join public.tournament_team_entries entry on entry.id = p_team_entry_id
  cross join lateral public.tournament_match_team_entries(match_row.id) teams
  where match_row.id = p_match_id and match_row.organization_id = p_organization_id
    and p_team_entry_id in (teams.home_team_entry_id, teams.away_team_entry_id);
$$;

create or replace function public.get_my_managed_match_squad_context(p_match_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_match_squad_context(
    match_row.organization_id,
    match_row.id,
    manager.team_entry_id
  ) || jsonb_build_object(
    'organizationId', match_row.organization_id,
    'tournamentId', match_row.tournament_id,
    'homeName', home_entry.name,
    'awayName', away_entry.name,
    'scheduledAt', match_row.scheduled_at,
    'venue', venue.name,
    'court', court.name
  )
  from public.tournament_matches match_row
  cross join lateral public.tournament_match_team_entries(match_row.id) teams
  join public.tournament_team_managers manager
    on manager.team_entry_id in (teams.home_team_entry_id, teams.away_team_entry_id)
    and manager.user_id = auth.uid()
    and manager.status = 'active'
    and manager.role in ('captain', 'delegate')
  join public.tournament_team_entries home_entry
    on home_entry.id = teams.home_team_entry_id
  join public.tournament_team_entries away_entry
    on away_entry.id = teams.away_team_entry_id
  left join public.tournament_venues venue on venue.id = match_row.venue_id
  left join public.tournament_courts court on court.id = match_row.court_id
  where auth.uid() is not null and match_row.id = p_match_id
  limit 1;
$$;

create or replace function public.save_match_squad(
  p_organization_id uuid,
  p_match_id uuid,
  p_team_entry_id uuid,
  p_players jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_roster public.tournament_rosters%rowtype;
  v_squad public.tournament_match_squads%rowtype;
  v_player jsonb;
  v_roster_player public.tournament_roster_players%rowtype;
  v_team_size integer;
  v_substitutes_limit integer;
  v_starters integer;
  v_captains integer;
  v_called_up integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_players, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_players, '[]'::jsonb)) > 80
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_MATCH_SQUAD';
  end if;
  select * into v_match from public.tournament_matches
  where id = p_match_id and organization_id = p_organization_id for update;
  if v_match.id is null or v_match.status not in ('scheduled', 'ready')
    or not public.can_manage_tournament_match_squad(
      p_organization_id, p_match_id, p_team_entry_id
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.tournament_match_operations operation
    where operation.match_id = p_match_id
      and operation.status not in ('superseded', 'voided')
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_MATCH_OPERATION_ACTIVE';
  end if;
  select * into v_roster from public.tournament_rosters
  where team_entry_id = p_team_entry_id and status in ('approved', 'locked')
  order by version desc limit 1;
  if v_roster.id is null then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_ROSTER_NOT_APPROVED';
  end if;
  select coalesce(category.team_size, tournament.team_size),
    coalesce(tournament.substitutes_limit, tournament.team_size)
  into v_team_size, v_substitutes_limit
  from public.tournament_categories category
  join public.tournaments tournament on tournament.id = category.tournament_id
  where category.id = v_match.category_id;
  select count(*) filter (where value->>'lineupStatus' = 'starter'),
    count(*) filter (where coalesce((value->>'isCaptain')::boolean, false)),
    count(*) filter (where value->>'callupStatus' = 'called_up')
  into v_starters, v_captains, v_called_up
  from jsonb_array_elements(p_players);
  if v_starters > v_team_size or v_captains > 1
    or v_called_up > v_team_size + v_substitutes_limit
  then
    raise exception using errcode = '23514', message = 'TORNEOS_INVALID_MATCH_SQUAD';
  end if;
  insert into public.tournament_match_squads (
    organization_id, match_id, team_entry_id, roster_id, created_by
  ) values (
    p_organization_id, p_match_id, p_team_entry_id, v_roster.id, auth.uid()
  )
  on conflict (match_id, team_entry_id) where status <> 'superseded'
  do update set updated_at = now()
  returning * into v_squad;
  if v_squad.status <> 'draft' then
    raise exception using errcode = '55000', message = 'TORNEOS_MATCH_SQUAD_LOCKED';
  end if;
  delete from public.tournament_match_squad_players
  where match_squad_id = v_squad.id;
  for v_player in select value from jsonb_array_elements(p_players)
  loop
    select * into v_roster_player
    from public.tournament_roster_players
    where id = (v_player->>'rosterPlayerId')::uuid
      and roster_id = v_roster.id and team_entry_id = p_team_entry_id
      and status = 'active' and eligibility_status = 'eligible';
    if v_roster_player.id is null then
      raise exception using errcode = '23514', message = 'TORNEOS_MATCH_PLAYER_OUT_OF_SCOPE';
    end if;
    insert into public.tournament_match_squad_players (
      organization_id, match_squad_id, match_id, roster_player_id, team_entry_id,
      availability_status, callup_status, lineup_status, shirt_number_snapshot,
      position_snapshot, display_name_snapshot, avatar_url_snapshot,
      is_goalkeeper, is_captain, attendance_status
    ) values (
      p_organization_id, v_squad.id, p_match_id, v_roster_player.id, p_team_entry_id,
      coalesce(v_player->>'availabilityStatus', 'pending'),
      coalesce(v_player->>'callupStatus', 'not_called_up'),
      coalesce(v_player->>'lineupStatus', 'not_in_match_squad'),
      v_roster_player.shirt_number, v_roster_player.primary_position,
      v_roster_player.display_name, v_roster_player.avatar_url,
      v_roster_player.is_goalkeeper,
      coalesce((v_player->>'isCaptain')::boolean, false),
      coalesce(v_player->>'attendanceStatus', 'unknown')
    );
  end loop;
  perform public.append_tournament_audit(
    p_organization_id, 'match_squad.saved', 'match_squad', v_squad.id,
    p_team_entry_id, v_match.tournament_id,
    jsonb_build_object('players', jsonb_array_length(p_players))
  );
  return public.get_match_squad_context(p_organization_id, p_match_id, p_team_entry_id);
end;
$$;

create or replace function public.submit_match_squad(
  p_organization_id uuid,
  p_match_id uuid,
  p_team_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_squad public.tournament_match_squads%rowtype;
  v_match public.tournament_matches%rowtype;
  v_team_size integer;
  v_substitutes_limit integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_match from public.tournament_matches
  where id = p_match_id and organization_id = p_organization_id for update;
  select * into v_squad from public.tournament_match_squads
  where match_id = p_match_id and team_entry_id = p_team_entry_id
    and status = 'draft' for update;
  if v_match.id is null or v_match.status not in ('scheduled', 'ready')
    or v_squad.id is null
    or not public.can_manage_tournament_match_squad(
      p_organization_id, p_match_id, p_team_entry_id
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.tournament_match_operations operation
    where operation.match_id = p_match_id
      and operation.status not in ('superseded', 'voided')
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_MATCH_OPERATION_ACTIVE';
  end if;
  select coalesce(category.team_size, tournament.team_size),
    coalesce(tournament.substitutes_limit, tournament.team_size)
  into v_team_size, v_substitutes_limit
  from public.tournament_categories category
  join public.tournaments tournament on tournament.id = category.tournament_id
  where category.id = v_match.category_id;
  if (select count(*) from public.tournament_match_squad_players
      where match_squad_id = v_squad.id and lineup_status = 'starter') <> v_team_size
    or (select count(*) from public.tournament_match_squad_players
      where match_squad_id = v_squad.id and callup_status = 'called_up' and is_captain) <> 1
    or (select count(*) from public.tournament_match_squad_players
      where match_squad_id = v_squad.id and callup_status = 'called_up')
      > v_team_size + v_substitutes_limit
    or (select count(*) from public.tournament_match_squad_players
      where match_squad_id = v_squad.id and lineup_status = 'starter'
        and is_goalkeeper) < 1
    or (select count(*) from public.tournament_match_squad_players
      where match_squad_id = v_squad.id and lineup_status = 'starter'
        and is_captain) <> 1
  then
    raise exception using errcode = '23514', message = 'TORNEOS_INVALID_MATCH_SQUAD';
  end if;
  update public.tournament_match_squads set
    status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), updated_at = now()
  where id = v_squad.id returning * into v_squad;
  perform public.append_tournament_audit(
    p_organization_id, 'match_squad.submitted', 'match_squad', v_squad.id,
    p_team_entry_id, v_match.tournament_id, '{}'::jsonb
  );
  return public.get_match_squad_context(p_organization_id, p_match_id, p_team_entry_id);
end;
$$;

create or replace function public.open_tournament_match_operation(
  p_organization_id uuid,
  p_match_id uuid,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_fixture public.tournament_fixture_versions%rowtype;
  v_teams record;
  v_home public.tournament_team_entries%rowtype;
  v_away public.tournament_team_entries%rowtype;
  v_operation public.tournament_match_operations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('torneos:match-operation:' || p_match_id, 0));
  select * into v_match from public.tournament_matches
  where id = p_match_id and organization_id = p_organization_id for update;
  if v_match.id is null
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_operations.open'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  select * into v_fixture from public.tournament_fixture_versions
  where id = v_match.fixture_version_id for share;
  select * into v_teams from public.tournament_match_team_entries(p_match_id);
  if v_fixture.status <> 'published' or v_fixture.invalidated_at is not null
    or v_match.status not in ('scheduled', 'ready')
    or v_teams.home_team_entry_id is null or v_teams.away_team_entry_id is null
  then
    raise exception using errcode = '55000', message = 'TORNEOS_MATCH_NOT_OPENABLE';
  end if;
  if v_match.scheduled_at is not null
    and now() < v_match.scheduled_at - interval '6 hours'
    and char_length(btrim(coalesce(p_override_reason, ''))) < 3
  then
    raise exception using errcode = '55000', message = 'TORNEOS_MATCH_OPEN_WINDOW';
  end if;
  select * into v_operation from public.tournament_match_operations
  where match_id = p_match_id
    and status in ('draft', 'submitted', 'under_review', 'validated')
  order by operation_version desc
  limit 1;
  if v_operation.id is not null then
    return public.get_tournament_match_operation_context(
      p_organization_id, v_operation.id
    );
  end if;
  if exists (
    select 1
    from public.tournament_match_operations
    where match_id = p_match_id and status = 'official'
  ) then
    raise exception using errcode = '55000',
      message = 'TORNEOS_MATCH_ALREADY_OFFICIAL';
  end if;
  perform 1
  from public.tournament_match_squads
  where match_id = p_match_id and status in ('draft', 'submitted')
  order by team_entry_id
  for update;
  select * into v_home from public.tournament_team_entries
  where id = v_teams.home_team_entry_id;
  select * into v_away from public.tournament_team_entries
  where id = v_teams.away_team_entry_id;
  insert into public.tournament_match_operations (
    organization_id, season_id, tournament_id, category_id, fixture_version_id,
    phase_id, round_id, match_id, home_team_entry_id, away_team_entry_id,
    operation_version, match_snapshot, home_team_snapshot, away_team_snapshot,
    opened_by
  ) values (
    p_organization_id, v_match.season_id, v_match.tournament_id, v_match.category_id,
    v_match.fixture_version_id, v_match.phase_id, v_match.round_id, v_match.id,
    v_home.id, v_away.id,
    coalesce((select max(operation_version) from public.tournament_match_operations
      where match_id = p_match_id), 0) + 1,
    jsonb_build_object(
      'scheduledAt', v_match.scheduled_at, 'venueId', v_match.venue_id,
      'courtId', v_match.court_id, 'durationMinutes', v_match.duration_minutes,
      'matchNumber', v_match.match_number, 'overrideReason', nullif(btrim(p_override_reason), '')
    ),
    jsonb_build_object('id', v_home.id, 'name', v_home.name, 'shortName', v_home.short_name,
      'shieldPath', v_home.shield_path, 'primaryColor', v_home.primary_color),
    jsonb_build_object('id', v_away.id, 'name', v_away.name, 'shortName', v_away.short_name,
      'shieldPath', v_away.shield_path, 'primaryColor', v_away.primary_color),
    auth.uid()
  ) returning * into v_operation;
  insert into public.tournament_match_operation_players (
    organization_id, match_operation_id, match_id, team_entry_id, roster_player_id,
    display_name_snapshot, avatar_url_snapshot, shirt_number_snapshot,
    position_snapshot, is_goalkeeper, is_captain, lineup_status, attendance_status
  )
  select player.organization_id, v_operation.id, player.match_id, player.team_entry_id,
    player.roster_player_id, player.display_name_snapshot, player.avatar_url_snapshot,
    player.shirt_number_snapshot, player.position_snapshot, player.is_goalkeeper,
    player.is_captain, player.lineup_status, player.attendance_status
  from public.tournament_match_squad_players player
  join public.tournament_match_squads squad on squad.id = player.match_squad_id
  where squad.match_id = p_match_id and squad.status = 'submitted'
    and player.callup_status = 'called_up';
  update public.tournament_match_squads set
    status = 'locked', locked_by = auth.uid(), locked_at = now(), updated_at = now()
  where match_id = p_match_id and status = 'submitted';
  perform public.append_tournament_audit(
    p_organization_id, 'match_operation.opened', 'match_operation', v_operation.id,
    null, v_match.tournament_id,
    jsonb_build_object('operationVersion', v_operation.operation_version)
  );
  return public.get_tournament_match_operation_context(p_organization_id, v_operation.id);
end;
$$;

create or replace function public.get_tournament_match_operation_context(
  p_organization_id uuid,
  p_match_operation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.can_read_tournament_match_operation(p_organization_id, operation.match_id)
      then public.raise_tournament_match_error('TORNEOS_MATCH_FORBIDDEN')
    else jsonb_build_object(
      'operation', to_jsonb(operation),
      'outcome', to_jsonb(outcome),
      'score', to_jsonb(score),
      'players', coalesce((
        select jsonb_agg(to_jsonb(player) order by player.team_entry_id, player.lineup_status, player.display_name_snapshot)
        from public.tournament_match_operation_players player
        where player.match_operation_id = operation.id
      ), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(to_jsonb(event) order by event.sequence_number)
        from public.tournament_match_events event
        where event.match_operation_id = operation.id
      ), '[]'::jsonb),
      'reviews', coalesce((
        select jsonb_agg(to_jsonb(review) order by review.requested_at)
        from public.tournament_match_reviews review
        where review.match_operation_id = operation.id
      ), '[]'::jsonb),
      'resumptions', coalesce((
        select jsonb_agg(to_jsonb(resumption) order by resumption.created_at)
        from public.tournament_match_resumptions resumption
        where resumption.match_operation_id = operation.id
      ), '[]'::jsonb)
    )
  end
  from public.tournament_match_operations operation
  left join public.tournament_match_outcomes outcome
    on outcome.match_operation_id = operation.id
  left join public.tournament_match_scores score
    on score.match_operation_id = operation.id
  where operation.id = p_match_operation_id
    and operation.organization_id = p_organization_id;
$$;

create or replace function public.get_tournament_match_operations_context(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.has_tournament_organization_capability(
      p_organization_id, 'match_operations.read'
    ) then public.raise_tournament_match_error('TORNEOS_MATCH_FORBIDDEN')
    else jsonb_build_object(
      'matches', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', match_row.id,
          'categoryId', match_row.category_id,
          'fixtureVersionId', match_row.fixture_version_id,
          'roundId', match_row.round_id,
          'matchNumber', match_row.match_number,
          'scheduledAt', match_row.scheduled_at,
          'planningStatus', match_row.status,
          'venue', venue.name,
          'court', court.name,
          'homeTeamEntryId', teams.home_team_entry_id,
          'awayTeamEntryId', teams.away_team_entry_id,
          'homeName', home_entry.name,
          'awayName', away_entry.name,
          'homeSquadStatus', home_squad.status,
          'awaySquadStatus', away_squad.status,
          'operationId', operation.id,
          'operationVersion', operation.operation_version,
          'operationStatus', operation.status,
          'matchStatus', operation.match_status,
          'outcomeType', outcome.outcome_type,
          'officialOperationId', official_operation.id,
          'homeScore', official_score.home_score,
          'awayScore', official_score.away_score,
          'hasOpenCorrection', exists (
            select 1 from public.tournament_match_reviews review
            where review.match_operation_id in (
              operation.id, operation.source_operation_id
            )
              and review.review_type = 'correction' and review.status = 'open'
          )
        ) order by match_row.scheduled_at nulls last, match_row.match_number)
        from public.tournament_matches match_row
        join public.tournament_fixture_versions fixture
          on fixture.id = match_row.fixture_version_id and fixture.status = 'published'
        cross join lateral public.tournament_match_team_entries(match_row.id) teams
        join public.tournament_team_entries home_entry
          on home_entry.id = teams.home_team_entry_id
        join public.tournament_team_entries away_entry
          on away_entry.id = teams.away_team_entry_id
        left join public.tournament_venues venue on venue.id = match_row.venue_id
        left join public.tournament_courts court on court.id = match_row.court_id
        left join public.tournament_match_squads home_squad
          on home_squad.match_id = match_row.id
          and home_squad.team_entry_id = teams.home_team_entry_id
          and home_squad.status <> 'superseded'
        left join public.tournament_match_squads away_squad
          on away_squad.match_id = match_row.id
          and away_squad.team_entry_id = teams.away_team_entry_id
          and away_squad.status <> 'superseded'
        left join lateral (
          select candidate.*
          from public.tournament_match_operations candidate
          where candidate.match_id = match_row.id
            and candidate.status <> 'superseded'
          order by candidate.operation_version desc
          limit 1
        ) operation on true
        left join lateral (
          select candidate.id
          from public.tournament_match_operations candidate
          where candidate.match_id = match_row.id
            and candidate.status = 'official'
          order by candidate.operation_version desc
          limit 1
        ) official_operation on true
        left join public.tournament_match_outcomes outcome
          on outcome.match_operation_id = operation.id
        left join public.tournament_match_scores official_score
          on official_score.match_operation_id = official_operation.id
        where match_row.organization_id = p_organization_id
          and match_row.tournament_id = p_tournament_id
          and (p_category_id is null or match_row.category_id = p_category_id)
      ), '[]'::jsonb)
    )
  end;
$$;

create or replace function public.save_tournament_match_operation_draft(
  p_organization_id uuid,
  p_match_operation_id uuid,
  p_match_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.tournament_match_operations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_operation.id is null or v_operation.status <> 'draft'
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_operations.update_draft'
    )
    or p_match_status not in (
      'ready', 'in_progress', 'suspended', 'abandoned',
      'played', 'administrative', 'voided'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  update public.tournament_match_operations
  set match_status = p_match_status, notes = nullif(btrim(p_notes), ''), updated_at = now()
  where id = p_match_operation_id;
  return public.get_tournament_match_operation_context(p_organization_id, p_match_operation_id);
end;
$$;

create or replace function public.set_tournament_match_outcome(
  p_organization_id uuid,
  p_match_operation_id uuid,
  p_outcome jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.tournament_match_operations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_operation.id is null or v_operation.status <> 'draft'
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_outcomes.manage'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if p_outcome->>'outcomeType' in (
    'home_no_show', 'away_no_show', 'double_no_show',
    'walkover_home', 'walkover_away', 'administrative_result'
  ) and not public.has_tournament_organization_capability(
    p_organization_id, 'match_administrative_results.manage'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  insert into public.tournament_match_outcomes (
    match_operation_id, organization_id, match_id, outcome_type,
    started_at, ended_at, suspension_minute, suspension_period,
    events_remain_valid, reason_code, reason_text,
    administrative_home_score, administrative_away_score,
    counts_for_standings, counts_for_player_stats, requires_resolution,
    resolved_by, resolved_at
  ) values (
    v_operation.id, p_organization_id, v_operation.match_id, p_outcome->>'outcomeType',
    (p_outcome->>'startedAt')::timestamptz, (p_outcome->>'endedAt')::timestamptz,
    (p_outcome->>'suspensionMinute')::smallint, p_outcome->>'suspensionPeriod',
    coalesce((p_outcome->>'eventsRemainValid')::boolean, true),
    p_outcome->>'reasonCode', nullif(btrim(p_outcome->>'reasonText'), ''),
    (p_outcome->>'administrativeHomeScore')::smallint,
    (p_outcome->>'administrativeAwayScore')::smallint,
    coalesce((p_outcome->>'countsForStandings')::boolean, false),
    coalesce((p_outcome->>'countsForPlayerStats')::boolean, false),
    coalesce((p_outcome->>'requiresResolution')::boolean, false),
    case when coalesce((p_outcome->>'requiresResolution')::boolean, false) then null else auth.uid() end,
    case when coalesce((p_outcome->>'requiresResolution')::boolean, false) then null else now() end
  )
  on conflict (match_operation_id) do update set
    outcome_type = excluded.outcome_type, started_at = excluded.started_at,
    ended_at = excluded.ended_at, suspension_minute = excluded.suspension_minute,
    suspension_period = excluded.suspension_period,
    events_remain_valid = excluded.events_remain_valid,
    reason_code = excluded.reason_code, reason_text = excluded.reason_text,
    administrative_home_score = excluded.administrative_home_score,
    administrative_away_score = excluded.administrative_away_score,
    counts_for_standings = excluded.counts_for_standings,
    counts_for_player_stats = excluded.counts_for_player_stats,
    requires_resolution = excluded.requires_resolution,
    resolved_by = excluded.resolved_by, resolved_at = excluded.resolved_at,
    updated_at = now();
  update public.tournament_match_operations set
    match_status = case
      when p_outcome->>'outcomeType' = 'played' then 'played'
      when p_outcome->>'outcomeType' = 'suspended' then 'suspended'
      when p_outcome->>'outcomeType' = 'abandoned' then 'abandoned'
      when p_outcome->>'outcomeType' in (
        'home_no_show', 'away_no_show', 'double_no_show',
        'walkover_home', 'walkover_away', 'administrative_result'
      ) then 'administrative'
      else match_status end,
    updated_at = now()
  where id = v_operation.id;
  perform public.append_tournament_audit(
    p_organization_id,
    case when p_outcome->>'outcomeType' = 'suspended'
      then 'match_operation.suspended'
      when p_outcome->>'outcomeType' in ('home_no_show', 'away_no_show', 'double_no_show')
      then 'match_operation.no_show'
      else 'match_operation.outcome_set' end,
    'match_operation', v_operation.id, null, v_operation.tournament_id,
    jsonb_build_object('outcomeType', p_outcome->>'outcomeType')
  );
  return public.get_tournament_match_operation_context(p_organization_id, v_operation.id);
end;
$$;

create or replace function public.set_tournament_match_score(
  p_organization_id uuid,
  p_match_operation_id uuid,
  p_score jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.tournament_match_operations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_operation.id is null or v_operation.status <> 'draft'
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_scores.manage'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if p_score->>'scoreType' in ('administrative', 'walkover')
    and not public.has_tournament_organization_capability(
      p_organization_id, 'match_administrative_results.manage'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  insert into public.tournament_match_scores (
    match_operation_id, organization_id, match_id, home_score, away_score,
    home_score_first_half, away_score_first_half, home_penalties, away_penalties,
    score_type
  ) values (
    v_operation.id, p_organization_id, v_operation.match_id,
    (p_score->>'homeScore')::smallint, (p_score->>'awayScore')::smallint,
    (p_score->>'homeScoreFirstHalf')::smallint,
    (p_score->>'awayScoreFirstHalf')::smallint,
    (p_score->>'homePenalties')::smallint, (p_score->>'awayPenalties')::smallint,
    p_score->>'scoreType'
  )
  on conflict (match_operation_id) do update set
    home_score = excluded.home_score, away_score = excluded.away_score,
    home_score_first_half = excluded.home_score_first_half,
    away_score_first_half = excluded.away_score_first_half,
    home_penalties = excluded.home_penalties, away_penalties = excluded.away_penalties,
    score_type = excluded.score_type, updated_at = now();
  perform public.append_tournament_audit(
    p_organization_id, 'match_operation.score_set', 'match_operation',
    v_operation.id, null, v_operation.tournament_id,
    jsonb_build_object(
      'homeScore', (p_score->>'homeScore')::integer,
      'awayScore', (p_score->>'awayScore')::integer,
      'scoreType', p_score->>'scoreType'
    )
  );
  return public.get_tournament_match_operation_context(p_organization_id, v_operation.id);
end;
$$;

create or replace function public.add_tournament_match_event(
  p_organization_id uuid,
  p_match_operation_id uuid,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.tournament_match_operations%rowtype;
  v_event public.tournament_match_events%rowtype;
  v_related_event public.tournament_match_events%rowtype;
  v_is_on_field boolean;
  v_sequence integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_operation.id is null or v_operation.status <> 'draft'
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_events.create'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if (p_event->>'teamEntryId')::uuid not in (
    v_operation.home_team_entry_id, v_operation.away_team_entry_id
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_EVENT_TEAM_MISMATCH';
  end if;
  if p_event->>'rosterPlayerId' is not null and not exists (
    select 1 from public.tournament_match_operation_players player
    where player.match_operation_id = v_operation.id
      and player.roster_player_id = (p_event->>'rosterPlayerId')::uuid
      and (
        (p_event->>'eventType' = 'own_goal'
          and player.team_entry_id <> (p_event->>'teamEntryId')::uuid)
        or (p_event->>'eventType' <> 'own_goal'
          and player.team_entry_id = (p_event->>'teamEntryId')::uuid)
      )
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_EVENT_PLAYER_MISMATCH';
  end if;
  if p_event->>'relatedRosterPlayerId' is not null and not exists (
    select 1 from public.tournament_match_operation_players player
    where player.match_operation_id = v_operation.id
      and player.roster_player_id = (p_event->>'relatedRosterPlayerId')::uuid
      and player.team_entry_id = (p_event->>'teamEntryId')::uuid
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_EVENT_PLAYER_MISMATCH';
  end if;
  if p_event->>'eventType' not in ('assist', 'substitution_in')
    and (
      p_event->>'relatedEventId' is not null
      or p_event->>'relatedRosterPlayerId' is not null
    )
  then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_EVENT_RELATION_INVALID';
  end if;
  if p_event->>'eventType' = 'assist'
    and p_event->>'relatedRosterPlayerId' is not null
  then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_EVENT_RELATION_INVALID';
  end if;
  if p_event->>'eventType' = 'assist' and (
    p_event->>'relatedEventId' is null or not exists (
      select 1 from public.tournament_match_events goal
      where goal.id = (p_event->>'relatedEventId')::uuid
        and goal.match_operation_id = v_operation.id
        and goal.team_entry_id = (p_event->>'teamEntryId')::uuid
        and goal.event_type in ('goal', 'penalty_goal')
        and not (goal.event_type = 'penalty_goal' and goal.period = 'penalties')
        and goal.roster_player_id is not null
        and goal.roster_player_id <> (p_event->>'rosterPlayerId')::uuid
        and goal.voided_at is null
    )
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_ASSIST_WITHOUT_GOAL';
  end if;
  if p_event->>'rosterPlayerId' is not null and exists (
    select 1
    from public.tournament_match_operation_players player
    where player.match_operation_id = v_operation.id
      and player.roster_player_id = (p_event->>'rosterPlayerId')::uuid
      and player.attendance_status in ('absent', 'excused')
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_PLAYER_ABSENT';
  end if;
  if p_event->>'rosterPlayerId' is not null
    and p_event->>'eventType' not in ('incident', 'substitution_out')
    and exists (
      select 1 from public.tournament_match_events earlier
      where earlier.match_operation_id = v_operation.id
        and earlier.roster_player_id = (p_event->>'rosterPlayerId')::uuid
        and earlier.event_type in ('red_card', 'second_yellow')
        and earlier.voided_at is null
    )
  then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_PLAYER_ALREADY_SENT_OFF';
  end if;
  if p_event->>'eventType' = 'second_yellow' and not exists (
    select 1 from public.tournament_match_events earlier
    where earlier.match_operation_id = v_operation.id
      and earlier.roster_player_id = (p_event->>'rosterPlayerId')::uuid
      and earlier.event_type = 'yellow_card'
      and earlier.voided_at is null
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_SECOND_YELLOW_WITHOUT_FIRST';
  end if;
  if p_event->>'eventType' = 'substitution_out' then
    select (
      (
        player.lineup_status = 'starter'
        or exists (
          select 1
          from public.tournament_match_events entered
          where entered.match_operation_id = v_operation.id
            and entered.roster_player_id = player.roster_player_id
            and entered.event_type = 'substitution_in'
            and entered.voided_at is null
        )
      )
      and coalesce((
        select max(entered.sequence_number)
        from public.tournament_match_events entered
        where entered.match_operation_id = v_operation.id
          and entered.roster_player_id = player.roster_player_id
          and entered.event_type = 'substitution_in'
          and entered.voided_at is null
      ), 0) >= coalesce((
        select max(exited.sequence_number)
        from public.tournament_match_events exited
        where exited.match_operation_id = v_operation.id
          and exited.roster_player_id = player.roster_player_id
          and exited.event_type = 'substitution_out'
          and exited.voided_at is null
      ), 0)
    ) into v_is_on_field
    from public.tournament_match_operation_players player
    where player.match_operation_id = v_operation.id
      and player.roster_player_id = (p_event->>'rosterPlayerId')::uuid;
    if not coalesce(v_is_on_field, false) then
      raise exception using errcode = '23514', message = 'TORNEOS_MATCH_PLAYER_NOT_ON_FIELD';
    end if;
  end if;
  if p_event->>'eventType' = 'substitution_in' then
    if p_event->>'relatedEventId' is null
      or p_event->>'relatedRosterPlayerId' is null
      or (p_event->>'relatedRosterPlayerId')::uuid
        = (p_event->>'rosterPlayerId')::uuid
    then
      raise exception using errcode = '23514', message = 'TORNEOS_MATCH_SUBSTITUTION_INVALID';
    end if;
    select * into v_related_event
    from public.tournament_match_events
    where id = (p_event->>'relatedEventId')::uuid
      and match_operation_id = v_operation.id
      and team_entry_id = (p_event->>'teamEntryId')::uuid
      and roster_player_id = (p_event->>'relatedRosterPlayerId')::uuid
      and event_type = 'substitution_out'
      and voided_at is null;
    if v_related_event.id is null
      or v_related_event.minute is distinct from (p_event->>'minute')::smallint
      or v_related_event.period is distinct from coalesce(p_event->>'period', 'unknown')
    then
      raise exception using errcode = '23514', message = 'TORNEOS_MATCH_SUBSTITUTION_INVALID';
    end if;
    if exists (
      select 1
      from public.tournament_match_events entered
      where entered.match_operation_id = v_operation.id
        and entered.related_event_id = v_related_event.id
        and entered.event_type = 'substitution_in'
        and entered.voided_at is null
    ) then
      raise exception using errcode = '23514', message = 'TORNEOS_MATCH_SUBSTITUTION_INVALID';
    end if;
    select (
      (
        player.lineup_status = 'starter'
        or exists (
          select 1
          from public.tournament_match_events entered
          where entered.match_operation_id = v_operation.id
            and entered.roster_player_id = player.roster_player_id
            and entered.event_type = 'substitution_in'
            and entered.voided_at is null
        )
      )
      and coalesce((
        select max(entered.sequence_number)
        from public.tournament_match_events entered
        where entered.match_operation_id = v_operation.id
          and entered.roster_player_id = player.roster_player_id
          and entered.event_type = 'substitution_in'
          and entered.voided_at is null
      ), 0) >= coalesce((
        select max(exited.sequence_number)
        from public.tournament_match_events exited
        where exited.match_operation_id = v_operation.id
          and exited.roster_player_id = player.roster_player_id
          and exited.event_type = 'substitution_out'
          and exited.voided_at is null
      ), 0)
    ) into v_is_on_field
    from public.tournament_match_operation_players player
    where player.match_operation_id = v_operation.id
      and player.roster_player_id = (p_event->>'rosterPlayerId')::uuid;
    if coalesce(v_is_on_field, false) then
      raise exception using errcode = '23514', message = 'TORNEOS_MATCH_PLAYER_ALREADY_ON_FIELD';
    end if;
  end if;
  select coalesce(max(sequence_number), 0) + 1 into v_sequence
  from public.tournament_match_events where match_operation_id = v_operation.id;
  insert into public.tournament_match_events (
    organization_id, match_operation_id, match_id, team_entry_id,
    roster_player_id, related_roster_player_id, related_event_id,
    event_type, minute, period, sequence_number, unidentified_player_reason,
    metadata, created_by
  ) values (
    p_organization_id, v_operation.id, v_operation.match_id,
    (p_event->>'teamEntryId')::uuid,
    (p_event->>'rosterPlayerId')::uuid,
    (p_event->>'relatedRosterPlayerId')::uuid,
    (p_event->>'relatedEventId')::uuid,
    p_event->>'eventType', (p_event->>'minute')::smallint,
    coalesce(p_event->>'period', 'unknown'), v_sequence,
    nullif(btrim(p_event->>'unidentifiedPlayerReason'), ''),
    coalesce(p_event->'metadata', '{}'::jsonb), auth.uid()
  ) returning * into v_event;
  if v_event.event_type = 'assist' and (
    v_event.related_event_id is null or not exists (
      select 1 from public.tournament_match_events goal
      where goal.id = v_event.related_event_id
        and goal.match_operation_id = v_operation.id
        and goal.team_entry_id = v_event.team_entry_id
        and goal.event_type in ('goal', 'penalty_goal')
        and not (goal.event_type = 'penalty_goal' and goal.period = 'penalties')
        and goal.roster_player_id is not null
        and goal.roster_player_id <> v_event.roster_player_id
        and goal.voided_at is null
    )
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_ASSIST_WITHOUT_GOAL';
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'match_event.added', 'match_event', v_event.id,
    v_event.team_entry_id, v_operation.tournament_id,
    jsonb_build_object('eventType', v_event.event_type, 'sequence', v_event.sequence_number)
  );
  return to_jsonb(v_event);
end;
$$;

create or replace function public.void_tournament_match_event(
  p_organization_id uuid,
  p_event_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.tournament_match_events%rowtype;
  v_operation public.tournament_match_operations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_event from public.tournament_match_events
  where id = p_event_id and organization_id = p_organization_id;
  select * into v_operation from public.tournament_match_operations
  where id = v_event.match_operation_id and organization_id = p_organization_id
  for update;
  select * into v_event from public.tournament_match_events
  where id = p_event_id and organization_id = p_organization_id
  for update;
  if v_event.id is null or v_event.voided_at is not null or v_operation.status <> 'draft'
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_events.void'
    )
    or char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  update public.tournament_match_events set
    voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
  where id = p_event_id returning * into v_event;
  perform public.append_tournament_audit(
    p_organization_id, 'match_event.voided', 'match_event', v_event.id,
    v_event.team_entry_id, v_operation.tournament_id,
    jsonb_build_object('eventType', v_event.event_type)
  );
  return to_jsonb(v_event);
end;
$$;

create or replace function public.validate_tournament_match_operation_payload(
  p_match_operation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_operation public.tournament_match_operations%rowtype;
  v_outcome public.tournament_match_outcomes%rowtype;
  v_score public.tournament_match_scores%rowtype;
  v_home_goals integer;
  v_away_goals integer;
  v_home_shootout_goals integer;
  v_away_shootout_goals integer;
  v_errors jsonb := '[]'::jsonb;
begin
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id;
  if v_operation.id is null or not public.can_read_tournament_match_operation(
    v_operation.organization_id, v_operation.match_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  select * into v_outcome from public.tournament_match_outcomes
  where match_operation_id = v_operation.id;
  select * into v_score from public.tournament_match_scores
  where match_operation_id = v_operation.id;
  if v_outcome.match_operation_id is null then
    v_errors := v_errors || jsonb_build_array('outcome_required');
  end if;
  if coalesce(v_outcome.requires_resolution, false) then
    v_errors := v_errors || jsonb_build_array('resolution_pending');
  end if;
  if v_outcome.outcome_type in (
    'played', 'walkover_home', 'walkover_away', 'administrative_result',
    'home_no_show', 'away_no_show', 'double_no_show'
  ) and v_score.match_operation_id is null then
    v_errors := v_errors || jsonb_build_array('score_required');
  end if;
  if v_score.match_operation_id is not null and not (
    (v_outcome.outcome_type = 'played'
      and v_score.score_type in ('played', 'series_leg'))
    or (v_outcome.outcome_type in ('walkover_home', 'walkover_away')
      and v_score.score_type = 'walkover')
    or (v_outcome.outcome_type in (
      'administrative_result', 'home_no_show', 'away_no_show', 'double_no_show'
    ) and v_score.score_type = 'administrative')
    or (v_outcome.outcome_type in ('suspended', 'abandoned')
      and v_score.score_type in ('played', 'administrative'))
  ) then
    v_errors := v_errors || jsonb_build_array('score_outcome_mismatch');
  end if;
  if v_outcome.outcome_type in (
    'walkover_home', 'walkover_away',
    'home_no_show', 'away_no_show', 'double_no_show'
  )
    and v_outcome.counts_for_player_stats
  then
    v_errors := v_errors || jsonb_build_array('walkover_player_stats_forbidden');
  end if;
  if v_outcome.outcome_type in (
    'postponed_before_start', 'cancelled', 'not_played'
  ) and v_score.match_operation_id is not null then
    v_errors := v_errors || jsonb_build_array('score_not_allowed_for_outcome');
  end if;
  if v_outcome.outcome_type in (
    'postponed_before_start', 'cancelled', 'not_played',
    'walkover_home', 'walkover_away',
    'home_no_show', 'away_no_show', 'double_no_show'
  ) and exists (
    select 1
    from public.tournament_match_events event
    where event.match_operation_id = v_operation.id
      and event.voided_at is null
      and event.event_type in (
        'goal', 'own_goal', 'assist', 'penalty_goal', 'penalty_missed',
        'yellow_card', 'second_yellow', 'red_card',
        'substitution_in', 'substitution_out'
      )
  ) then
    v_errors := v_errors || jsonb_build_array('events_not_allowed_for_outcome');
  end if;
  if v_outcome.outcome_type in (
    'walkover_home', 'walkover_away', 'administrative_result',
    'home_no_show', 'away_no_show', 'double_no_show',
    'suspended', 'abandoned', 'cancelled', 'not_played'
  ) and char_length(btrim(coalesce(v_outcome.reason_text, ''))) < 3 then
    v_errors := v_errors || jsonb_build_array('outcome_reason_required');
  end if;
  if v_outcome.administrative_home_score is not null and (
    v_score.match_operation_id is null
    or v_outcome.administrative_home_score <> v_score.home_score
    or v_outcome.administrative_away_score <> v_score.away_score
  ) then
    v_errors := v_errors || jsonb_build_array('administrative_score_mismatch');
  end if;
  if v_outcome.outcome_type not in (
    'walkover_home', 'walkover_away', 'administrative_result',
    'home_no_show', 'away_no_show', 'double_no_show'
  ) and v_outcome.administrative_home_score is not null then
    v_errors := v_errors || jsonb_build_array('administrative_score_forbidden');
  end if;
  if v_score.home_penalties is not null and (
    v_outcome.outcome_type <> 'played'
    or v_score.home_score <> v_score.away_score
    or v_score.home_penalties = v_score.away_penalties
  ) then
    v_errors := v_errors || jsonb_build_array('penalty_score_invalid');
  end if;
  if exists (
    select 1
    from public.tournament_match_events assist
    left join public.tournament_match_events goal
      on goal.id = assist.related_event_id
      and goal.match_operation_id = assist.match_operation_id
      and goal.team_entry_id = assist.team_entry_id
      and goal.event_type in ('goal', 'penalty_goal')
      and not (goal.event_type = 'penalty_goal' and goal.period = 'penalties')
      and goal.voided_at is null
    where assist.match_operation_id = v_operation.id
      and assist.event_type = 'assist'
      and assist.voided_at is null
      and (
        goal.id is null
        or goal.roster_player_id is null
        or goal.roster_player_id = assist.roster_player_id
      )
  ) then
    v_errors := v_errors || jsonb_build_array('assist_without_goal');
  end if;
  if exists (
    select 1
    from public.tournament_match_events exited
    left join public.tournament_match_events entered
      on entered.related_event_id = exited.id
      and entered.match_operation_id = exited.match_operation_id
      and entered.event_type = 'substitution_in'
      and entered.voided_at is null
    where exited.match_operation_id = v_operation.id
      and exited.event_type = 'substitution_out'
      and exited.voided_at is null
      and entered.id is null
  ) then
    v_errors := v_errors || jsonb_build_array('substitution_pair_required');
  end if;
  if exists (
    select 1
    from public.tournament_match_events second_yellow
    where second_yellow.match_operation_id = v_operation.id
      and second_yellow.event_type = 'second_yellow'
      and second_yellow.voided_at is null
      and not exists (
        select 1
        from public.tournament_match_events first_yellow
        where first_yellow.match_operation_id = v_operation.id
          and first_yellow.roster_player_id = second_yellow.roster_player_id
          and first_yellow.event_type = 'yellow_card'
          and first_yellow.sequence_number < second_yellow.sequence_number
          and first_yellow.voided_at is null
      )
  ) then
    v_errors := v_errors || jsonb_build_array('second_yellow_without_first');
  end if;
  if v_outcome.counts_for_player_stats and v_score.score_type in ('played', 'series_leg') then
    select count(*) filter (where event.team_entry_id = v_operation.home_team_entry_id),
      count(*) filter (where event.team_entry_id = v_operation.away_team_entry_id)
    into v_home_goals, v_away_goals
    from public.tournament_match_events event
    where event.match_operation_id = v_operation.id
      and event.voided_at is null
      and event.event_type in ('goal', 'penalty_goal', 'own_goal')
      and not (event.event_type = 'penalty_goal' and event.period = 'penalties');
    if v_home_goals <> v_score.home_score or v_away_goals <> v_score.away_score then
      v_errors := v_errors || jsonb_build_array('score_events_mismatch');
    end if;
  end if;
  if v_score.home_penalties is not null and exists (
    select 1
    from public.tournament_match_events event
    where event.match_operation_id = v_operation.id
      and event.voided_at is null
      and event.period = 'penalties'
      and event.event_type in ('penalty_goal', 'penalty_missed')
  ) then
    select count(*) filter (
        where event.team_entry_id = v_operation.home_team_entry_id
          and event.event_type = 'penalty_goal'
      ),
      count(*) filter (
        where event.team_entry_id = v_operation.away_team_entry_id
          and event.event_type = 'penalty_goal'
      )
    into v_home_shootout_goals, v_away_shootout_goals
    from public.tournament_match_events event
    where event.match_operation_id = v_operation.id
      and event.voided_at is null
      and event.period = 'penalties';
    if v_home_shootout_goals <> v_score.home_penalties
      or v_away_shootout_goals <> v_score.away_penalties
    then
      v_errors := v_errors || jsonb_build_array('penalty_events_mismatch');
    end if;
  end if;
  if v_outcome.outcome_type = 'suspended' and (
    not v_outcome.requires_resolution
    and not exists (
      select 1 from public.tournament_match_resumptions
      where match_operation_id = v_operation.id and status in ('pending', 'scheduled')
    )
  ) then
    v_errors := v_errors || jsonb_build_array('suspension_resolution_required');
  end if;
  if v_outcome.outcome_type in ('home_no_show', 'walkover_away')
    and exists (
      select 1 from public.tournament_match_operation_players player
      where player.match_operation_id = v_operation.id
        and player.team_entry_id = v_operation.home_team_entry_id
        and player.attendance_status in ('present', 'late')
    )
  then
    v_errors := v_errors || jsonb_build_array('home_no_show_presence_conflict');
  end if;
  if v_outcome.outcome_type in ('away_no_show', 'walkover_home')
    and exists (
      select 1 from public.tournament_match_operation_players player
      where player.match_operation_id = v_operation.id
        and player.team_entry_id = v_operation.away_team_entry_id
        and player.attendance_status in ('present', 'late')
    )
  then
    v_errors := v_errors || jsonb_build_array('away_no_show_presence_conflict');
  end if;
  if v_outcome.outcome_type = 'double_no_show'
    and exists (
      select 1 from public.tournament_match_operation_players player
      where player.match_operation_id = v_operation.id
        and player.attendance_status in ('present', 'late')
    )
  then
    v_errors := v_errors || jsonb_build_array('double_no_show_presence_conflict');
  end if;
  return jsonb_build_object(
    'valid', jsonb_array_length(v_errors) = 0,
    'errors', v_errors
  );
end;
$$;

create or replace function public.submit_tournament_match_operation(
  p_organization_id uuid,
  p_match_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.tournament_match_operations%rowtype;
  v_validation jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_operation.id is null or v_operation.status <> 'draft'
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_operations.submit'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  v_validation := public.validate_tournament_match_operation_payload(v_operation.id);
  if not (v_validation->>'valid')::boolean then
    raise exception using errcode = '23514',
      message = 'TORNEOS_MATCH_OPERATION_INVALID',
      detail = v_validation->'errors'::text;
  end if;
  update public.tournament_match_operations set
    status = 'submitted', match_status = 'awaiting_validation',
    submitted_by = auth.uid(), submitted_at = now(), updated_at = now()
  where id = v_operation.id;
  insert into public.tournament_match_reviews (
    organization_id, match_operation_id, review_type, reason, requested_by
  ) values (
    p_organization_id, v_operation.id, 'validation',
    'Acta presentada para validación', auth.uid()
  );
  perform public.append_tournament_audit(
    p_organization_id, 'match_operation.submitted', 'match_operation',
    v_operation.id, null, v_operation.tournament_id,
    jsonb_build_object('operationVersion', v_operation.operation_version)
  );
  return public.get_tournament_match_operation_context(p_organization_id, v_operation.id);
end;
$$;

create or replace function public.review_tournament_match_operation(
  p_organization_id uuid,
  p_match_operation_id uuid,
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.tournament_match_operations%rowtype;
  v_review public.tournament_match_reviews%rowtype;
  v_outcome_type text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_operation.id is null or v_operation.status not in ('submitted', 'under_review')
    or p_decision not in ('approved', 'rejected')
    or char_length(btrim(coalesce(p_reason, ''))) not between 3 and 2000
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_operations.review'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  select * into v_review from public.tournament_match_reviews
  where match_operation_id = v_operation.id and review_type = 'validation'
    and status = 'open' for update;
  if v_review.id is null then
    raise exception using errcode = '55000', message = 'TORNEOS_MATCH_REVIEW_NOT_OPEN';
  end if;
  update public.tournament_match_reviews set
    status = p_decision, resolved_by = auth.uid(), resolved_at = now(),
    resolution = btrim(p_reason)
  where id = v_review.id;
  select outcome_type into v_outcome_type
  from public.tournament_match_outcomes
  where match_operation_id = v_operation.id;
  update public.tournament_match_operations set
    status = case when p_decision = 'approved' then 'under_review' else 'draft' end,
    match_status = case when p_decision = 'approved' then match_status else
      case
        when v_outcome_type = 'played' then 'played'
        when v_outcome_type = 'suspended' then 'suspended'
        when v_outcome_type = 'abandoned' then 'abandoned'
        when v_outcome_type in (
          'home_no_show', 'away_no_show', 'double_no_show',
          'walkover_home', 'walkover_away', 'administrative_result'
        ) then 'administrative'
        else 'ready'
      end end,
    submitted_by = case when p_decision = 'approved' then submitted_by else null end,
    submitted_at = case when p_decision = 'approved' then submitted_at else null end,
    updated_at = now()
  where id = v_operation.id;
  perform public.append_tournament_audit(
    p_organization_id, 'match_operation.reviewed', 'match_operation',
    v_operation.id, null, v_operation.tournament_id,
    jsonb_build_object('decision', p_decision)
  );
  return public.get_tournament_match_operation_context(p_organization_id, v_operation.id);
end;
$$;

create or replace function public.validate_tournament_match_operation(
  p_organization_id uuid,
  p_match_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.tournament_match_operations%rowtype;
  v_validation jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_operation.id is null or v_operation.status <> 'under_review'
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_operations.validate'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if v_operation.submitted_by = auth.uid() then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_DUAL_CONTROL_REQUIRED';
  end if;
  v_validation := public.validate_tournament_match_operation_payload(v_operation.id);
  if not (v_validation->>'valid')::boolean then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_OPERATION_INVALID';
  end if;
  update public.tournament_match_operations set
    status = 'validated', validated_by = auth.uid(), validated_at = now(), updated_at = now()
  where id = v_operation.id;
  perform public.append_tournament_audit(
    p_organization_id, 'match_operation.validated', 'match_operation',
    v_operation.id, null, v_operation.tournament_id, '{}'::jsonb
  );
  return public.get_tournament_match_operation_context(p_organization_id, v_operation.id);
end;
$$;

create or replace function public.make_tournament_match_official(
  p_organization_id uuid,
  p_match_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.tournament_match_operations%rowtype;
  v_source public.tournament_match_operations%rowtype;
  v_validation jsonb;
  v_match_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select match_id into v_match_id
  from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id;
  if v_match_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('torneos:match-official:' || v_match_id, 0));
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_operation.id is null
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_operations.make_official'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if v_operation.status = 'official' then
    return public.get_tournament_match_operation_context(
      p_organization_id, v_operation.id
    );
  end if;
  if v_operation.status <> 'validated' then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.tournament_match_reviews
    where match_operation_id = v_operation.id and status = 'open'
      and review_type <> 'validation'
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_MATCH_REVIEW_OPEN';
  end if;
  v_validation := public.validate_tournament_match_operation_payload(v_operation.id);
  if not (v_validation->>'valid')::boolean then
    raise exception using errcode = '23514', message = 'TORNEOS_MATCH_OPERATION_INVALID';
  end if;
  if v_operation.source_operation_id is not null then
    select * into v_source from public.tournament_match_operations
    where id = v_operation.source_operation_id and match_id = v_operation.match_id for update;
    if v_source.id is null or v_source.status <> 'official'
      or not exists (
        select 1
        from public.tournament_match_reviews review
        where review.match_operation_id = v_source.id
          and review.review_type = 'correction'
          and review.status = 'open'
      )
    then
      raise exception using errcode = '55000', message = 'TORNEOS_MATCH_CORRECTION_STALE';
    end if;
    update public.tournament_match_reviews set
      status = 'approved',
      resolved_by = auth.uid(),
      resolved_at = now(),
      resolution = 'Corrección reemplazada por una nueva versión oficial'
    where match_operation_id = v_source.id
      and review_type = 'correction'
      and status = 'open';
    update public.tournament_match_operations set status = 'superseded', updated_at = now()
    where id = v_source.id;
    perform public.append_tournament_audit(
      p_organization_id, 'match_operation.superseded', 'match_operation',
      v_source.id, null, v_source.tournament_id,
      jsonb_build_object('replacementOperationId', v_operation.id)
    );
  end if;
  update public.tournament_match_operations set
    status = 'official', match_status = 'official', official_by = auth.uid(),
    official_at = now(), closed_at = now(), updated_at = now()
  where id = v_operation.id;
  perform public.append_tournament_audit(
    p_organization_id, 'match_operation.made_official', 'match_operation',
    v_operation.id, null, v_operation.tournament_id,
    jsonb_build_object('operationVersion', v_operation.operation_version)
  );
  return public.get_tournament_match_operation_context(p_organization_id, v_operation.id);
end;
$$;

create or replace function public.request_tournament_match_correction(
  p_organization_id uuid,
  p_match_operation_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.tournament_match_operations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_operation.id is null or v_operation.status <> 'official'
    or char_length(btrim(coalesce(p_reason, ''))) not between 3 and 2000
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_operations.request_correction'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if exists (
    select 1
    from public.tournament_match_reviews review
    where review.match_operation_id = v_operation.id
      and review.review_type = 'correction'
      and review.status = 'open'
  ) then
    raise exception using errcode = '55000',
      message = 'TORNEOS_MATCH_CORRECTION_EXISTS';
  end if;
  insert into public.tournament_match_reviews (
    organization_id, match_operation_id, review_type, reason, requested_by
  ) values (
    p_organization_id, v_operation.id, 'correction', btrim(p_reason), auth.uid()
  );
  perform public.append_tournament_audit(
    p_organization_id, 'match_operation.correction_requested',
    'match_operation', v_operation.id, null, v_operation.tournament_id,
    jsonb_build_object('operationVersion', v_operation.operation_version)
  );
  return public.get_tournament_match_operation_context(p_organization_id, v_operation.id);
end;
$$;

create or replace function public.create_tournament_match_correction(
  p_organization_id uuid,
  p_match_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.tournament_match_operations%rowtype;
  v_new public.tournament_match_operations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('torneos:match-correction:' || p_match_operation_id, 0));
  select * into v_source from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_source.id is null or v_source.status <> 'official'
    or not exists (
      select 1
      from public.tournament_match_reviews review
      where review.match_operation_id = v_source.id
        and review.review_type = 'correction'
        and review.status = 'open'
    )
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_operations.correct'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.tournament_match_operations
    where source_operation_id = v_source.id and status <> 'voided'
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_MATCH_CORRECTION_EXISTS';
  end if;
  insert into public.tournament_match_operations (
    organization_id, season_id, tournament_id, category_id, fixture_version_id,
    phase_id, round_id, match_id, home_team_entry_id, away_team_entry_id,
    status, match_status, operation_version, source_operation_id,
    match_snapshot, home_team_snapshot, away_team_snapshot, notes,
    opened_by, reopened_at, reopened_by
  ) select
    organization_id, season_id, tournament_id, category_id, fixture_version_id,
    phase_id, round_id, match_id, home_team_entry_id, away_team_entry_id,
    'draft', case (
      select outcome.outcome_type
      from public.tournament_match_outcomes outcome
      where outcome.match_operation_id = v_source.id
    )
      when 'played' then 'played'
      when 'suspended' then 'suspended'
      when 'abandoned' then 'abandoned'
      when 'home_no_show' then 'administrative'
      when 'away_no_show' then 'administrative'
      when 'double_no_show' then 'administrative'
      when 'walkover_home' then 'administrative'
      when 'walkover_away' then 'administrative'
      when 'administrative_result' then 'administrative'
      else 'ready'
    end,
    (
      select coalesce(max(existing.operation_version), 0) + 1
      from public.tournament_match_operations existing
      where existing.match_id = v_source.match_id
    ), id, match_snapshot, home_team_snapshot,
    away_team_snapshot, notes, auth.uid(), now(), auth.uid()
  from public.tournament_match_operations where id = v_source.id
  returning * into v_new;
  insert into public.tournament_match_operation_players (
    organization_id, match_operation_id, match_id, team_entry_id, roster_player_id,
    display_name_snapshot, avatar_url_snapshot, shirt_number_snapshot,
    position_snapshot, is_goalkeeper, is_captain, lineup_status, attendance_status
  ) select
    organization_id, v_new.id, match_id, team_entry_id, roster_player_id,
    display_name_snapshot, avatar_url_snapshot, shirt_number_snapshot,
    position_snapshot, is_goalkeeper, is_captain, lineup_status, attendance_status
  from public.tournament_match_operation_players where match_operation_id = v_source.id;
  insert into public.tournament_match_outcomes (
    match_operation_id, organization_id, match_id, outcome_type, started_at,
    ended_at, suspension_minute, suspension_period, events_remain_valid,
    reason_code, reason_text, administrative_home_score, administrative_away_score,
    counts_for_standings, counts_for_player_stats, requires_resolution,
    resolved_by, resolved_at
  ) select
    v_new.id, organization_id, match_id, outcome_type, started_at, ended_at,
    suspension_minute, suspension_period, events_remain_valid, reason_code,
    reason_text, administrative_home_score, administrative_away_score,
    counts_for_standings, counts_for_player_stats, requires_resolution,
    resolved_by, resolved_at
  from public.tournament_match_outcomes where match_operation_id = v_source.id;
  insert into public.tournament_match_scores (
    match_operation_id, organization_id, match_id, home_score, away_score,
    home_score_first_half, away_score_first_half, home_penalties, away_penalties,
    score_type
  ) select
    v_new.id, organization_id, match_id, home_score, away_score,
    home_score_first_half, away_score_first_half, home_penalties, away_penalties,
    score_type
  from public.tournament_match_scores where match_operation_id = v_source.id;
  insert into public.tournament_match_events (
    organization_id, match_operation_id, match_id, team_entry_id,
    roster_player_id, related_roster_player_id, event_type, minute, period,
    sequence_number, unidentified_player_reason, metadata, created_by
  ) select
    organization_id, v_new.id, match_id, team_entry_id,
    roster_player_id, related_roster_player_id, event_type, minute, period,
    sequence_number, unidentified_player_reason,
    metadata || jsonb_build_object(
      'copiedFromEventId', id,
      'copiedFromRelatedEventId', related_event_id
    ), auth.uid()
  from public.tournament_match_events
  where match_operation_id = v_source.id and voided_at is null
  order by sequence_number;
  update public.tournament_match_events copied
  set related_event_id = copied_goal.id
  from public.tournament_match_events copied_goal
  where copied.match_operation_id = v_new.id
    and copied.event_type in ('assist', 'substitution_in')
    and copied_goal.match_operation_id = v_new.id
    and copied_goal.metadata->>'copiedFromEventId'
      = copied.metadata->>'copiedFromRelatedEventId';
  perform public.append_tournament_audit(
    p_organization_id, 'match_operation.correction_created',
    'match_operation', v_new.id, null, v_new.tournament_id,
    jsonb_build_object(
      'sourceOperationId', v_source.id,
      'operationVersion', v_new.operation_version
    )
  );
  return public.get_tournament_match_operation_context(p_organization_id, v_new.id);
end;
$$;

create or replace function public.schedule_tournament_match_resumption(
  p_organization_id uuid,
  p_match_operation_id uuid,
  p_scheduled_at timestamptz default null,
  p_venue_id uuid default null,
  p_court_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.tournament_match_operations%rowtype;
  v_resumption public.tournament_match_resumptions%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_operation.id is null or v_operation.status <> 'draft'
    or v_operation.match_status <> 'suspended'
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_outcomes.manage'
    )
    or char_length(btrim(coalesce(p_reason, ''))) not between 3 and 1000
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  insert into public.tournament_match_resumptions (
    organization_id, match_operation_id, scheduled_at, venue_id, court_id,
    status, reason, created_by
  ) values (
    p_organization_id, v_operation.id, p_scheduled_at, p_venue_id, p_court_id,
    case when p_scheduled_at is null then 'pending' else 'scheduled' end,
    btrim(p_reason), auth.uid()
  )
  on conflict (match_operation_id) where status in ('pending', 'scheduled')
  do update set
    scheduled_at = excluded.scheduled_at,
    venue_id = excluded.venue_id,
    court_id = excluded.court_id,
    status = excluded.status,
    reason = excluded.reason
  returning * into v_resumption;
  perform public.append_tournament_audit(
    p_organization_id, 'match_operation.resumption_planned',
    'match_resumption', v_resumption.id, null, v_operation.tournament_id,
    jsonb_build_object('status', v_resumption.status)
  );
  return to_jsonb(v_resumption);
end;
$$;

create or replace function public.void_tournament_match_operation(
  p_organization_id uuid,
  p_match_operation_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.tournament_match_operations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_operation from public.tournament_match_operations
  where id = p_match_operation_id and organization_id = p_organization_id for update;
  if v_operation.id is null or v_operation.status in ('official', 'superseded', 'voided')
    or char_length(btrim(coalesce(p_reason, ''))) not between 3 and 1000
    or not public.has_tournament_organization_capability(
      p_organization_id, 'match_operations.void'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_MATCH_FORBIDDEN';
  end if;
  update public.tournament_match_operations set
    status = 'voided', match_status = 'voided', notes = btrim(p_reason),
    closed_at = now(), updated_at = now()
  where id = v_operation.id;
  perform public.append_tournament_audit(
    p_organization_id, 'match_operation.voided', 'match_operation',
    v_operation.id, null, v_operation.tournament_id, '{}'::jsonb
  );
  return public.get_tournament_match_operation_context(p_organization_id, v_operation.id);
end;
$$;

alter table public.tournament_match_squads enable row level security;
alter table public.tournament_match_squad_players enable row level security;
alter table public.tournament_match_availability_responses enable row level security;
alter table public.tournament_match_operations enable row level security;
alter table public.tournament_match_operation_players enable row level security;
alter table public.tournament_match_outcomes enable row level security;
alter table public.tournament_match_scores enable row level security;
alter table public.tournament_match_events enable row level security;
alter table public.tournament_match_reviews enable row level security;
alter table public.tournament_match_resumptions enable row level security;

create policy tournament_match_squads_select_scope
on public.tournament_match_squads for select to authenticated
using (
  public.has_tournament_organization_capability(organization_id, 'match_squads.read')
  or public.is_tournament_team_manager(team_entry_id, false)
);
create policy tournament_match_squad_players_select_scope
on public.tournament_match_squad_players for select to authenticated
using (
  public.has_tournament_organization_capability(organization_id, 'match_squads.read')
  or public.is_tournament_team_manager(team_entry_id, false)
  or exists (
    select 1
    from public.tournament_roster_players player
    where player.id = roster_player_id
      and player.arma2_user_id = auth.uid()
      and player.status = 'active'
      and player.eligibility_status = 'eligible'
  )
);
create policy tournament_match_availability_select_scope
on public.tournament_match_availability_responses for select to authenticated
using (
  user_id = auth.uid()
  or public.has_tournament_organization_capability(organization_id, 'match_availability.read')
  or public.is_tournament_team_manager(team_entry_id, false)
);
create policy tournament_match_operations_select_scope
on public.tournament_match_operations for select to authenticated
using (
  public.has_tournament_organization_capability(organization_id, 'match_operations.read')
);
create policy tournament_match_operation_players_select_scope
on public.tournament_match_operation_players for select to authenticated
using (
  public.has_tournament_organization_capability(organization_id, 'match_operations.read')
);
create policy tournament_match_outcomes_select_scope
on public.tournament_match_outcomes for select to authenticated
using (
  public.has_tournament_organization_capability(organization_id, 'match_operations.read')
);
create policy tournament_match_scores_select_scope
on public.tournament_match_scores for select to authenticated
using (
  public.has_tournament_organization_capability(organization_id, 'match_operations.read')
);
create policy tournament_match_events_select_scope
on public.tournament_match_events for select to authenticated
using (
  public.has_tournament_organization_capability(organization_id, 'match_events.read')
);
create policy tournament_match_reviews_select_scope
on public.tournament_match_reviews for select to authenticated
using (
  public.has_tournament_organization_capability(organization_id, 'match_operations.review')
);
create policy tournament_match_resumptions_select_scope
on public.tournament_match_resumptions for select to authenticated
using (
  public.has_tournament_organization_capability(organization_id, 'match_operations.read')
);

revoke all on table public.tournament_match_squads from anon, authenticated;
revoke all on table public.tournament_match_squad_players from anon, authenticated;
revoke all on table public.tournament_match_availability_responses from anon, authenticated;
revoke all on table public.tournament_match_operations from anon, authenticated;
revoke all on table public.tournament_match_operation_players from anon, authenticated;
revoke all on table public.tournament_match_outcomes from anon, authenticated;
revoke all on table public.tournament_match_scores from anon, authenticated;
revoke all on table public.tournament_match_events from anon, authenticated;
revoke all on table public.tournament_match_reviews from anon, authenticated;
revoke all on table public.tournament_match_resumptions from anon, authenticated;

grant select on table public.tournament_match_squads to authenticated;
grant select on table public.tournament_match_squad_players to authenticated;
grant select on table public.tournament_match_availability_responses to authenticated;
grant select on table public.tournament_match_operations to authenticated;
grant select on table public.tournament_match_operation_players to authenticated;
grant select on table public.tournament_match_outcomes to authenticated;
grant select on table public.tournament_match_scores to authenticated;
grant select on table public.tournament_match_events to authenticated;
grant select on table public.tournament_match_reviews to authenticated;
grant select on table public.tournament_match_resumptions to authenticated;

revoke all on function public.raise_tournament_match_error(text) from public;
revoke all on function public.tournament_match_team_entries(uuid) from public;
revoke all on function public.can_read_tournament_match_operation(uuid, uuid) from public;
revoke all on function public.can_manage_tournament_match_squad(uuid, uuid, uuid) from public;
revoke all on function public.validate_tournament_match_player_scope() from public;
revoke all on function public.validate_tournament_match_squad_scope() from public;
revoke all on function public.protect_tournament_match_squad_players() from public;
revoke all on function public.protect_tournament_match_operation_history() from public;
revoke all on function public.validate_tournament_match_operation_source() from public;
revoke all on function public.reject_tournament_match_child_delete() from public;
revoke all on function public.protect_tournament_match_child_history() from public;
revoke all on function public.protect_tournament_match_planning_transition() from public;
revoke all on function public.get_player_tournament_matches() from public;
revoke all on function public.get_managed_tournament_matches() from public;
revoke all on function public.respond_match_availability(uuid, text, text) from public;
revoke all on function public.record_manual_match_availability(uuid, uuid, uuid, text, text, text) from public;
revoke all on function public.get_match_squad_context(uuid, uuid, uuid) from public;
revoke all on function public.get_my_managed_match_squad_context(uuid) from public;
revoke all on function public.save_match_squad(uuid, uuid, uuid, jsonb) from public;
revoke all on function public.submit_match_squad(uuid, uuid, uuid) from public;
revoke all on function public.open_tournament_match_operation(uuid, uuid, text) from public;
revoke all on function public.get_tournament_match_operation_context(uuid, uuid) from public;
revoke all on function public.get_tournament_match_operations_context(uuid, uuid, uuid) from public;
revoke all on function public.save_tournament_match_operation_draft(uuid, uuid, text, text) from public;
revoke all on function public.set_tournament_match_outcome(uuid, uuid, jsonb) from public;
revoke all on function public.set_tournament_match_score(uuid, uuid, jsonb) from public;
revoke all on function public.add_tournament_match_event(uuid, uuid, jsonb) from public;
revoke all on function public.void_tournament_match_event(uuid, uuid, text) from public;
revoke all on function public.validate_tournament_match_operation_payload(uuid) from public;
revoke all on function public.submit_tournament_match_operation(uuid, uuid) from public;
revoke all on function public.review_tournament_match_operation(uuid, uuid, text, text) from public;
revoke all on function public.validate_tournament_match_operation(uuid, uuid) from public;
revoke all on function public.make_tournament_match_official(uuid, uuid) from public;
revoke all on function public.request_tournament_match_correction(uuid, uuid, text) from public;
revoke all on function public.create_tournament_match_correction(uuid, uuid) from public;
revoke all on function public.void_tournament_match_operation(uuid, uuid, text) from public;
revoke all on function public.schedule_tournament_match_resumption(uuid, uuid, timestamptz, uuid, uuid, text) from public;

grant execute on function public.get_player_tournament_matches() to authenticated;
grant execute on function public.get_managed_tournament_matches() to authenticated;
grant execute on function public.respond_match_availability(uuid, text, text) to authenticated;
grant execute on function public.record_manual_match_availability(uuid, uuid, uuid, text, text, text) to authenticated;
grant execute on function public.get_match_squad_context(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_my_managed_match_squad_context(uuid) to authenticated;
grant execute on function public.save_match_squad(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.submit_match_squad(uuid, uuid, uuid) to authenticated;
grant execute on function public.open_tournament_match_operation(uuid, uuid, text) to authenticated;
grant execute on function public.get_tournament_match_operation_context(uuid, uuid) to authenticated;
grant execute on function public.get_tournament_match_operations_context(uuid, uuid, uuid) to authenticated;
grant execute on function public.save_tournament_match_operation_draft(uuid, uuid, text, text) to authenticated;
grant execute on function public.set_tournament_match_outcome(uuid, uuid, jsonb) to authenticated;
grant execute on function public.set_tournament_match_score(uuid, uuid, jsonb) to authenticated;
grant execute on function public.add_tournament_match_event(uuid, uuid, jsonb) to authenticated;
grant execute on function public.void_tournament_match_event(uuid, uuid, text) to authenticated;
grant execute on function public.submit_tournament_match_operation(uuid, uuid) to authenticated;
grant execute on function public.review_tournament_match_operation(uuid, uuid, text, text) to authenticated;
grant execute on function public.validate_tournament_match_operation(uuid, uuid) to authenticated;
grant execute on function public.make_tournament_match_official(uuid, uuid) to authenticated;
grant execute on function public.request_tournament_match_correction(uuid, uuid, text) to authenticated;
grant execute on function public.create_tournament_match_correction(uuid, uuid) to authenticated;
grant execute on function public.void_tournament_match_operation(uuid, uuid, text) to authenticated;

comment on table public.tournament_match_operations is
  'Versioned match report authority. Official versions are immutable and corrections clone state.';
comment on table public.tournament_match_availability_responses is
  'Self or audited manual availability; never implies call-up or attendance.';
comment on table public.tournament_match_events is
  'Append-only event timeline. Voiding preserves the original fact and audit trail.';
