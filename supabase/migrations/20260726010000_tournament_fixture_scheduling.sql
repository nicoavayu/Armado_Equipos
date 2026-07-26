-- Arma2 Torneos: frozen participants, deterministic fixtures and scheduling.
-- Local/dedicated staging only. Never apply this migration to the Arma2 production project.

create extension if not exists pgcrypto;

create table public.tournament_participant_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  version_number integer not null,
  status text not null default 'frozen',
  participant_fingerprint text not null,
  frozen_by uuid not null references auth.users(id) on delete restrict,
  frozen_at timestamptz not null default now(),
  reopened_by uuid references auth.users(id) on delete restrict,
  reopened_at timestamptz,
  reopen_reason text,
  invalidated_at timestamptz,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint tournament_participant_sets_tournament_fk
    foreign key (organization_id, tournament_id, season_id)
    references public.tournaments(organization_id, id, season_id) on delete restrict,
  constraint tournament_participant_sets_category_fk
    foreign key (organization_id, tournament_id, category_id)
    references public.tournament_categories(organization_id, tournament_id, id) on delete restrict,
  constraint tournament_participant_sets_status_check
    check (status in ('frozen', 'reopened', 'superseded')),
  constraint tournament_participant_sets_version_check check (version_number > 0),
  constraint tournament_participant_sets_fingerprint_check
    check (participant_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint tournament_participant_sets_reopen_check check (
    (status = 'reopened' and reopened_by is not null and reopened_at is not null
      and invalidated_at is not null and char_length(btrim(reopen_reason)) between 3 and 500)
    or (status <> 'reopened' and reopened_at is null and reopen_reason is null)
  ),
  constraint tournament_participant_sets_scope_unique
    unique (organization_id, tournament_id, category_id, id),
  constraint tournament_participant_sets_version_unique
    unique (tournament_id, category_id, version_number),
  constraint tournament_participant_sets_idempotency_unique
    unique (organization_id, frozen_by, idempotency_key)
);

create unique index tournament_participant_sets_frozen_unique
  on public.tournament_participant_sets (tournament_id, category_id)
  where status = 'frozen';
create index tournament_participant_sets_context_idx
  on public.tournament_participant_sets
  (organization_id, tournament_id, category_id, version_number desc);

create table public.tournament_competition_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  participant_set_id uuid not null,
  team_entry_id uuid not null,
  seed_number integer,
  pot_number integer,
  status text not null default 'active',
  snapshot_name text not null,
  snapshot_short_name text,
  snapshot_shield_path text,
  snapshot_primary_color text,
  snapshot_secondary_color text,
  frozen_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint tournament_competition_participants_set_fk
    foreign key (organization_id, tournament_id, category_id, participant_set_id)
    references public.tournament_participant_sets
      (organization_id, tournament_id, category_id, id) on delete restrict,
  constraint tournament_competition_participants_entry_fk
    foreign key (organization_id, tournament_id, team_entry_id)
    references public.tournament_team_entries
      (organization_id, tournament_id, id) on delete restrict,
  constraint tournament_competition_participants_status_check
    check (status in ('active', 'withdrawn', 'archived')),
  constraint tournament_competition_participants_name_check
    check (snapshot_name = btrim(snapshot_name) and char_length(snapshot_name) between 2 and 100),
  constraint tournament_competition_participants_short_name_check
    check (
      snapshot_short_name is null
      or char_length(btrim(snapshot_short_name)) between 2 and 20
    ),
  constraint tournament_competition_participants_colors_check check (
    (snapshot_primary_color is null or snapshot_primary_color ~ '^#[0-9A-Fa-f]{6}$')
    and (snapshot_secondary_color is null or snapshot_secondary_color ~ '^#[0-9A-Fa-f]{6}$')
  ),
  constraint tournament_competition_participants_seed_check
    check (seed_number is null or seed_number > 0),
  constraint tournament_competition_participants_pot_check
    check (pot_number is null or pot_number > 0),
  constraint tournament_competition_participants_scope_unique
    unique (organization_id, tournament_id, category_id, participant_set_id, id),
  constraint tournament_competition_participants_entry_unique
    unique (participant_set_id, team_entry_id),
  constraint tournament_competition_participants_seed_unique
    unique (participant_set_id, seed_number)
);

create index tournament_competition_participants_set_order_idx
  on public.tournament_competition_participants
  (participant_set_id, status, seed_number nulls last, snapshot_name, id);

create table public.tournament_draw_pots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  participant_set_id uuid not null,
  name text not null,
  number integer not null,
  sort_order integer not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tournament_draw_pots_set_fk
    foreign key (organization_id, tournament_id, category_id, participant_set_id)
    references public.tournament_participant_sets
      (organization_id, tournament_id, category_id, id) on delete restrict,
  constraint tournament_draw_pots_name_check
    check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint tournament_draw_pots_number_check check (number > 0),
  constraint tournament_draw_pots_status_check check (status in ('active', 'archived')),
  constraint tournament_draw_pots_archive_check check (
    (status = 'archived' and archived_at is not null)
    or (status = 'active' and archived_at is null)
  ),
  constraint tournament_draw_pots_scope_unique
    unique (organization_id, tournament_id, category_id, participant_set_id, id)
);

create unique index tournament_draw_pots_number_unique
  on public.tournament_draw_pots (participant_set_id, number)
  where status = 'active';
create index tournament_draw_pots_order_idx
  on public.tournament_draw_pots (participant_set_id, sort_order, number)
  where status = 'active';

create table public.tournament_draw_pot_members (
  pot_id uuid not null,
  participant_id uuid not null,
  seed_number integer,
  created_at timestamptz not null default now(),
  primary key (pot_id, participant_id),
  constraint tournament_draw_pot_members_seed_check
    check (seed_number is null or seed_number > 0),
  constraint tournament_draw_pot_members_participant_unique unique (participant_id)
);

create index tournament_draw_pot_members_pot_order_idx
  on public.tournament_draw_pot_members (pot_id, seed_number nulls last, created_at);

create table public.tournament_fixture_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  participant_set_id uuid not null,
  version_number integer not null,
  status text not null default 'draft',
  generation_method text not null,
  seed text,
  participant_fingerprint text not null,
  configuration_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  superseded_at timestamptz,
  archived_at timestamptz,
  invalidated_at timestamptz,
  constraint tournament_fixture_versions_set_fk
    foreign key (organization_id, tournament_id, category_id, participant_set_id)
    references public.tournament_participant_sets
      (organization_id, tournament_id, category_id, id) on delete restrict,
  constraint tournament_fixture_versions_tournament_fk
    foreign key (organization_id, tournament_id, season_id)
    references public.tournaments(organization_id, id, season_id) on delete restrict,
  constraint tournament_fixture_versions_status_check
    check (status in ('draft', 'published', 'superseded', 'archived')),
  constraint tournament_fixture_versions_method_check
    check (generation_method in ('automatic', 'manual', 'draw', 'import_future')),
  constraint tournament_fixture_versions_version_check check (version_number > 0),
  constraint tournament_fixture_versions_seed_check
    check (seed is null or char_length(seed) between 1 and 160),
  constraint tournament_fixture_versions_fingerprint_check
    check (participant_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint tournament_fixture_versions_configuration_check
    check (jsonb_typeof(configuration_snapshot) = 'object'
      and pg_column_size(configuration_snapshot) <= 32768),
  constraint tournament_fixture_versions_lifecycle_check check (
    (status = 'published' and published_at is not null and superseded_at is null and archived_at is null)
    or (status = 'superseded' and published_at is not null and superseded_at is not null and archived_at is null)
    or (status = 'archived' and archived_at is not null)
    or (status = 'draft' and published_at is null and superseded_at is null and archived_at is null)
  ),
  constraint tournament_fixture_versions_scope_unique
    unique (organization_id, tournament_id, category_id, id),
  constraint tournament_fixture_versions_version_unique
    unique (tournament_id, category_id, version_number),
  constraint tournament_fixture_versions_idempotency_unique
    unique (organization_id, created_by, idempotency_key)
);

create unique index tournament_fixture_versions_published_unique
  on public.tournament_fixture_versions (tournament_id, category_id)
  where status = 'published';
create index tournament_fixture_versions_context_idx
  on public.tournament_fixture_versions
  (organization_id, tournament_id, category_id, version_number desc);

create table public.tournament_phases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  fixture_version_id uuid not null,
  name text not null,
  phase_type text not null,
  sequence_number integer not null,
  status text not null default 'draft',
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  constraint tournament_phases_fixture_fk
    foreign key (organization_id, tournament_id, category_id, fixture_version_id)
    references public.tournament_fixture_versions
      (organization_id, tournament_id, category_id, id) on delete restrict,
  constraint tournament_phases_name_check
    check (name = btrim(name) and char_length(name) between 1 and 100),
  constraint tournament_phases_type_check check (phase_type in (
    'league', 'groups', 'round_of_32', 'round_of_16', 'quarterfinal',
    'semifinal', 'third_place', 'final', 'custom_knockout'
  )),
  constraint tournament_phases_sequence_check check (sequence_number > 0),
  constraint tournament_phases_status_check
    check (status in ('draft', 'generated', 'scheduled', 'active_future', 'completed_future', 'archived')),
  constraint tournament_phases_configuration_check
    check (jsonb_typeof(configuration) = 'object' and pg_column_size(configuration) <= 16384),
  constraint tournament_phases_scope_unique
    unique (organization_id, tournament_id, category_id, fixture_version_id, id),
  constraint tournament_phases_sequence_unique
    unique (fixture_version_id, sequence_number)
);

create index tournament_phases_fixture_order_idx
  on public.tournament_phases (fixture_version_id, sequence_number);

create table public.tournament_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  participant_set_id uuid not null,
  fixture_version_id uuid,
  phase_id uuid,
  name text not null,
  code text not null,
  sort_order integer not null default 0,
  status text not null default 'draft',
  draw_seed text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tournament_groups_set_fk
    foreign key (organization_id, tournament_id, category_id, participant_set_id)
    references public.tournament_participant_sets
      (organization_id, tournament_id, category_id, id) on delete restrict,
  constraint tournament_groups_fixture_fk
    foreign key (organization_id, tournament_id, category_id, fixture_version_id)
    references public.tournament_fixture_versions
      (organization_id, tournament_id, category_id, id) on delete restrict,
  constraint tournament_groups_phase_fk
    foreign key (organization_id, tournament_id, category_id, fixture_version_id, phase_id)
    references public.tournament_phases
      (organization_id, tournament_id, category_id, fixture_version_id, id) on delete restrict,
  constraint tournament_groups_name_check
    check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint tournament_groups_code_check
    check (code = upper(btrim(code)) and code ~ '^[A-Z0-9-]{1,12}$'),
  constraint tournament_groups_status_check
    check (status in ('draft', 'published', 'archived')),
  constraint tournament_groups_archive_check check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived' and archived_at is null)
  ),
  constraint tournament_groups_phase_requires_fixture
    check (phase_id is null or fixture_version_id is not null),
  constraint tournament_groups_scope_unique
    unique (organization_id, tournament_id, category_id, participant_set_id, id)
);

create unique index tournament_groups_draw_code_unique
  on public.tournament_groups (participant_set_id, code)
  where fixture_version_id is null and status <> 'archived';
create unique index tournament_groups_fixture_code_unique
  on public.tournament_groups (fixture_version_id, code)
  where fixture_version_id is not null and status <> 'archived';
create index tournament_groups_context_order_idx
  on public.tournament_groups
  (participant_set_id, fixture_version_id, status, sort_order, code);

create table public.tournament_group_members (
  group_id uuid not null,
  participant_id uuid not null,
  position_seed integer,
  created_at timestamptz not null default now(),
  primary key (group_id, participant_id),
  constraint tournament_group_members_position_check
    check (position_seed is null or position_seed > 0)
);

create index tournament_group_members_group_order_idx
  on public.tournament_group_members (group_id, position_seed nulls last, created_at);

create table public.tournament_rounds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  fixture_version_id uuid not null,
  phase_id uuid not null,
  group_id uuid,
  round_number integer not null,
  name text not null,
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  constraint tournament_rounds_phase_fk
    foreign key (organization_id, tournament_id, category_id, fixture_version_id, phase_id)
    references public.tournament_phases
      (organization_id, tournament_id, category_id, fixture_version_id, id) on delete restrict,
  constraint tournament_rounds_group_fk
    foreign key (group_id) references public.tournament_groups(id) on delete restrict,
  constraint tournament_rounds_number_check check (round_number > 0),
  constraint tournament_rounds_name_check
    check (name = btrim(name) and char_length(name) between 1 and 100),
  constraint tournament_rounds_status_check
    check (status in ('draft', 'scheduled', 'locked')),
  constraint tournament_rounds_dates_check
    check (starts_at is null or ends_at is null or ends_at >= starts_at),
  constraint tournament_rounds_scope_unique
    unique (organization_id, tournament_id, category_id, fixture_version_id, id),
  constraint tournament_rounds_phase_number_unique
    unique nulls not distinct (phase_id, group_id, round_number)
);

create index tournament_rounds_fixture_order_idx
  on public.tournament_rounds
  (fixture_version_id, sort_order, phase_id, group_id, round_number);

create table public.tournament_venues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.tournament_organizations(id) on delete restrict,
  name text not null,
  address text not null,
  place_id text,
  latitude double precision,
  longitude double precision,
  locality text,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tournament_venues_name_check
    check (name = btrim(name) and char_length(name) between 2 and 120),
  constraint tournament_venues_address_check
    check (address = btrim(address) and char_length(address) between 3 and 300),
  constraint tournament_venues_place_id_check
    check (place_id is null or char_length(place_id) between 3 and 300),
  constraint tournament_venues_coordinates_check check (
    (latitude is null and longitude is null)
    or (
      latitude between -90 and 90
      and longitude between -180 and 180
      and not (latitude = 0 and longitude = 0)
    )
  ),
  constraint tournament_venues_timezone_check
    check (timezone = btrim(timezone) and char_length(timezone) between 3 and 80),
  constraint tournament_venues_status_check check (status in ('active', 'archived')),
  constraint tournament_venues_notes_check
    check (notes is null or char_length(notes) <= 1000),
  constraint tournament_venues_archive_check check (
    (status = 'archived' and archived_at is not null)
    or (status = 'active' and archived_at is null)
  ),
  constraint tournament_venues_scope_unique unique (organization_id, id)
);

create index tournament_venues_org_status_idx
  on public.tournament_venues (organization_id, status, name);

create table public.tournament_courts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  venue_id uuid not null,
  name text not null,
  sport_modality text not null
    references public.tournament_sport_modalities(code) on delete restrict,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tournament_courts_venue_fk
    foreign key (organization_id, venue_id)
    references public.tournament_venues(organization_id, id) on delete restrict,
  constraint tournament_courts_name_check
    check (name = btrim(name) and char_length(name) between 1 and 100),
  constraint tournament_courts_status_check check (status in ('active', 'archived')),
  constraint tournament_courts_notes_check
    check (notes is null or char_length(notes) <= 1000),
  constraint tournament_courts_archive_check check (
    (status = 'archived' and archived_at is not null)
    or (status = 'active' and archived_at is null)
  ),
  constraint tournament_courts_scope_unique unique (organization_id, id),
  constraint tournament_courts_venue_name_unique unique (venue_id, name)
);

create index tournament_courts_venue_status_idx
  on public.tournament_courts (venue_id, status, name);

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  participant_set_id uuid not null,
  fixture_version_id uuid not null,
  phase_id uuid not null,
  group_id uuid,
  round_id uuid not null,
  match_number integer not null,
  leg_number smallint not null default 1,
  tie_key text,
  home_participant_id uuid,
  away_participant_id uuid,
  status text not null default 'unscheduled',
  scheduled_at timestamptz,
  venue_id uuid,
  court_id uuid,
  duration_minutes integer,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  postponed_at timestamptz,
  cancelled_at timestamptz,
  constraint tournament_matches_fixture_fk
    foreign key (organization_id, tournament_id, category_id, fixture_version_id)
    references public.tournament_fixture_versions
      (organization_id, tournament_id, category_id, id) on delete restrict,
  constraint tournament_matches_tournament_fk
    foreign key (organization_id, tournament_id, season_id)
    references public.tournaments
      (organization_id, id, season_id) on delete restrict,
  constraint tournament_matches_participant_set_fk
    foreign key (organization_id, tournament_id, category_id, participant_set_id)
    references public.tournament_participant_sets
      (organization_id, tournament_id, category_id, id) on delete restrict,
  constraint tournament_matches_round_fk
    foreign key (organization_id, tournament_id, category_id, fixture_version_id, round_id)
    references public.tournament_rounds
      (organization_id, tournament_id, category_id, fixture_version_id, id) on delete restrict,
  constraint tournament_matches_phase_fk
    foreign key (organization_id, tournament_id, category_id, fixture_version_id, phase_id)
    references public.tournament_phases
      (organization_id, tournament_id, category_id, fixture_version_id, id) on delete restrict,
  constraint tournament_matches_group_fk
    foreign key (group_id) references public.tournament_groups(id) on delete restrict,
  constraint tournament_matches_home_participant_fk
    foreign key (organization_id, tournament_id, category_id, participant_set_id, home_participant_id)
    references public.tournament_competition_participants
      (organization_id, tournament_id, category_id, participant_set_id, id) on delete restrict,
  constraint tournament_matches_away_participant_fk
    foreign key (organization_id, tournament_id, category_id, participant_set_id, away_participant_id)
    references public.tournament_competition_participants
      (organization_id, tournament_id, category_id, participant_set_id, id) on delete restrict,
  constraint tournament_matches_venue_fk
    foreign key (organization_id, venue_id)
    references public.tournament_venues(organization_id, id) on delete restrict,
  constraint tournament_matches_court_fk
    foreign key (organization_id, court_id)
    references public.tournament_courts(organization_id, id) on delete restrict,
  constraint tournament_matches_number_check check (match_number > 0),
  constraint tournament_matches_leg_check check (leg_number in (1, 2)),
  constraint tournament_matches_status_check check (status in (
    'draft', 'unscheduled', 'scheduled', 'postponed', 'cancelled', 'ready',
    'in_progress', 'completed', 'awarded', 'suspended'
  )),
  constraint tournament_matches_participants_check
    check (home_participant_id is null or away_participant_id is null
      or home_participant_id <> away_participant_id),
  constraint tournament_matches_duration_check
    check (duration_minutes is null or duration_minutes between 15 and 240),
  constraint tournament_matches_schedule_fields_check check (
    (scheduled_at is null and venue_id is null and court_id is null)
    or (scheduled_at is not null and venue_id is not null and court_id is not null
      and duration_minutes is not null)
  ),
  constraint tournament_matches_lifecycle_check check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status <> 'cancelled' and cancelled_at is null)
  ),
  constraint tournament_matches_scope_unique
    unique (organization_id, tournament_id, category_id, fixture_version_id, id),
  constraint tournament_matches_number_unique
    unique (fixture_version_id, match_number)
);

create index tournament_matches_fixture_round_idx
  on public.tournament_matches (fixture_version_id, round_id, match_number);
create index tournament_matches_schedule_idx
  on public.tournament_matches (organization_id, scheduled_at, court_id)
  where scheduled_at is not null and status not in ('cancelled', 'completed');
create index tournament_matches_home_schedule_idx
  on public.tournament_matches (home_participant_id, scheduled_at)
  where scheduled_at is not null and status not in ('cancelled', 'completed');
create index tournament_matches_away_schedule_idx
  on public.tournament_matches (away_participant_id, scheduled_at)
  where scheduled_at is not null and status not in ('cancelled', 'completed');

create table public.tournament_match_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  fixture_version_id uuid not null,
  match_id uuid not null,
  side text not null,
  source_type text not null,
  participant_id uuid,
  source_match_id uuid,
  group_id uuid,
  position_number integer,
  seed_number integer,
  rank_number integer,
  created_at timestamptz not null default now(),
  constraint tournament_match_sources_match_fk
    foreign key (organization_id, tournament_id, category_id, fixture_version_id, match_id)
    references public.tournament_matches
      (organization_id, tournament_id, category_id, fixture_version_id, id) on delete restrict,
  constraint tournament_match_sources_source_match_fk
    foreign key (organization_id, tournament_id, category_id, fixture_version_id, source_match_id)
    references public.tournament_matches
      (organization_id, tournament_id, category_id, fixture_version_id, id) on delete restrict,
  constraint tournament_match_sources_participant_fk
    foreign key (participant_id)
    references public.tournament_competition_participants(id) on delete restrict,
  constraint tournament_match_sources_group_fk
    foreign key (group_id) references public.tournament_groups(id) on delete restrict,
  constraint tournament_match_sources_side_check check (side in ('home', 'away')),
  constraint tournament_match_sources_type_check check (source_type in (
    'participant', 'winner_of_match', 'loser_of_match', 'group_position',
    'best_ranked', 'seed', 'bye'
  )),
  constraint tournament_match_sources_shape_check check (
    (source_type = 'participant' and participant_id is not null
      and source_match_id is null and group_id is null and position_number is null
      and seed_number is null and rank_number is null)
    or (source_type in ('winner_of_match', 'loser_of_match') and source_match_id is not null
      and participant_id is null and group_id is null and position_number is null
      and seed_number is null and rank_number is null)
    or (source_type = 'group_position' and group_id is not null and position_number > 0
      and participant_id is null and source_match_id is null
      and seed_number is null and rank_number is null)
    or (source_type = 'best_ranked' and rank_number > 0
      and participant_id is null and source_match_id is null and group_id is null
      and position_number is null and seed_number is null)
    or (source_type = 'seed' and seed_number > 0
      and participant_id is null and source_match_id is null and group_id is null
      and position_number is null and rank_number is null)
    or (source_type = 'bye' and participant_id is null and source_match_id is null
      and group_id is null and position_number is null and seed_number is null
      and rank_number is null)
  ),
  constraint tournament_match_sources_side_unique unique (match_id, side)
);

create index tournament_match_sources_fixture_idx
  on public.tournament_match_sources (fixture_version_id, match_id, side);

create table public.tournament_schedule_windows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid,
  venue_id uuid,
  court_id uuid,
  day_of_week smallint,
  specific_date date,
  starts_at time not null,
  ends_at time not null,
  slot_duration_minutes integer not null,
  buffer_minutes integer not null default 0,
  window_type text not null default 'availability',
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tournament_schedule_windows_tournament_fk
    foreign key (organization_id, tournament_id)
    references public.tournaments(organization_id, id) on delete restrict,
  constraint tournament_schedule_windows_category_fk
    foreign key (organization_id, tournament_id, category_id)
    references public.tournament_categories(organization_id, tournament_id, id) on delete restrict,
  constraint tournament_schedule_windows_venue_fk
    foreign key (organization_id, venue_id)
    references public.tournament_venues(organization_id, id) on delete restrict,
  constraint tournament_schedule_windows_court_fk
    foreign key (organization_id, court_id)
    references public.tournament_courts(organization_id, id) on delete restrict,
  constraint tournament_schedule_windows_date_shape_check
    check ((day_of_week is null) <> (specific_date is null)),
  constraint tournament_schedule_windows_day_check
    check (day_of_week is null or day_of_week between 1 and 7),
  constraint tournament_schedule_windows_times_check check (ends_at > starts_at),
  constraint tournament_schedule_windows_duration_check
    check (slot_duration_minutes between 15 and 240 and buffer_minutes between 0 and 120),
  constraint tournament_schedule_windows_type_check
    check (window_type in ('availability', 'block', 'closure')),
  constraint tournament_schedule_windows_status_check
    check (status in ('active', 'archived')),
  constraint tournament_schedule_windows_archive_check check (
    (status = 'archived' and archived_at is not null)
    or (status = 'active' and archived_at is null)
  ),
  constraint tournament_schedule_windows_court_requires_venue
    check (court_id is null or venue_id is not null),
  constraint tournament_schedule_windows_scope_unique
    unique (organization_id, tournament_id, id)
);

create index tournament_schedule_windows_context_idx
  on public.tournament_schedule_windows
  (tournament_id, category_id, status, specific_date, day_of_week, starts_at);

create table public.tournament_match_reschedules (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  fixture_version_id uuid not null,
  match_id uuid not null,
  previous_scheduled_at timestamptz,
  previous_venue_id uuid,
  previous_court_id uuid,
  new_scheduled_at timestamptz,
  new_venue_id uuid,
  new_court_id uuid,
  reason text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  previous_status text not null,
  new_status text not null,
  created_at timestamptz not null default now(),
  constraint tournament_match_reschedules_match_fk
    foreign key (
      organization_id,
      tournament_id,
      category_id,
      fixture_version_id,
      match_id
    )
    references public.tournament_matches
      (organization_id, tournament_id, category_id, fixture_version_id, id) on delete restrict,
  constraint tournament_match_reschedules_previous_venue_fk
    foreign key (organization_id, previous_venue_id)
    references public.tournament_venues(organization_id, id) on delete restrict,
  constraint tournament_match_reschedules_previous_court_fk
    foreign key (organization_id, previous_court_id)
    references public.tournament_courts(organization_id, id) on delete restrict,
  constraint tournament_match_reschedules_new_venue_fk
    foreign key (organization_id, new_venue_id)
    references public.tournament_venues(organization_id, id) on delete restrict,
  constraint tournament_match_reschedules_new_court_fk
    foreign key (organization_id, new_court_id)
    references public.tournament_courts(organization_id, id) on delete restrict,
  constraint tournament_match_reschedules_reason_check
    check (reason = btrim(reason) and char_length(reason) between 3 and 500),
  constraint tournament_match_reschedules_status_check check (
    previous_status in ('unscheduled', 'scheduled', 'postponed', 'ready')
    and new_status in ('unscheduled', 'scheduled', 'postponed', 'cancelled', 'ready')
  )
);

create index tournament_match_reschedules_match_idx
  on public.tournament_match_reschedules (match_id, created_at desc);

alter table public.tournament_draw_pot_members
  add constraint tournament_draw_pot_members_pot_fk
  foreign key (pot_id) references public.tournament_draw_pots(id) on delete restrict,
  add constraint tournament_draw_pot_members_participant_fk
  foreign key (participant_id)
  references public.tournament_competition_participants(id) on delete restrict;

alter table public.tournament_group_members
  add constraint tournament_group_members_group_fk
  foreign key (group_id) references public.tournament_groups(id) on delete restrict,
  add constraint tournament_group_members_participant_fk
  foreign key (participant_id)
  references public.tournament_competition_participants(id) on delete restrict;

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
      'groups.read', 'groups.manage',
      'rounds.read', 'rounds.manage', 'rounds.lock',
      'matches.read', 'matches.create', 'matches.schedule', 'matches.reschedule',
      'matches.postpone', 'matches.cancel',
      'venues.read', 'venues.create', 'venues.update', 'venues.archive',
      'courts.read', 'courts.create', 'courts.update', 'courts.archive',
      'schedule_windows.read', 'schedule_windows.manage',
      'schedule_conflicts.override'
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
      'groups.read', 'groups.manage',
      'rounds.read', 'rounds.manage', 'rounds.lock',
      'matches.read', 'matches.create', 'matches.schedule', 'matches.reschedule',
      'matches.postpone', 'matches.cancel',
      'venues.read', 'venues.create', 'venues.update', 'venues.archive',
      'courts.read', 'courts.create', 'courts.update', 'courts.archive',
      'schedule_windows.read', 'schedule_windows.manage',
      'schedule_conflicts.override'
    ]::text[]
    when 'collaborator' then array[
      'organization.read', 'members.read', 'workspace.access',
      'seasons.read', 'tournaments.read', 'categories.read',
      'competition_rules.read', 'team_entries.read', 'team_managers.read',
      'rosters.read', 'roster_players.read',
      'participants.read', 'draw.read', 'fixture.read', 'groups.read',
      'rounds.read', 'matches.read', 'venues.read', 'courts.read',
      'schedule_windows.read'
    ]::text[]
    else array[]::text[]
  end;
$$;

create or replace function public.can_read_tournament_fixture_scope(
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
      and organization.status = 'active'
      and tournament.id = p_tournament_id
      and tournament.status <> 'archived'
      and (
        public.has_tournament_organization_capability(
          p_organization_id,
          'fixture.read'
        )
        or exists (
          select 1
          from public.tournament_competition_participants participant
          join public.tournament_team_managers manager
            on manager.team_entry_id = participant.team_entry_id
            and manager.organization_id = participant.organization_id
          where participant.organization_id = p_organization_id
            and participant.tournament_id = p_tournament_id
            and participant.status = 'active'
            and manager.user_id = auth.uid()
            and manager.status = 'active'
        )
      )
  );
$$;

create or replace function public.validate_tournament_fixture_member_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_left_set uuid;
  v_right_set uuid;
begin
  if tg_table_name = 'tournament_draw_pot_members' then
    select pot.participant_set_id, participant.participant_set_id
    into v_left_set, v_right_set
    from public.tournament_draw_pots pot
    cross join public.tournament_competition_participants participant
    where pot.id = new.pot_id and participant.id = new.participant_id;
  else
    select group_row.participant_set_id, participant.participant_set_id
    into v_left_set, v_right_set
    from public.tournament_groups group_row
    cross join public.tournament_competition_participants participant
    where group_row.id = new.group_id and participant.id = new.participant_id;
  end if;
  if v_left_set is null or v_left_set is distinct from v_right_set then
    raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger tournament_draw_pot_members_scope_guard
before insert or update on public.tournament_draw_pot_members
for each row execute function public.validate_tournament_fixture_member_scope();

create trigger tournament_group_members_scope_guard
before insert or update on public.tournament_group_members
for each row execute function public.validate_tournament_fixture_member_scope();

create or replace function public.validate_tournament_match_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version public.tournament_fixture_versions%rowtype;
  v_round public.tournament_rounds%rowtype;
  v_group public.tournament_groups%rowtype;
  v_court public.tournament_courts%rowtype;
begin
  select version.* into v_version
  from public.tournament_fixture_versions version
  where version.id = new.fixture_version_id;
  select round_row.* into v_round
  from public.tournament_rounds round_row
  where round_row.id = new.round_id;
  if v_version.id is null or v_round.id is null
    or v_version.organization_id <> new.organization_id
    or v_version.season_id <> new.season_id
    or v_version.tournament_id <> new.tournament_id
    or v_version.category_id <> new.category_id
    or v_version.participant_set_id <> new.participant_set_id
    or v_round.fixture_version_id <> new.fixture_version_id
    or v_round.phase_id <> new.phase_id
  then
    raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
  end if;
  if new.group_id is not null then
    select group_row.* into v_group
    from public.tournament_groups group_row
    where group_row.id = new.group_id;
    if v_group.id is null
      or v_group.organization_id <> new.organization_id
      or v_group.tournament_id <> new.tournament_id
      or v_group.category_id <> new.category_id
      or v_group.fixture_version_id <> new.fixture_version_id
      or v_group.phase_id <> new.phase_id
      or v_round.group_id is distinct from new.group_id
    then
      raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
    end if;
  elsif v_round.group_id is not null then
    raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
  end if;
  if new.court_id is not null then
    select court.* into v_court
    from public.tournament_courts court
    where court.id = new.court_id;
    if v_court.id is null
      or v_court.organization_id <> new.organization_id
      or v_court.venue_id <> new.venue_id
    then
      raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
    end if;
  end if;
  return new;
end;
$$;

create trigger tournament_matches_scope_guard
before insert or update on public.tournament_matches
for each row execute function public.validate_tournament_match_scope();

create or replace function public.validate_tournament_match_source_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_source_match public.tournament_matches%rowtype;
  v_participant public.tournament_competition_participants%rowtype;
  v_group public.tournament_groups%rowtype;
begin
  select match_row.* into v_match
  from public.tournament_matches match_row
  where match_row.id = new.match_id;
  if v_match.id is null
    or v_match.organization_id <> new.organization_id
    or v_match.tournament_id <> new.tournament_id
    or v_match.category_id <> new.category_id
    or v_match.fixture_version_id <> new.fixture_version_id
  then
    raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
  end if;
  if new.participant_id is not null then
    select participant.* into v_participant
    from public.tournament_competition_participants participant
    where participant.id = new.participant_id;
    if v_participant.id is null
      or v_participant.organization_id <> new.organization_id
      or v_participant.tournament_id <> new.tournament_id
      or v_participant.category_id <> new.category_id
      or v_participant.participant_set_id <> v_match.participant_set_id
    then
      raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
    end if;
  end if;
  if new.group_id is not null then
    select group_row.* into v_group
    from public.tournament_groups group_row
    where group_row.id = new.group_id;
    if v_group.id is null
      or v_group.organization_id <> new.organization_id
      or v_group.tournament_id <> new.tournament_id
      or v_group.category_id <> new.category_id
      or v_group.fixture_version_id <> new.fixture_version_id
    then
      raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
    end if;
  end if;
  if new.source_match_id is not null then
    select source_match.* into v_source_match
    from public.tournament_matches source_match
    where source_match.id = new.source_match_id;
    if v_source_match.id is null
      or v_source_match.fixture_version_id <> new.fixture_version_id
      or v_source_match.match_number >= v_match.match_number
    then
      raise exception using errcode = '23514', message = 'TORNEOS_CYCLIC_MATCH_SOURCE';
    end if;
  end if;
  return new;
end;
$$;

create trigger tournament_match_sources_scope_guard
before insert or update on public.tournament_match_sources
for each row execute function public.validate_tournament_match_source_scope();

create trigger tournament_draw_pots_touch_updated_at
before update on public.tournament_draw_pots
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_groups_touch_updated_at
before update on public.tournament_groups
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_phases_touch_updated_at
before update on public.tournament_phases
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_rounds_touch_updated_at
before update on public.tournament_rounds
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_matches_touch_updated_at
before update on public.tournament_matches
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_venues_touch_updated_at
before update on public.tournament_venues
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_courts_touch_updated_at
before update on public.tournament_courts
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_schedule_windows_touch_updated_at
before update on public.tournament_schedule_windows
for each row execute function public.touch_tournament_workspace_updated_at();

create or replace function public.assert_tournament_fixture_scope(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_capability text,
  p_allowed_statuses text[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id,
    p_capability
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  perform 1
  from public.tournament_organizations organization
  join public.tournaments tournament
    on tournament.organization_id = organization.id
  join public.tournament_seasons season
    on season.organization_id = organization.id
    and season.id = tournament.season_id
  join public.tournament_categories category
    on category.organization_id = organization.id
    and category.tournament_id = tournament.id
  where organization.id = p_organization_id
    and organization.status = 'active'
    and tournament.id = p_tournament_id
    and tournament.status = any(p_allowed_statuses)
    and season.status in ('draft', 'active')
    and category.id = p_category_id
    and category.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
end;
$$;

create or replace function public.freeze_tournament_participants(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.tournament_participant_sets%rowtype;
  v_tournament public.tournaments%rowtype;
  v_count integer;
  v_fingerprint text;
  v_version integer;
begin
  perform public.assert_tournament_fixture_scope(
    p_organization_id, p_tournament_id, p_category_id,
    'participants.freeze', array['registration']::text[]
  );
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:participants:' || p_tournament_id::text || ':' || p_category_id::text,
    0
  ));
  select participant_set.* into v_set
  from public.tournament_participant_sets participant_set
  where participant_set.organization_id = p_organization_id
    and participant_set.frozen_by = auth.uid()
    and participant_set.idempotency_key = p_idempotency_key;
  if v_set.id is not null then
    return jsonb_build_object(
      'participantSetId', v_set.id,
      'versionNumber', v_set.version_number,
      'status', v_set.status,
      'participantFingerprint', v_set.participant_fingerprint,
      'participantCount', (
        select count(*) from public.tournament_competition_participants participant
        where participant.participant_set_id = v_set.id
      )
    );
  end if;
  if exists (
    select 1 from public.tournament_participant_sets participant_set
    where participant_set.tournament_id = p_tournament_id
      and participant_set.category_id = p_category_id
      and participant_set.status = 'frozen'
  ) then
    raise exception using errcode = '23505', message = 'TORNEOS_PARTICIPANTS_ALREADY_FROZEN';
  end if;
  if exists (
    select 1
    from public.tournament_team_entries entry
    where entry.organization_id = p_organization_id
      and entry.tournament_id = p_tournament_id
      and entry.category_id = p_category_id
      and entry.status in ('submitted', 'changes_requested')
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_PENDING_REGISTRATIONS';
  end if;
  select count(*), encode(public.digest(string_agg(entry.id::text, '|' order by entry.id), 'sha256'), 'hex')
  into v_count, v_fingerprint
  from public.tournament_team_entries entry
  where entry.organization_id = p_organization_id
    and entry.tournament_id = p_tournament_id
    and entry.category_id = p_category_id
    and entry.status = 'approved'
    and exists (
      select 1 from public.tournament_rosters roster
      where roster.team_entry_id = entry.id
        and roster.status in ('approved', 'locked')
    );
  if v_count < 2 then
    raise exception using errcode = '23514', message = 'TORNEOS_NOT_ENOUGH_PARTICIPANTS';
  end if;
  select tournament.* into v_tournament
  from public.tournaments tournament
  where tournament.id = p_tournament_id
    and tournament.organization_id = p_organization_id
  for update;
  select coalesce(max(participant_set.version_number), 0) + 1
  into v_version
  from public.tournament_participant_sets participant_set
  where participant_set.tournament_id = p_tournament_id
    and participant_set.category_id = p_category_id;
  update public.tournament_participant_sets
  set status = 'superseded', invalidated_at = coalesce(invalidated_at, now())
  where tournament_id = p_tournament_id
    and category_id = p_category_id
    and status = 'reopened';
  insert into public.tournament_participant_sets (
    organization_id, season_id, tournament_id, category_id, version_number,
    status, participant_fingerprint, frozen_by, idempotency_key
  ) values (
    p_organization_id, v_tournament.season_id, p_tournament_id, p_category_id,
    v_version, 'frozen', v_fingerprint, auth.uid(), p_idempotency_key
  ) returning * into v_set;
  insert into public.tournament_competition_participants (
    organization_id, season_id, tournament_id, category_id, participant_set_id,
    team_entry_id, status, snapshot_name, snapshot_short_name,
    snapshot_shield_path, snapshot_primary_color, snapshot_secondary_color, frozen_at
  )
  select
    entry.organization_id, entry.season_id, entry.tournament_id, entry.category_id,
    v_set.id, entry.id, 'active', entry.name, entry.short_name, entry.shield_path,
    entry.primary_color, entry.secondary_color, v_set.frozen_at
  from public.tournament_team_entries entry
  where entry.organization_id = p_organization_id
    and entry.tournament_id = p_tournament_id
    and entry.category_id = p_category_id
    and entry.status = 'approved'
    and exists (
      select 1 from public.tournament_rosters roster
      where roster.team_entry_id = entry.id
        and roster.status in ('approved', 'locked')
    )
  order by entry.id;
  perform public.append_tournament_audit(
    p_organization_id, 'participants.frozen', 'participant_set', v_set.id,
    null, p_tournament_id,
    jsonb_build_object(
      'categoryId', p_category_id,
      'versionNumber', v_version,
      'participantCount', v_count,
      'participantFingerprint', v_fingerprint
    )
  );
  return jsonb_build_object(
    'participantSetId', v_set.id,
    'versionNumber', v_version,
    'status', 'frozen',
    'participantFingerprint', v_fingerprint,
    'participantCount', v_count,
    'frozenAt', v_set.frozen_at
  );
end;
$$;

create or replace function public.reopen_tournament_participants(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.tournament_participant_sets%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.assert_tournament_fixture_scope(
    p_organization_id, p_tournament_id, p_category_id,
    'participants.reopen', array['registration', 'scheduled']::text[]
  );
  if char_length(v_reason) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'TORNEOS_REASON_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:participants:' || p_tournament_id::text || ':' || p_category_id::text,
    0
  ));
  select participant_set.* into v_set
  from public.tournament_participant_sets participant_set
  where participant_set.organization_id = p_organization_id
    and participant_set.tournament_id = p_tournament_id
    and participant_set.category_id = p_category_id
    and participant_set.status = 'frozen'
  for update;
  if v_set.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  update public.tournament_participant_sets
  set status = 'reopened',
      reopened_by = auth.uid(),
      reopened_at = now(),
      reopen_reason = v_reason,
      invalidated_at = now()
  where id = v_set.id;
  update public.tournament_fixture_versions
  set status = 'archived', archived_at = now(), invalidated_at = now()
  where participant_set_id = v_set.id and status = 'draft';
  update public.tournament_fixture_versions
  set invalidated_at = now()
  where participant_set_id = v_set.id and status in ('published', 'superseded');
  perform public.append_tournament_audit(
    p_organization_id, 'participants.reopened', 'participant_set', v_set.id,
    null, p_tournament_id,
    jsonb_build_object(
      'categoryId', p_category_id,
      'versionNumber', v_set.version_number,
      'reason', v_reason,
      'fixtureRegenerationRequired', true
    )
  );
  return jsonb_build_object(
    'participantSetId', v_set.id,
    'status', 'reopened',
    'fixtureRegenerationRequired', true
  );
end;
$$;

create or replace function public.save_tournament_draw_pots(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_pots jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.tournament_participant_sets%rowtype;
  v_pot jsonb;
  v_member jsonb;
  v_pot_id uuid;
  v_pot_count integer := 0;
  v_member_count integer := 0;
begin
  perform public.assert_tournament_fixture_scope(
    p_organization_id, p_tournament_id, p_category_id,
    'draw.manage', array['registration', 'scheduled']::text[]
  );
  if jsonb_typeof(p_pots) <> 'array' or jsonb_array_length(p_pots) > 32 then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_DRAW_POTS';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:draw:' || p_tournament_id::text || ':' || p_category_id::text, 0
  ));
  select participant_set.* into v_set
  from public.tournament_participant_sets participant_set
  where participant_set.organization_id = p_organization_id
    and participant_set.tournament_id = p_tournament_id
    and participant_set.category_id = p_category_id
    and participant_set.status = 'frozen'
  for update;
  if v_set.id is null or exists (
    select 1 from public.tournament_groups group_row
    where group_row.participant_set_id = v_set.id and group_row.status = 'published'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_DRAW_NOT_EDITABLE';
  end if;
  delete from public.tournament_draw_pot_members member
  using public.tournament_draw_pots pot
  where member.pot_id = pot.id and pot.participant_set_id = v_set.id;
  delete from public.tournament_draw_pots pot where pot.participant_set_id = v_set.id;
  update public.tournament_competition_participants
  set pot_number = null, seed_number = null
  where participant_set_id = v_set.id;
  for v_pot in select value from jsonb_array_elements(p_pots)
  loop
    if jsonb_typeof(v_pot) <> 'object'
      or coalesce((v_pot->>'number')::integer, 0) <= 0
      or char_length(btrim(coalesce(v_pot->>'name', ''))) not between 1 and 80
      or jsonb_typeof(coalesce(v_pot->'members', '[]'::jsonb)) <> 'array'
    then
      raise exception using errcode = '22023', message = 'TORNEOS_INVALID_DRAW_POTS';
    end if;
    insert into public.tournament_draw_pots (
      organization_id, tournament_id, category_id, participant_set_id,
      name, number, sort_order
    ) values (
      p_organization_id, p_tournament_id, p_category_id, v_set.id,
      btrim(v_pot->>'name'), (v_pot->>'number')::integer,
      coalesce((v_pot->>'sortOrder')::integer, v_pot_count)
    ) returning id into v_pot_id;
    v_pot_count := v_pot_count + 1;
    for v_member in
      select value from jsonb_array_elements(coalesce(v_pot->'members', '[]'::jsonb))
    loop
      if not exists (
        select 1 from public.tournament_competition_participants participant
        where participant.id = (v_member->>'participantId')::uuid
          and participant.participant_set_id = v_set.id
          and participant.status = 'active'
      ) then
        raise exception using errcode = '23514', message = 'TORNEOS_INVALID_DRAW_PARTICIPANT';
      end if;
      insert into public.tournament_draw_pot_members (
        pot_id, participant_id, seed_number
      ) values (
        v_pot_id,
        (v_member->>'participantId')::uuid,
        nullif(v_member->>'seedNumber', '')::integer
      );
      update public.tournament_competition_participants
      set pot_number = (v_pot->>'number')::integer,
          seed_number = nullif(v_member->>'seedNumber', '')::integer
      where id = (v_member->>'participantId')::uuid;
      v_member_count := v_member_count + 1;
    end loop;
  end loop;
  perform public.append_tournament_audit(
    p_organization_id, 'draw.pots_saved', 'participant_set', v_set.id,
    null, p_tournament_id,
    jsonb_build_object(
      'categoryId', p_category_id,
      'potCount', v_pot_count,
      'memberCount', v_member_count
    )
  );
  return jsonb_build_object(
    'participantSetId', v_set.id,
    'potCount', v_pot_count,
    'memberCount', v_member_count
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'TORNEOS_DUPLICATE_DRAW_ASSIGNMENT';
end;
$$;

create or replace function public.execute_tournament_group_draw(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_group_count integer,
  p_seed text,
  p_publish boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.tournament_participant_sets%rowtype;
  v_participant record;
  v_group record;
  v_group_id uuid;
  v_count integer;
  v_min_size integer;
  v_max_size integer;
  v_seed text := btrim(coalesce(p_seed, ''));
begin
  perform public.assert_tournament_fixture_scope(
    p_organization_id, p_tournament_id, p_category_id,
    case when p_publish then 'draw.publish' else 'draw.execute' end,
    array['registration', 'scheduled']::text[]
  );
  if p_group_count not between 2 and 32 or char_length(v_seed) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_DRAW';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:draw:' || p_tournament_id::text || ':' || p_category_id::text, 0
  ));
  select participant_set.* into v_set
  from public.tournament_participant_sets participant_set
  where participant_set.organization_id = p_organization_id
    and participant_set.tournament_id = p_tournament_id
    and participant_set.category_id = p_category_id
    and participant_set.status = 'frozen'
  for update;
  select count(*) into v_count
  from public.tournament_competition_participants participant
  where participant.participant_set_id = v_set.id and participant.status = 'active';
  if v_set.id is null or v_count < p_group_count then
    raise exception using errcode = '23514', message = 'TORNEOS_INVALID_GROUP_COUNT';
  end if;
  if exists (
    select 1 from public.tournament_groups group_row
    where group_row.participant_set_id = v_set.id
      and group_row.fixture_version_id is null
      and group_row.status = 'published'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_DRAW_NOT_EDITABLE';
  end if;
  delete from public.tournament_group_members member
  using public.tournament_groups group_row
  where member.group_id = group_row.id
    and group_row.participant_set_id = v_set.id
    and group_row.fixture_version_id is null
    and group_row.status = 'draft';
  delete from public.tournament_groups group_row
  where group_row.participant_set_id = v_set.id
    and group_row.fixture_version_id is null
    and group_row.status = 'draft';
  for v_count in 1..p_group_count loop
    insert into public.tournament_groups (
      organization_id, tournament_id, category_id, participant_set_id,
      name, code, sort_order, status, draw_seed
    ) values (
      p_organization_id, p_tournament_id, p_category_id, v_set.id,
      'Grupo ' || v_count, 'G' || lpad(v_count::text, 2, '0'),
      v_count - 1, case when p_publish then 'published' else 'draft' end, v_seed
    );
  end loop;
  for v_participant in
    select participant.id, coalesce(participant.pot_number, 2147483647) as pot_number
    from public.tournament_competition_participants participant
    where participant.participant_set_id = v_set.id and participant.status = 'active'
    order by coalesce(participant.pot_number, 2147483647),
      encode(public.digest(v_seed || ':' || participant.id::text, 'sha256'), 'hex'),
      participant.id
  loop
    select candidate.id into v_group_id
    from public.tournament_groups candidate
    where candidate.participant_set_id = v_set.id
      and candidate.fixture_version_id is null
      and candidate.status = case when p_publish then 'published' else 'draft' end
    order by
      exists (
        select 1
        from public.tournament_group_members existing_member
        join public.tournament_competition_participants existing_participant
          on existing_participant.id = existing_member.participant_id
        where existing_member.group_id = candidate.id
          and coalesce(existing_participant.pot_number, 2147483647) = v_participant.pot_number
      ),
      (select count(*) from public.tournament_group_members size_member
       where size_member.group_id = candidate.id),
      encode(public.digest(v_seed || ':group:' || candidate.sort_order::text, 'sha256'), 'hex')
    limit 1;
    insert into public.tournament_group_members (group_id, participant_id)
    values (v_group_id, v_participant.id);
  end loop;
  select min(size), max(size) into v_min_size, v_max_size
  from (
    select count(member.participant_id)::integer as size
    from public.tournament_groups group_row
    left join public.tournament_group_members member on member.group_id = group_row.id
    where group_row.participant_set_id = v_set.id
      and group_row.fixture_version_id is null
      and group_row.status = case when p_publish then 'published' else 'draft' end
    group by group_row.id
  ) sizes;
  if v_max_size - v_min_size > 1 then
    raise exception using errcode = '23514', message = 'TORNEOS_GROUP_DRAW_IMPOSSIBLE';
  end if;
  perform public.append_tournament_audit(
    p_organization_id,
    case when p_publish then 'draw.published' else 'draw.executed' end,
    'participant_set', v_set.id, null, p_tournament_id,
    jsonb_build_object(
      'categoryId', p_category_id,
      'groupCount', p_group_count,
      'seed', v_seed,
      'participantFingerprint', v_set.participant_fingerprint
    )
  );
  return jsonb_build_object(
    'participantSetId', v_set.id,
    'status', case when p_publish then 'published' else 'draft' end,
    'groupCount', p_group_count,
    'seed', v_seed,
    'participantFingerprint', v_set.participant_fingerprint
  );
end;
$$;

create or replace function public.insert_tournament_match_source(
  p_match_id uuid,
  p_side text,
  p_source jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
begin
  select match_row.* into v_match
  from public.tournament_matches match_row
  where match_row.id = p_match_id;
  if v_match.id is null or p_side not in ('home', 'away')
    or jsonb_typeof(p_source) <> 'object'
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_MATCH_SOURCE';
  end if;
  insert into public.tournament_match_sources (
    organization_id, tournament_id, category_id, fixture_version_id,
    match_id, side, source_type, participant_id, source_match_id,
    group_id, position_number, seed_number, rank_number
  ) values (
    v_match.organization_id, v_match.tournament_id, v_match.category_id,
    v_match.fixture_version_id, v_match.id, p_side, p_source->>'type',
    nullif(p_source->>'participantId', '')::uuid,
    nullif(p_source->>'matchId', '')::uuid,
    nullif(p_source->>'groupId', '')::uuid,
    nullif(p_source->>'positionNumber', '')::integer,
    nullif(p_source->>'seedNumber', '')::integer,
    nullif(p_source->>'rankNumber', '')::integer
  );
end;
$$;

create or replace function public.build_tournament_round_robin(
  p_fixture_version_id uuid,
  p_phase_id uuid,
  p_group_id uuid,
  p_participants uuid[],
  p_double_round boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_version public.tournament_fixture_versions%rowtype;
  v_rotation uuid[] := p_participants;
  v_original uuid[];
  v_count integer;
  v_round_count integer;
  v_round_index integer;
  v_pair_index integer;
  v_leg integer;
  v_home uuid;
  v_away uuid;
  v_temp uuid;
  v_round_id uuid;
  v_match_id uuid;
  v_match_number integer;
  v_duration integer;
begin
  select version.* into v_version
  from public.tournament_fixture_versions version
  where version.id = p_fixture_version_id and version.status = 'draft';
  v_count := coalesce(array_length(v_rotation, 1), 0);
  if v_version.id is null or v_count < 2 then
    raise exception using errcode = '23514', message = 'TORNEOS_NOT_ENOUGH_PARTICIPANTS';
  end if;
  if mod(v_count, 2) = 1 then
    v_rotation := array_append(v_rotation, null::uuid);
    v_count := v_count + 1;
  end if;
  v_original := v_rotation;
  v_round_count := v_count - 1;
  select modality.suggested_duration_minutes into v_duration
  from public.tournaments tournament
  join public.tournament_sport_modalities modality
    on modality.code = tournament.sport_modality
  where tournament.id = v_version.tournament_id;
  select coalesce(max(match_row.match_number), 0) into v_match_number
  from public.tournament_matches match_row
  where match_row.fixture_version_id = p_fixture_version_id;
  for v_leg in 1..case when p_double_round then 2 else 1 end loop
    v_rotation := v_original;
    for v_round_index in 1..v_round_count loop
      insert into public.tournament_rounds (
        organization_id, tournament_id, category_id, fixture_version_id,
        phase_id, group_id, round_number, name, status, sort_order
      ) values (
        v_version.organization_id, v_version.tournament_id, v_version.category_id,
        v_version.id, p_phase_id, p_group_id,
        (v_leg - 1) * v_round_count + v_round_index,
        'Fecha ' || ((v_leg - 1) * v_round_count + v_round_index),
        'draft', (v_leg - 1) * v_round_count + v_round_index - 1
      ) returning id into v_round_id;
      for v_pair_index in 1..(v_count / 2) loop
        v_home := v_rotation[v_pair_index];
        v_away := v_rotation[v_count - v_pair_index + 1];
        if mod(v_round_index + v_pair_index, 2) = 1 then
          v_temp := v_home;
          v_home := v_away;
          v_away := v_temp;
        end if;
        if v_leg = 2 then
          v_temp := v_home;
          v_home := v_away;
          v_away := v_temp;
        end if;
        if v_home is not null and v_away is not null then
          v_match_number := v_match_number + 1;
          insert into public.tournament_matches (
            organization_id, season_id, tournament_id, category_id,
            participant_set_id, fixture_version_id, phase_id, group_id, round_id,
            match_number, home_participant_id, away_participant_id, status,
            duration_minutes, created_by
          ) values (
            v_version.organization_id, v_version.season_id, v_version.tournament_id,
            v_version.category_id, v_version.participant_set_id, v_version.id,
            p_phase_id, p_group_id, v_round_id, v_match_number, v_home, v_away,
            'unscheduled', v_duration, v_version.created_by
          ) returning id into v_match_id;
          perform public.insert_tournament_match_source(
            v_match_id, 'home',
            jsonb_build_object('type', 'participant', 'participantId', v_home)
          );
          perform public.insert_tournament_match_source(
            v_match_id, 'away',
            jsonb_build_object('type', 'participant', 'participantId', v_away)
          );
        end if;
      end loop;
      v_temp := v_rotation[v_count];
      for v_pair_index in reverse v_count..3 loop
        v_rotation[v_pair_index] := v_rotation[v_pair_index - 1];
      end loop;
      v_rotation[2] := v_temp;
    end loop;
  end loop;
end;
$$;

create or replace function public.build_tournament_knockout(
  p_fixture_version_id uuid,
  p_phase_id uuid,
  p_sources jsonb,
  p_double_leg boolean,
  p_third_place boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_version public.tournament_fixture_versions%rowtype;
  v_source_count integer;
  v_bracket_size integer := 1;
  v_slots jsonb;
  v_round_size integer;
  v_round_number integer := 0;
  v_tie integer;
  v_leg integer;
  v_round_id uuid;
  v_match_id uuid;
  v_match_number integer;
  v_duration integer;
  v_home_source jsonb;
  v_away_source jsonb;
  v_previous_match_ids uuid[] := '{}'::uuid[];
  v_current_match_ids uuid[];
  v_last_match_id uuid;
  v_tie_key text;
  v_index integer;
  v_semifinal_match_ids uuid[];
begin
  select version.* into v_version
  from public.tournament_fixture_versions version
  where version.id = p_fixture_version_id and version.status = 'draft';
  if v_version.id is null or jsonb_typeof(p_sources) <> 'array' then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_KNOCKOUT';
  end if;
  v_source_count := jsonb_array_length(p_sources);
  if v_source_count < 2 or v_source_count > 64 then
    raise exception using errcode = '23514', message = 'TORNEOS_NOT_ENOUGH_PARTICIPANTS';
  end if;
  while v_bracket_size < v_source_count loop
    v_bracket_size := v_bracket_size * 2;
  end loop;
  v_slots := '[]'::jsonb;
  for v_index in 0..v_bracket_size - 1 loop
    v_slots := v_slots || jsonb_build_array(jsonb_build_object('type', 'bye'));
  end loop;
  for v_index in 0..v_source_count - 1 loop
    v_slots := jsonb_set(
      v_slots,
      array[case
        when v_index < (v_bracket_size / 2)
          then (v_index * 2)::text
        else ((v_index - (v_bracket_size / 2)) * 2 + 1)::text
      end],
      p_sources->v_index
    );
  end loop;
  select modality.suggested_duration_minutes into v_duration
  from public.tournaments tournament
  join public.tournament_sport_modalities modality
    on modality.code = tournament.sport_modality
  where tournament.id = v_version.tournament_id;
  select coalesce(max(match_row.match_number), 0) into v_match_number
  from public.tournament_matches match_row
  where match_row.fixture_version_id = p_fixture_version_id;
  v_round_size := v_bracket_size;
  while v_round_size >= 2 loop
    v_round_number := v_round_number + 1;
    insert into public.tournament_rounds (
      organization_id, tournament_id, category_id, fixture_version_id,
      phase_id, round_number, name, status, sort_order
    ) values (
      v_version.organization_id, v_version.tournament_id, v_version.category_id,
      v_version.id, p_phase_id, v_round_number,
      case v_round_size
        when 2 then 'Final'
        when 4 then 'Semifinal'
        when 8 then 'Cuartos de final'
        when 16 then 'Octavos de final'
        when 32 then 'Dieciseisavos de final'
        else 'Ronda de ' || v_round_size
      end,
      'draft', v_round_number - 1
    ) returning id into v_round_id;
    v_current_match_ids := '{}'::uuid[];
    for v_tie in 1..(v_round_size / 2) loop
      if v_round_number = 1 then
        v_home_source := v_slots->((v_tie - 1) * 2);
        v_away_source := v_slots->((v_tie - 1) * 2 + 1);
      else
        v_home_source := jsonb_build_object(
          'type', 'winner_of_match',
          'matchId', v_previous_match_ids[(v_tie - 1) * 2 + 1]
        );
        v_away_source := jsonb_build_object(
          'type', 'winner_of_match',
          'matchId', v_previous_match_ids[(v_tie - 1) * 2 + 2]
        );
      end if;
      v_tie_key := v_version.id::text || ':' || v_round_number || ':' || v_tie;
      for v_leg in 1..case when p_double_leg and v_round_size > 2 then 2 else 1 end loop
        v_match_number := v_match_number + 1;
        insert into public.tournament_matches (
          organization_id, season_id, tournament_id, category_id,
          participant_set_id, fixture_version_id, phase_id, round_id,
          match_number, leg_number, tie_key, home_participant_id,
          away_participant_id, status, duration_minutes, created_by
        ) values (
          v_version.organization_id, v_version.season_id, v_version.tournament_id,
          v_version.category_id, v_version.participant_set_id, v_version.id,
          p_phase_id, v_round_id, v_match_number, v_leg, v_tie_key,
          case when v_leg = 1 and v_home_source->>'type' = 'participant'
            then (v_home_source->>'participantId')::uuid
            when v_leg = 2 and v_away_source->>'type' = 'participant'
            then (v_away_source->>'participantId')::uuid else null end,
          case when v_leg = 1 and v_away_source->>'type' = 'participant'
            then (v_away_source->>'participantId')::uuid
            when v_leg = 2 and v_home_source->>'type' = 'participant'
            then (v_home_source->>'participantId')::uuid else null end,
          'unscheduled', v_duration, v_version.created_by
        ) returning id into v_match_id;
        perform public.insert_tournament_match_source(
          v_match_id, 'home', case when v_leg = 2 then v_away_source else v_home_source end
        );
        perform public.insert_tournament_match_source(
          v_match_id, 'away', case when v_leg = 2 then v_home_source else v_away_source end
        );
        v_last_match_id := v_match_id;
      end loop;
      v_current_match_ids := array_append(v_current_match_ids, v_last_match_id);
    end loop;
    if v_round_size = 4 then v_semifinal_match_ids := v_current_match_ids; end if;
    v_previous_match_ids := v_current_match_ids;
    v_round_size := v_round_size / 2;
  end loop;
  if p_third_place and array_length(v_semifinal_match_ids, 1) = 2 then
    v_round_number := v_round_number + 1;
    insert into public.tournament_rounds (
      organization_id, tournament_id, category_id, fixture_version_id,
      phase_id, round_number, name, status, sort_order
    ) values (
      v_version.organization_id, v_version.tournament_id, v_version.category_id,
      v_version.id, p_phase_id, v_round_number, 'Tercer puesto', 'draft', v_round_number - 1
    ) returning id into v_round_id;
    v_match_number := v_match_number + 1;
    insert into public.tournament_matches (
      organization_id, season_id, tournament_id, category_id,
      participant_set_id, fixture_version_id, phase_id, round_id,
      match_number, status, duration_minutes, created_by
    ) values (
      v_version.organization_id, v_version.season_id, v_version.tournament_id,
      v_version.category_id, v_version.participant_set_id, v_version.id,
      p_phase_id, v_round_id, v_match_number, 'unscheduled', v_duration, v_version.created_by
    ) returning id into v_match_id;
    perform public.insert_tournament_match_source(
      v_match_id, 'home',
      jsonb_build_object('type', 'loser_of_match', 'matchId', v_semifinal_match_ids[1])
    );
    perform public.insert_tournament_match_source(
      v_match_id, 'away',
      jsonb_build_object('type', 'loser_of_match', 'matchId', v_semifinal_match_ids[2])
    );
  end if;
end;
$$;

create or replace function public.generate_tournament_fixture(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_seed text,
  p_configuration jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.tournament_participant_sets%rowtype;
  v_tournament public.tournaments%rowtype;
  v_version public.tournament_fixture_versions%rowtype;
  v_version_number integer;
  v_phase_id uuid;
  v_knockout_phase_id uuid;
  v_participants uuid[];
  v_sources jsonb := '[]'::jsonb;
  v_group record;
  v_new_group_id uuid;
  v_group_participants uuid[];
  v_group_map jsonb := '{}'::jsonb;
  v_group_count integer;
  v_qualifiers integer;
  v_index integer;
  v_double boolean;
  v_knockout_double boolean;
  v_snapshot jsonb;
begin
  perform public.assert_tournament_fixture_scope(
    p_organization_id, p_tournament_id, p_category_id,
    'fixture.generate', array['registration', 'scheduled']::text[]
  );
  if p_idempotency_key is null
    or jsonb_typeof(coalesce(p_configuration, '{}'::jsonb)) <> 'object'
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_FIXTURE_CONFIGURATION';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:fixture:' || p_tournament_id::text || ':' || p_category_id::text, 0
  ));
  select version.* into v_version
  from public.tournament_fixture_versions version
  where version.organization_id = p_organization_id
    and version.created_by = auth.uid()
    and version.idempotency_key = p_idempotency_key;
  if v_version.id is not null then
    return jsonb_build_object(
      'fixtureVersionId', v_version.id,
      'versionNumber', v_version.version_number,
      'status', v_version.status
    );
  end if;
  select participant_set.* into v_set
  from public.tournament_participant_sets participant_set
  where participant_set.organization_id = p_organization_id
    and participant_set.tournament_id = p_tournament_id
    and participant_set.category_id = p_category_id
    and participant_set.status = 'frozen'
  for update;
  select tournament.* into v_tournament
  from public.tournaments tournament
  where tournament.organization_id = p_organization_id
    and tournament.id = p_tournament_id
  for update;
  if v_set.id is null or v_tournament.id is null then
    raise exception using errcode = '23514', message = 'TORNEOS_PARTICIPANTS_NOT_FROZEN';
  end if;
  select array_agg(participant.id order by participant.seed_number nulls last, participant.id)
  into v_participants
  from public.tournament_competition_participants participant
  where participant.participant_set_id = v_set.id and participant.status = 'active';
  if coalesce(array_length(v_participants, 1), 0) < 2 then
    raise exception using errcode = '23514', message = 'TORNEOS_NOT_ENOUGH_PARTICIPANTS';
  end if;
  select coalesce(max(version.version_number), 0) + 1 into v_version_number
  from public.tournament_fixture_versions version
  where version.tournament_id = p_tournament_id and version.category_id = p_category_id;
  v_snapshot := jsonb_build_object(
    'competitionFormat', v_tournament.competition_format,
    'formatSettings', v_tournament.format_settings,
    'requestedConfiguration', coalesce(p_configuration, '{}'::jsonb),
    'minimumRestMinutes', coalesce((p_configuration->>'minimumRestMinutes')::integer, 720),
    'maximumConsecutiveHome', coalesce((p_configuration->>'maximumConsecutiveHome')::integer, 3),
    'maximumMatchesPerDay', coalesce((p_configuration->>'maximumMatchesPerDay')::integer, 1)
  );
  insert into public.tournament_fixture_versions (
    organization_id, season_id, tournament_id, category_id, participant_set_id,
    version_number, status, generation_method, seed, participant_fingerprint,
    configuration_snapshot, created_by, idempotency_key
  ) values (
    p_organization_id, v_set.season_id, p_tournament_id, p_category_id, v_set.id,
    v_version_number, 'draft',
    case when v_tournament.competition_format in ('groups', 'groups_and_playoffs')
      then 'draw' else 'automatic' end,
    nullif(btrim(coalesce(p_seed, '')), ''), v_set.participant_fingerprint,
    v_snapshot, auth.uid(), p_idempotency_key
  ) returning * into v_version;

  if v_tournament.competition_format in ('league', 'league_and_playoffs') then
    insert into public.tournament_phases (
      organization_id, tournament_id, category_id, fixture_version_id,
      name, phase_type, sequence_number, status, configuration
    ) values (
      p_organization_id, p_tournament_id, p_category_id, v_version.id,
      'Liga', 'league', 1, 'generated', v_tournament.format_settings
    ) returning id into v_phase_id;
    v_double := coalesce(
      v_tournament.format_settings->>'rounds',
      v_tournament.format_settings->>'leagueRounds',
      'single'
    ) = 'double';
    perform public.build_tournament_round_robin(
      v_version.id, v_phase_id, null, v_participants, v_double
    );
  end if;

  if v_tournament.competition_format in ('groups', 'groups_and_playoffs') then
    select count(*) into v_group_count
    from public.tournament_groups group_row
    where group_row.participant_set_id = v_set.id
      and group_row.fixture_version_id is null
      and group_row.status = 'published';
    if v_group_count < 2 then
      raise exception using errcode = '23514', message = 'TORNEOS_GROUP_DRAW_REQUIRED';
    end if;
    insert into public.tournament_phases (
      organization_id, tournament_id, category_id, fixture_version_id,
      name, phase_type, sequence_number, status, configuration
    ) values (
      p_organization_id, p_tournament_id, p_category_id, v_version.id,
      'Fase de grupos', 'groups', 1, 'generated', v_tournament.format_settings
    ) returning id into v_phase_id;
    for v_group in
      select group_row.*
      from public.tournament_groups group_row
      where group_row.participant_set_id = v_set.id
        and group_row.fixture_version_id is null
        and group_row.status = 'published'
      order by group_row.sort_order, group_row.code
    loop
      insert into public.tournament_groups (
        organization_id, tournament_id, category_id, participant_set_id,
        fixture_version_id, phase_id, name, code, sort_order, status, draw_seed
      ) values (
        p_organization_id, p_tournament_id, p_category_id, v_set.id,
        v_version.id, v_phase_id, v_group.name, v_group.code, v_group.sort_order,
        'published', v_group.draw_seed
      ) returning id into v_new_group_id;
      insert into public.tournament_group_members (group_id, participant_id, position_seed)
      select v_new_group_id, member.participant_id, member.position_seed
      from public.tournament_group_members member
      where member.group_id = v_group.id
      order by member.position_seed nulls last, member.participant_id;
      v_group_map := v_group_map || jsonb_build_object(v_group.id::text, v_new_group_id);
      select array_agg(member.participant_id order by member.position_seed nulls last, member.participant_id)
      into v_group_participants
      from public.tournament_group_members member
      where member.group_id = v_group.id;
      v_double := coalesce(
        v_tournament.format_settings->>'rounds',
        v_tournament.format_settings->>'groupRounds',
        'single'
      ) = 'double';
      perform public.build_tournament_round_robin(
        v_version.id, v_phase_id, v_new_group_id, v_group_participants, v_double
      );
    end loop;
  end if;

  if v_tournament.competition_format = 'knockout' then
    for v_index in 1..array_length(v_participants, 1) loop
      v_sources := v_sources || jsonb_build_array(jsonb_build_object(
        'type', 'participant', 'participantId', v_participants[v_index]
      ));
    end loop;
    insert into public.tournament_phases (
      organization_id, tournament_id, category_id, fixture_version_id,
      name, phase_type, sequence_number, status, configuration
    ) values (
      p_organization_id, p_tournament_id, p_category_id, v_version.id,
      'Eliminación directa', 'custom_knockout', 1, 'generated', v_tournament.format_settings
    ) returning id into v_phase_id;
    perform public.build_tournament_knockout(
      v_version.id, v_phase_id, v_sources,
      coalesce(v_tournament.format_settings->>'legs', 'single') = 'double',
      coalesce((v_tournament.format_settings->>'thirdPlace')::boolean, false)
    );
  elsif v_tournament.competition_format = 'groups_and_playoffs' then
    v_sources := '[]'::jsonb;
    v_qualifiers := coalesce((v_tournament.format_settings->>'qualifiersPerGroup')::integer, 2);
    for v_group in
      select group_row.id
      from public.tournament_groups group_row
      where group_row.fixture_version_id = v_version.id
      order by group_row.sort_order, group_row.code
    loop
      for v_index in 1..v_qualifiers loop
        v_sources := v_sources || jsonb_build_array(jsonb_build_object(
          'type', 'group_position', 'groupId', v_group.id, 'positionNumber', v_index
        ));
      end loop;
    end loop;
    insert into public.tournament_phases (
      organization_id, tournament_id, category_id, fixture_version_id,
      name, phase_type, sequence_number, status, configuration
    ) values (
      p_organization_id, p_tournament_id, p_category_id, v_version.id,
      'Playoffs', 'custom_knockout', 2, 'generated', v_tournament.format_settings
    ) returning id into v_knockout_phase_id;
    perform public.build_tournament_knockout(
      v_version.id, v_knockout_phase_id, v_sources,
      coalesce(v_tournament.format_settings->>'knockoutLegs', 'single') = 'double',
      false
    );
  elsif v_tournament.competition_format = 'league_and_playoffs' then
    v_sources := '[]'::jsonb;
    v_qualifiers := coalesce((v_tournament.format_settings->>'qualifiers')::integer, 4);
    for v_index in 1..v_qualifiers loop
      v_sources := v_sources || jsonb_build_array(jsonb_build_object(
        'type', 'best_ranked', 'rankNumber', v_index
      ));
    end loop;
    insert into public.tournament_phases (
      organization_id, tournament_id, category_id, fixture_version_id,
      name, phase_type, sequence_number, status, configuration
    ) values (
      p_organization_id, p_tournament_id, p_category_id, v_version.id,
      'Playoffs', 'custom_knockout', 2, 'generated', v_tournament.format_settings
    ) returning id into v_knockout_phase_id;
    perform public.build_tournament_knockout(
      v_version.id, v_knockout_phase_id, v_sources,
      coalesce(v_tournament.format_settings->>'knockoutLegs', 'single') = 'double',
      false
    );
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'fixture.generated', 'fixture_version', v_version.id,
    null, p_tournament_id,
    jsonb_build_object(
      'categoryId', p_category_id,
      'versionNumber', v_version_number,
      'method', v_version.generation_method,
      'seed', v_version.seed,
      'participantFingerprint', v_set.participant_fingerprint,
      'matchCount', (
        select count(*) from public.tournament_matches match_row
        where match_row.fixture_version_id = v_version.id
      )
    )
  );
  return jsonb_build_object(
    'fixtureVersionId', v_version.id,
    'versionNumber', v_version_number,
    'status', 'draft',
    'phaseCount', (
      select count(*) from public.tournament_phases phase
      where phase.fixture_version_id = v_version.id
    ),
    'roundCount', (
      select count(*) from public.tournament_rounds round_row
      where round_row.fixture_version_id = v_version.id
    ),
    'matchCount', (
      select count(*) from public.tournament_matches match_row
      where match_row.fixture_version_id = v_version.id
    )
  );
end;
$$;

create or replace function public.create_manual_fixture_version(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_source_fixture_version_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.tournament_participant_sets%rowtype;
  v_source public.tournament_fixture_versions%rowtype;
  v_version public.tournament_fixture_versions%rowtype;
  v_number integer;
  v_phase record;
  v_group record;
  v_round record;
  v_match record;
  v_source_row record;
  v_new_id uuid;
  v_phase_map jsonb := '{}'::jsonb;
  v_group_map jsonb := '{}'::jsonb;
  v_round_map jsonb := '{}'::jsonb;
  v_match_map jsonb := '{}'::jsonb;
begin
  perform public.assert_tournament_fixture_scope(
    p_organization_id, p_tournament_id, p_category_id,
    'fixture.create_manual', array['registration', 'scheduled']::text[]
  );
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:fixture:' || p_tournament_id::text || ':' || p_category_id::text, 0
  ));
  select version.* into v_version
  from public.tournament_fixture_versions version
  where version.organization_id = p_organization_id
    and version.created_by = auth.uid()
    and version.idempotency_key = p_idempotency_key;
  if v_version.id is not null then
    return jsonb_build_object(
      'fixtureVersionId', v_version.id,
      'versionNumber', v_version.version_number,
      'status', v_version.status
    );
  end if;
  select participant_set.* into v_set
  from public.tournament_participant_sets participant_set
  where participant_set.organization_id = p_organization_id
    and participant_set.tournament_id = p_tournament_id
    and participant_set.category_id = p_category_id
    and participant_set.status = 'frozen'
  for update;
  if v_set.id is null then
    raise exception using errcode = '23514', message = 'TORNEOS_PARTICIPANTS_NOT_FROZEN';
  end if;
  if p_source_fixture_version_id is not null then
    select source.* into v_source
    from public.tournament_fixture_versions source
    where source.id = p_source_fixture_version_id
      and source.organization_id = p_organization_id
      and source.tournament_id = p_tournament_id
      and source.category_id = p_category_id
      and source.participant_set_id = v_set.id
      and source.status in ('published', 'superseded')
    for share;
    if v_source.id is null then
      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
    end if;
  end if;
  select coalesce(max(version.version_number), 0) + 1 into v_number
  from public.tournament_fixture_versions version
  where version.tournament_id = p_tournament_id and version.category_id = p_category_id;
  insert into public.tournament_fixture_versions (
    organization_id, season_id, tournament_id, category_id, participant_set_id,
    version_number, status, generation_method, seed, participant_fingerprint,
    configuration_snapshot, created_by, idempotency_key
  ) values (
    p_organization_id, v_set.season_id, p_tournament_id, p_category_id, v_set.id,
    v_number, 'draft', 'manual', v_source.seed, v_set.participant_fingerprint,
    coalesce(v_source.configuration_snapshot, '{}'::jsonb)
      || jsonb_build_object('copiedFromVersionId', v_source.id),
    auth.uid(), p_idempotency_key
  ) returning * into v_version;
  if v_source.id is not null then
    for v_phase in
      select * from public.tournament_phases
      where fixture_version_id = v_source.id order by sequence_number
    loop
      insert into public.tournament_phases (
        organization_id, tournament_id, category_id, fixture_version_id,
        name, phase_type, sequence_number, status, configuration
      ) values (
        v_phase.organization_id, v_phase.tournament_id, v_phase.category_id,
        v_version.id, v_phase.name, v_phase.phase_type, v_phase.sequence_number,
        'generated', v_phase.configuration
      ) returning id into v_new_id;
      v_phase_map := v_phase_map || jsonb_build_object(v_phase.id::text, v_new_id);
    end loop;
    for v_group in
      select * from public.tournament_groups
      where fixture_version_id = v_source.id order by sort_order, code
    loop
      insert into public.tournament_groups (
        organization_id, tournament_id, category_id, participant_set_id,
        fixture_version_id, phase_id, name, code, sort_order, status, draw_seed
      ) values (
        v_group.organization_id, v_group.tournament_id, v_group.category_id,
        v_group.participant_set_id, v_version.id,
        (v_phase_map->>v_group.phase_id::text)::uuid,
        v_group.name, v_group.code, v_group.sort_order, 'published', v_group.draw_seed
      ) returning id into v_new_id;
      v_group_map := v_group_map || jsonb_build_object(v_group.id::text, v_new_id);
      insert into public.tournament_group_members (group_id, participant_id, position_seed)
      select v_new_id, member.participant_id, member.position_seed
      from public.tournament_group_members member where member.group_id = v_group.id;
    end loop;
    for v_round in
      select * from public.tournament_rounds
      where fixture_version_id = v_source.id order by sort_order, round_number
    loop
      insert into public.tournament_rounds (
        organization_id, tournament_id, category_id, fixture_version_id,
        phase_id, group_id, round_number, name, status, starts_at, ends_at, sort_order
      ) values (
        v_round.organization_id, v_round.tournament_id, v_round.category_id,
        v_version.id, (v_phase_map->>v_round.phase_id::text)::uuid,
        case when v_round.group_id is null then null
          else (v_group_map->>v_round.group_id::text)::uuid end,
        v_round.round_number, v_round.name,
        case when v_round.status = 'locked' then 'scheduled' else v_round.status end,
        v_round.starts_at, v_round.ends_at, v_round.sort_order
      ) returning id into v_new_id;
      v_round_map := v_round_map || jsonb_build_object(v_round.id::text, v_new_id);
    end loop;
    for v_match in
      select * from public.tournament_matches
      where fixture_version_id = v_source.id order by match_number
    loop
      insert into public.tournament_matches (
        organization_id, season_id, tournament_id, category_id,
        participant_set_id, fixture_version_id, phase_id, group_id, round_id,
        match_number, leg_number, tie_key, home_participant_id, away_participant_id,
        status, scheduled_at, venue_id, court_id, duration_minutes, created_by,
        postponed_at, cancelled_at
      ) values (
        v_match.organization_id, v_match.season_id, v_match.tournament_id,
        v_match.category_id, v_match.participant_set_id, v_version.id,
        (v_phase_map->>v_match.phase_id::text)::uuid,
        case when v_match.group_id is null then null
          else (v_group_map->>v_match.group_id::text)::uuid end,
        (v_round_map->>v_match.round_id::text)::uuid,
        v_match.match_number, v_match.leg_number, v_match.tie_key,
        v_match.home_participant_id, v_match.away_participant_id,
        case when v_match.status in ('ready', 'in_progress', 'completed', 'awarded', 'suspended')
          then 'scheduled' else v_match.status end,
        v_match.scheduled_at, v_match.venue_id, v_match.court_id,
        v_match.duration_minutes, auth.uid(),
        case when v_match.status = 'postponed' then v_match.postponed_at else null end,
        case when v_match.status = 'cancelled' then v_match.cancelled_at else null end
      ) returning id into v_new_id;
      v_match_map := v_match_map || jsonb_build_object(v_match.id::text, v_new_id);
    end loop;
    for v_source_row in
      select * from public.tournament_match_sources
      where fixture_version_id = v_source.id order by created_at, id
    loop
      insert into public.tournament_match_sources (
        organization_id, tournament_id, category_id, fixture_version_id,
        match_id, side, source_type, participant_id, source_match_id,
        group_id, position_number, seed_number, rank_number
      ) values (
        v_source_row.organization_id, v_source_row.tournament_id,
        v_source_row.category_id, v_version.id,
        (v_match_map->>v_source_row.match_id::text)::uuid,
        v_source_row.side, v_source_row.source_type, v_source_row.participant_id,
        case when v_source_row.source_match_id is null then null
          else (v_match_map->>v_source_row.source_match_id::text)::uuid end,
        case when v_source_row.group_id is null then null
          else (v_group_map->>v_source_row.group_id::text)::uuid end,
        v_source_row.position_number, v_source_row.seed_number, v_source_row.rank_number
      );
    end loop;
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'fixture.manual_created', 'fixture_version', v_version.id,
    null, p_tournament_id,
    jsonb_build_object(
      'categoryId', p_category_id,
      'versionNumber', v_number,
      'sourceFixtureVersionId', v_source.id
    )
  );
  return jsonb_build_object(
    'fixtureVersionId', v_version.id,
    'versionNumber', v_number,
    'status', 'draft',
    'sourceFixtureVersionId', v_source.id
  );
end;
$$;

create or replace function public.update_draft_fixture(
  p_organization_id uuid,
  p_fixture_version_id uuid,
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.tournament_fixture_versions%rowtype;
  v_phase public.tournament_phases%rowtype;
  v_round public.tournament_rounds%rowtype;
  v_match public.tournament_matches%rowtype;
  v_id uuid;
  v_number integer;
begin
  if auth.uid() is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select version.* into v_version
  from public.tournament_fixture_versions version
  join public.tournament_organizations organization
    on organization.id = version.organization_id and organization.status = 'active'
  join public.tournaments tournament
    on tournament.id = version.tournament_id and tournament.status <> 'archived'
  join public.tournament_categories category
    on category.id = version.category_id and category.status = 'active'
  where version.id = p_fixture_version_id
    and version.organization_id = p_organization_id
    and version.status = 'draft'
  for update of version;
  if v_version.id is null or not public.has_tournament_organization_capability(
    p_organization_id,
    case
      when p_action = 'create_match' then 'matches.create'
      when p_action in ('create_round', 'lock_round') then 'rounds.manage'
      else 'fixture.update_draft'
    end
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if p_action = 'create_phase' then
    select coalesce(max(phase.sequence_number), 0) + 1 into v_number
    from public.tournament_phases phase where phase.fixture_version_id = v_version.id;
    insert into public.tournament_phases (
      organization_id, tournament_id, category_id, fixture_version_id,
      name, phase_type, sequence_number, status, configuration
    ) values (
      v_version.organization_id, v_version.tournament_id, v_version.category_id,
      v_version.id, btrim(p_payload->>'name'), p_payload->>'phaseType',
      coalesce((p_payload->>'sequenceNumber')::integer, v_number),
      'draft', coalesce(p_payload->'configuration', '{}'::jsonb)
    ) returning id into v_id;
  elsif p_action = 'create_round' then
    select phase.* into v_phase from public.tournament_phases phase
    where phase.id = (p_payload->>'phaseId')::uuid
      and phase.fixture_version_id = v_version.id;
    if v_phase.id is null then
      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
    end if;
    select coalesce(max(round_row.round_number), 0) + 1 into v_number
    from public.tournament_rounds round_row
    where round_row.phase_id = v_phase.id
      and round_row.group_id is not distinct from nullif(p_payload->>'groupId', '')::uuid;
    insert into public.tournament_rounds (
      organization_id, tournament_id, category_id, fixture_version_id,
      phase_id, group_id, round_number, name, status, sort_order
    ) values (
      v_version.organization_id, v_version.tournament_id, v_version.category_id,
      v_version.id, v_phase.id, nullif(p_payload->>'groupId', '')::uuid,
      coalesce((p_payload->>'roundNumber')::integer, v_number),
      btrim(p_payload->>'name'), 'draft',
      coalesce((p_payload->>'sortOrder')::integer, v_number - 1)
    ) returning id into v_id;
  elsif p_action = 'create_match' then
    select round_row.* into v_round from public.tournament_rounds round_row
    where round_row.id = (p_payload->>'roundId')::uuid
      and round_row.fixture_version_id = v_version.id;
    if v_round.id is null then
      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
    end if;
    select coalesce(max(match_row.match_number), 0) + 1 into v_number
    from public.tournament_matches match_row
    where match_row.fixture_version_id = v_version.id;
    insert into public.tournament_matches (
      organization_id, season_id, tournament_id, category_id,
      participant_set_id, fixture_version_id, phase_id, group_id, round_id,
      match_number, home_participant_id, away_participant_id, status,
      duration_minutes, created_by
    ) values (
      v_version.organization_id, v_version.season_id, v_version.tournament_id,
      v_version.category_id, v_version.participant_set_id, v_version.id,
      v_round.phase_id, v_round.group_id, v_round.id,
      coalesce((p_payload->>'matchNumber')::integer, v_number),
      nullif(p_payload->>'homeParticipantId', '')::uuid,
      nullif(p_payload->>'awayParticipantId', '')::uuid,
      'unscheduled', coalesce((p_payload->>'durationMinutes')::integer, 60),
      auth.uid()
    ) returning id into v_id;
    perform public.insert_tournament_match_source(
      v_id, 'home', coalesce(
        p_payload->'homeSource',
        jsonb_build_object('type', 'participant', 'participantId', p_payload->>'homeParticipantId')
      )
    );
    perform public.insert_tournament_match_source(
      v_id, 'away', coalesce(
        p_payload->'awaySource',
        jsonb_build_object('type', 'participant', 'participantId', p_payload->>'awayParticipantId')
      )
    );
  elsif p_action = 'delete_match' then
    select match_row.* into v_match
    from public.tournament_matches match_row
    where match_row.id = (p_payload->>'matchId')::uuid
      and match_row.fixture_version_id = v_version.id
    for update;
    if v_match.id is null or exists (
      select 1 from public.tournament_match_sources source
      where source.source_match_id = v_match.id
    ) then
      raise exception using errcode = '23514', message = 'TORNEOS_MATCH_HAS_DEPENDENCIES';
    end if;
    delete from public.tournament_match_sources where match_id = v_match.id;
    delete from public.tournament_matches where id = v_match.id;
    v_id := v_match.id;
  elsif p_action = 'lock_round' then
    update public.tournament_rounds
    set status = 'locked', locked_at = now()
    where id = (p_payload->>'roundId')::uuid
      and fixture_version_id = v_version.id
      and status in ('draft', 'scheduled')
      and exists (
        select 1 from public.tournament_matches match_row
        where match_row.round_id = tournament_rounds.id
          and match_row.status <> 'cancelled'
      )
      and not exists (
        select 1 from public.tournament_matches match_row
        where match_row.round_id = tournament_rounds.id
          and match_row.status not in ('scheduled', 'postponed', 'ready', 'cancelled')
      )
    returning id into v_id;
    if v_id is null then
      raise exception using errcode = '23514', message = 'TORNEOS_INVALID_ROUND_TRANSITION';
    end if;
  else
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_FIXTURE_ACTION';
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'fixture.draft_updated', 'fixture_version', v_version.id,
    null, v_version.tournament_id,
    jsonb_build_object('action', p_action, 'resourceId', v_id)
  );
  return jsonb_build_object('fixtureVersionId', v_version.id, 'resourceId', v_id, 'action', p_action);
end;
$$;

create or replace function public.validate_tournament_fixture(
  p_organization_id uuid,
  p_fixture_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version public.tournament_fixture_versions%rowtype;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_item record;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select version.* into v_version
  from public.tournament_fixture_versions version
  where version.id = p_fixture_version_id
    and version.organization_id = p_organization_id;
  if v_version.id is null or not public.can_read_tournament_fixture_scope(
    p_organization_id, v_version.tournament_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if v_version.invalidated_at is not null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'participants_changed', 'resourceId', v_version.id
    ));
  end if;
  for v_item in
    select match_row.id
    from public.tournament_matches match_row
    where match_row.fixture_version_id = v_version.id
      and match_row.home_participant_id is not null
      and match_row.home_participant_id = match_row.away_participant_id
  loop
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'self_match', 'resourceId', v_item.id
    ));
  end loop;
  for v_item in
    select match_row.id
    from public.tournament_matches match_row
    where match_row.fixture_version_id = v_version.id
      and match_row.status <> 'cancelled'
      and (select count(*) from public.tournament_match_sources source
        where source.match_id = match_row.id) <> 2
  loop
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'incomplete_match_sources', 'resourceId', v_item.id
    ));
  end loop;
  for v_item in
    select min(left_match.id::text)::uuid as id
    from public.tournament_matches left_match
    join public.tournament_matches right_match
      on right_match.fixture_version_id = left_match.fixture_version_id
      and right_match.id > left_match.id
      and right_match.phase_id = left_match.phase_id
      and right_match.leg_number = left_match.leg_number
      and right_match.home_participant_id = left_match.home_participant_id
      and right_match.away_participant_id = left_match.away_participant_id
    where left_match.fixture_version_id = v_version.id
      and left_match.status <> 'cancelled' and right_match.status <> 'cancelled'
    group by left_match.home_participant_id, left_match.away_participant_id,
      left_match.phase_id, left_match.leg_number
  loop
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'duplicate_pairing', 'resourceId', v_item.id
    ));
  end loop;
  for v_item in
    select group_row.id
    from public.tournament_groups group_row
    where group_row.fixture_version_id = v_version.id
      and group_row.status = 'published'
      and not exists (
        select 1 from public.tournament_group_members member
        where member.group_id = group_row.id
      )
  loop
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'empty_published_group', 'resourceId', v_item.id
    ));
  end loop;
  if not exists (
    select 1 from public.tournament_phases phase
    where phase.fixture_version_id = v_version.id and phase.status <> 'archived'
  ) or not exists (
    select 1 from public.tournament_matches match_row
    where match_row.fixture_version_id = v_version.id and match_row.status <> 'cancelled'
  ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'fixture_incomplete', 'resourceId', v_version.id
    ));
  end if;
  for v_item in
    select round_row.id, max(load) - min(load) as delta
    from (
      select round_row.id, participant.id as participant_id,
        count(match_row.id) filter (
          where participant.id in (match_row.home_participant_id, match_row.away_participant_id)
        ) as load
      from public.tournament_rounds round_row
      cross join public.tournament_competition_participants participant
      left join public.tournament_matches match_row on match_row.round_id = round_row.id
        and match_row.status <> 'cancelled'
      where round_row.fixture_version_id = v_version.id
        and participant.participant_set_id = v_version.participant_set_id
      group by round_row.id, participant.id
    ) round_row
    group by round_row.id
    having max(load) - min(load) > 1
  loop
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'uneven_round_load', 'resourceId', v_item.id
    ));
  end loop;
  return jsonb_build_object(
    'valid', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'checkedAt', now()
  );
end;
$$;

create or replace function public.publish_tournament_fixture(
  p_organization_id uuid,
  p_fixture_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.tournament_fixture_versions%rowtype;
  v_previous public.tournament_fixture_versions%rowtype;
  v_validation jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select version.* into v_version
  from public.tournament_fixture_versions version
  where version.id = p_fixture_version_id
    and version.organization_id = p_organization_id
    and version.status = 'draft'
  for update;
  if v_version.id is null
    or not public.has_tournament_organization_capability(p_organization_id, 'fixture.publish')
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  perform public.assert_tournament_fixture_scope(
    p_organization_id, v_version.tournament_id, v_version.category_id,
    'fixture.publish', array['registration', 'scheduled']::text[]
  );
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:fixture:' || v_version.tournament_id::text || ':' || v_version.category_id::text, 0
  ));
  v_validation := public.validate_tournament_fixture(p_organization_id, v_version.id);
  if not (v_validation->>'valid')::boolean then
    raise exception using errcode = '23514', message = 'TORNEOS_FIXTURE_INVALID';
  end if;
  select version.* into v_previous
  from public.tournament_fixture_versions version
  where version.tournament_id = v_version.tournament_id
    and version.category_id = v_version.category_id
    and version.status = 'published'
  for update;
  if v_previous.id is not null then
    if not public.has_tournament_organization_capability(
      p_organization_id, 'fixture.supersede'
    ) then
      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
    end if;
    update public.tournament_fixture_versions
    set status = 'superseded', superseded_at = now()
    where id = v_previous.id;
    perform public.append_tournament_audit(
      p_organization_id, 'fixture.superseded', 'fixture_version', v_previous.id,
      null, v_version.tournament_id,
      jsonb_build_object('supersededByFixtureVersionId', v_version.id)
    );
  end if;
  update public.tournament_fixture_versions
  set status = 'published', published_at = now()
  where id = v_version.id;
  update public.tournament_rounds round_row
  set status = case
      when not exists (
        select 1 from public.tournament_matches match_row
        where match_row.round_id = round_row.id
          and match_row.status not in ('scheduled', 'ready', 'cancelled')
      ) then 'scheduled'
      else 'draft'
    end
  where round_row.fixture_version_id = v_version.id
    and round_row.status <> 'locked';
  update public.tournament_phases phase
  set status = case
      when not exists (
        select 1 from public.tournament_matches match_row
        where match_row.phase_id = phase.id
          and match_row.status not in ('scheduled', 'ready', 'cancelled')
      ) then 'scheduled'
      else 'generated'
    end
  where phase.fixture_version_id = v_version.id;
  update public.tournaments
  set status = 'scheduled'
  where id = v_version.tournament_id
    and organization_id = p_organization_id
    and status = 'registration';
  perform public.append_tournament_audit(
    p_organization_id, 'fixture.published', 'fixture_version', v_version.id,
    null, v_version.tournament_id,
    jsonb_build_object(
      'categoryId', v_version.category_id,
      'versionNumber', v_version.version_number,
      'previousFixtureVersionId', v_previous.id
    )
  );
  return jsonb_build_object(
    'fixtureVersionId', v_version.id,
    'status', 'published',
    'supersededFixtureVersionId', v_previous.id
  );
end;
$$;

create or replace function public.archive_tournament_fixture(
  p_organization_id uuid,
  p_fixture_version_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.tournament_fixture_versions%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or char_length(v_reason) not between 3 and 500
    or not public.has_tournament_organization_capability(
      p_organization_id, 'fixture.archive'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  update public.tournament_fixture_versions
  set status = 'archived', archived_at = now()
  where id = p_fixture_version_id
    and organization_id = p_organization_id
    and status = 'draft'
  returning * into v_version;
  if v_version.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'fixture.archived', 'fixture_version', v_version.id,
    null, v_version.tournament_id, jsonb_build_object('reason', v_reason)
  );
  return jsonb_build_object('fixtureVersionId', v_version.id, 'status', 'archived');
end;
$$;

create or replace function public.supersede_tournament_fixture(
  p_organization_id uuid,
  p_fixture_version_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.tournament_fixture_versions%rowtype;
begin
  if auth.uid() is null
    or not public.has_tournament_organization_capability(
      p_organization_id, 'fixture.supersede'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select version.* into v_version
  from public.tournament_fixture_versions version
  where version.id = p_fixture_version_id
    and version.organization_id = p_organization_id
    and version.status = 'published';
  if v_version.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  return public.create_manual_fixture_version(
    p_organization_id, v_version.tournament_id, v_version.category_id,
    v_version.id, p_idempotency_key
  );
end;
$$;

create or replace function public.create_tournament_venue(
  p_organization_id uuid,
  p_name text,
  p_address text,
  p_place_id text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_locality text default null,
  p_timezone text default 'America/Argentina/Buenos_Aires',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue public.tournament_venues%rowtype;
begin
  if auth.uid() is null
    or not public.has_tournament_organization_capability(p_organization_id, 'venues.create')
    or not exists (
      select 1 from public.tournament_organizations organization
      where organization.id = p_organization_id and organization.status = 'active'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names zone where zone.name = p_timezone
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_TIMEZONE';
  end if;
  insert into public.tournament_venues (
    organization_id, name, address, place_id, latitude, longitude,
    locality, timezone, notes
  ) values (
    p_organization_id, btrim(p_name), btrim(p_address),
    nullif(btrim(coalesce(p_place_id, '')), ''), p_latitude, p_longitude,
    nullif(btrim(coalesce(p_locality, '')), ''), p_timezone,
    nullif(btrim(coalesce(p_notes, '')), '')
  ) returning * into v_venue;
  perform public.append_tournament_audit(
    p_organization_id, 'venue.created', 'venue', v_venue.id,
    null, null, jsonb_build_object('name', v_venue.name)
  );
  return jsonb_build_object(
    'id', v_venue.id, 'name', v_venue.name, 'status', v_venue.status
  );
end;
$$;

create or replace function public.update_tournament_venue(
  p_organization_id uuid,
  p_venue_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue public.tournament_venues%rowtype;
  v_status text;
  v_capability text;
begin
  if auth.uid() is null or jsonb_typeof(p_patch) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_patch) key
    where key not in (
      'name', 'address', 'placeId', 'latitude', 'longitude',
      'locality', 'timezone', 'notes', 'status'
    )
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_PATCH';
  end if;
  v_status := coalesce(p_patch->>'status', 'active');
  v_capability := case when v_status = 'archived' then 'venues.archive' else 'venues.update' end;
  if not public.has_tournament_organization_capability(p_organization_id, v_capability) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select venue.* into v_venue from public.tournament_venues venue
  where venue.id = p_venue_id and venue.organization_id = p_organization_id
    and venue.status = 'active'
  for update;
  if v_venue.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  update public.tournament_venues
  set name = case when p_patch ? 'name' then btrim(p_patch->>'name') else name end,
      address = case when p_patch ? 'address' then btrim(p_patch->>'address') else address end,
      place_id = case when p_patch ? 'placeId'
        then nullif(btrim(p_patch->>'placeId'), '') else place_id end,
      latitude = case when p_patch ? 'latitude' then (p_patch->>'latitude')::double precision else latitude end,
      longitude = case when p_patch ? 'longitude' then (p_patch->>'longitude')::double precision else longitude end,
      locality = case when p_patch ? 'locality'
        then nullif(btrim(p_patch->>'locality'), '') else locality end,
      timezone = case when p_patch ? 'timezone' then p_patch->>'timezone' else timezone end,
      notes = case when p_patch ? 'notes' then nullif(btrim(p_patch->>'notes'), '') else notes end,
      status = v_status,
      archived_at = case when v_status = 'archived' then now() else null end
  where id = v_venue.id returning * into v_venue;
  if v_status = 'archived' then
    update public.tournament_courts
    set status = 'archived', archived_at = now()
    where venue_id = v_venue.id and status = 'active';
  end if;
  perform public.append_tournament_audit(
    p_organization_id,
    case when v_status = 'archived' then 'venue.archived' else 'venue.updated' end,
    'venue', v_venue.id, null, null, jsonb_build_object('status', v_status)
  );
  return jsonb_build_object('id', v_venue.id, 'name', v_venue.name, 'status', v_venue.status);
end;
$$;

create or replace function public.create_tournament_court(
  p_organization_id uuid,
  p_venue_id uuid,
  p_name text,
  p_sport_modality text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_court public.tournament_courts%rowtype;
begin
  if auth.uid() is null
    or not public.has_tournament_organization_capability(p_organization_id, 'courts.create')
    or not exists (
      select 1 from public.tournament_venues venue
      where venue.id = p_venue_id and venue.organization_id = p_organization_id
        and venue.status = 'active'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  insert into public.tournament_courts (
    organization_id, venue_id, name, sport_modality, notes
  ) values (
    p_organization_id, p_venue_id, btrim(p_name), p_sport_modality,
    nullif(btrim(coalesce(p_notes, '')), '')
  ) returning * into v_court;
  perform public.append_tournament_audit(
    p_organization_id, 'court.created', 'court', v_court.id,
    null, null, jsonb_build_object('venueId', p_venue_id, 'name', v_court.name)
  );
  return jsonb_build_object(
    'id', v_court.id, 'venueId', v_court.venue_id,
    'name', v_court.name, 'status', v_court.status
  );
end;
$$;

create or replace function public.update_tournament_court(
  p_organization_id uuid,
  p_court_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_court public.tournament_courts%rowtype;
  v_status text;
  v_capability text;
begin
  if auth.uid() is null or jsonb_typeof(p_patch) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_patch) key
    where key not in ('name', 'sportModality', 'notes', 'status')
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_PATCH';
  end if;
  v_status := coalesce(p_patch->>'status', 'active');
  v_capability := case when v_status = 'archived' then 'courts.archive' else 'courts.update' end;
  if not public.has_tournament_organization_capability(p_organization_id, v_capability) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select court.* into v_court from public.tournament_courts court
  join public.tournament_venues venue
    on venue.id = court.venue_id and venue.status = 'active'
  where court.id = p_court_id and court.organization_id = p_organization_id
    and court.status = 'active'
  for update of court;
  if v_court.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  update public.tournament_courts
  set name = case when p_patch ? 'name' then btrim(p_patch->>'name') else name end,
      sport_modality = case when p_patch ? 'sportModality'
        then p_patch->>'sportModality' else sport_modality end,
      notes = case when p_patch ? 'notes'
        then nullif(btrim(p_patch->>'notes'), '') else notes end,
      status = v_status,
      archived_at = case when v_status = 'archived' then now() else null end
  where id = v_court.id returning * into v_court;
  perform public.append_tournament_audit(
    p_organization_id,
    case when v_status = 'archived' then 'court.archived' else 'court.updated' end,
    'court', v_court.id, null, null, jsonb_build_object('status', v_status)
  );
  return jsonb_build_object('id', v_court.id, 'name', v_court.name, 'status', v_court.status);
end;
$$;

create or replace function public.save_tournament_schedule_windows(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_windows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window jsonb;
  v_count integer := 0;
  v_category_id uuid;
  v_venue_id uuid;
  v_court_id uuid;
begin
  if auth.uid() is null
    or not public.has_tournament_organization_capability(
      p_organization_id, 'schedule_windows.manage'
    )
    or jsonb_typeof(p_windows) <> 'array'
    or jsonb_array_length(p_windows) > 500
    or not exists (
      select 1 from public.tournaments tournament
      join public.tournament_organizations organization
        on organization.id = tournament.organization_id
      where tournament.id = p_tournament_id
        and tournament.organization_id = p_organization_id
        and tournament.status <> 'archived'
        and organization.status = 'active'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:windows:' || p_tournament_id::text, 0
  ));
  update public.tournament_schedule_windows
  set status = 'archived', archived_at = now()
  where organization_id = p_organization_id
    and tournament_id = p_tournament_id
    and status = 'active';
  for v_window in select value from jsonb_array_elements(p_windows)
  loop
    v_category_id := nullif(v_window->>'categoryId', '')::uuid;
    v_venue_id := nullif(v_window->>'venueId', '')::uuid;
    v_court_id := nullif(v_window->>'courtId', '')::uuid;
    if v_category_id is not null and not exists (
      select 1 from public.tournament_categories category
      where category.id = v_category_id
        and category.organization_id = p_organization_id
        and category.tournament_id = p_tournament_id
        and category.status = 'active'
    ) then
      raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
    end if;
    if v_court_id is not null and not exists (
      select 1 from public.tournament_courts court
      join public.tournament_venues venue on venue.id = court.venue_id
      where court.id = v_court_id and court.organization_id = p_organization_id
        and court.venue_id = v_venue_id
        and court.status = 'active' and venue.status = 'active'
    ) then
      raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
    end if;
    insert into public.tournament_schedule_windows (
      organization_id, tournament_id, category_id, venue_id, court_id,
      day_of_week, specific_date, starts_at, ends_at, slot_duration_minutes,
      buffer_minutes, window_type, notes
    ) values (
      p_organization_id, p_tournament_id, v_category_id, v_venue_id, v_court_id,
      nullif(v_window->>'dayOfWeek', '')::smallint,
      nullif(v_window->>'specificDate', '')::date,
      (v_window->>'startsAt')::time, (v_window->>'endsAt')::time,
      (v_window->>'slotDurationMinutes')::integer,
      coalesce((v_window->>'bufferMinutes')::integer, 0),
      coalesce(v_window->>'windowType', 'availability'),
      nullif(btrim(coalesce(v_window->>'notes', '')), '')
    );
    v_count := v_count + 1;
  end loop;
  perform public.append_tournament_audit(
    p_organization_id, 'schedule_windows.saved', 'tournament', p_tournament_id,
    null, p_tournament_id, jsonb_build_object('windowCount', v_count)
  );
  return jsonb_build_object('tournamentId', p_tournament_id, 'windowCount', v_count);
end;
$$;

create or replace function public.validate_tournament_match_schedule(
  p_organization_id uuid,
  p_match_id uuid,
  p_scheduled_at timestamptz,
  p_venue_id uuid,
  p_court_id uuid,
  p_duration_minutes integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_version public.tournament_fixture_versions%rowtype;
  v_tournament public.tournaments%rowtype;
  v_season public.tournament_seasons%rowtype;
  v_category public.tournament_categories%rowtype;
  v_venue public.tournament_venues%rowtype;
  v_court public.tournament_courts%rowtype;
  v_round public.tournament_rounds%rowtype;
  v_duration integer;
  v_buffer integer := 0;
  v_minimum_rest integer := 720;
  v_end timestamptz;
  v_local_date date;
  v_local_time time;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_other record;
begin
  if auth.uid() is null or p_scheduled_at is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select match_row.* into v_match
  from public.tournament_matches match_row
  where match_row.id = p_match_id and match_row.organization_id = p_organization_id;
  if v_match.id is null or not public.can_read_tournament_fixture_scope(
    p_organization_id, v_match.tournament_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select version.* into v_version from public.tournament_fixture_versions version
  where version.id = v_match.fixture_version_id;
  select tournament.* into v_tournament from public.tournaments tournament
  where tournament.id = v_match.tournament_id;
  select season.* into v_season from public.tournament_seasons season
  where season.id = v_match.season_id;
  select category.* into v_category from public.tournament_categories category
  where category.id = v_match.category_id;
  select venue.* into v_venue from public.tournament_venues venue
  where venue.id = p_venue_id;
  select court.* into v_court from public.tournament_courts court
  where court.id = p_court_id;
  select round_row.* into v_round from public.tournament_rounds round_row
  where round_row.id = v_match.round_id;
  v_duration := coalesce(p_duration_minutes, v_match.duration_minutes);
  if v_duration not between 15 and 240 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'invalid_duration'));
  end if;
  if v_venue.id is null or v_court.id is null
    or v_venue.organization_id <> p_organization_id
    or v_court.organization_id <> p_organization_id
    or v_court.venue_id <> v_venue.id
  then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'foreign_resource'));
  elsif v_venue.status <> 'active' or v_court.status <> 'active' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'archived_resource'));
  elsif v_court.sport_modality <> coalesce(v_category.sport_modality, v_tournament.sport_modality) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'incompatible_modality'));
  end if;
  if v_match.home_participant_id is not null
    and v_match.home_participant_id = v_match.away_participant_id
  then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'self_match'));
  end if;
  if v_version.status not in ('draft', 'published')
    or v_version.invalidated_at is not null
    or v_tournament.status = 'archived'
    or v_category.status = 'archived'
  then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'inactive_fixture'));
  end if;
  if v_venue.id is not null then
    v_local_date := (p_scheduled_at at time zone v_venue.timezone)::date;
    v_local_time := (p_scheduled_at at time zone v_venue.timezone)::time;
  else
    v_local_date := p_scheduled_at::date;
    v_local_time := p_scheduled_at::time;
  end if;
  if (v_season.start_date is not null and v_local_date < v_season.start_date)
    or (v_season.end_date is not null and v_local_date > v_season.end_date)
    or (v_tournament.start_date is not null and v_local_date < v_tournament.start_date)
    or (v_tournament.end_date is not null and v_local_date > v_tournament.end_date)
    or (v_round.starts_at is not null and p_scheduled_at < v_round.starts_at)
    or (v_round.ends_at is not null and p_scheduled_at > v_round.ends_at)
  then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'outside_date_range'));
  end if;
  select coalesce(max(schedule_window.buffer_minutes), 0) into v_buffer
  from public.tournament_schedule_windows schedule_window
  where schedule_window.organization_id = p_organization_id
    and schedule_window.tournament_id = v_match.tournament_id
    and schedule_window.status = 'active'
    and schedule_window.window_type = 'availability'
    and (schedule_window.category_id is null or schedule_window.category_id = v_match.category_id)
    and (schedule_window.venue_id is null or schedule_window.venue_id = p_venue_id)
    and (schedule_window.court_id is null or schedule_window.court_id = p_court_id)
    and (
      schedule_window.specific_date = v_local_date
      or schedule_window.day_of_week = extract(isodow from v_local_date)::smallint
    )
    and v_local_time >= schedule_window.starts_at
    and v_local_time + make_interval(mins => v_duration) <= schedule_window.ends_at;
  v_end := p_scheduled_at + make_interval(mins => v_duration + v_buffer);
  if exists (
    select 1 from public.tournament_schedule_windows schedule_window
    where schedule_window.organization_id = p_organization_id
      and schedule_window.tournament_id = v_match.tournament_id
      and schedule_window.status = 'active'
      and schedule_window.window_type = 'availability'
      and (schedule_window.category_id is null or schedule_window.category_id = v_match.category_id)
      and (schedule_window.venue_id is null or schedule_window.venue_id = p_venue_id)
      and (schedule_window.court_id is null or schedule_window.court_id = p_court_id)
  ) and not exists (
    select 1 from public.tournament_schedule_windows schedule_window
    where schedule_window.organization_id = p_organization_id
      and schedule_window.tournament_id = v_match.tournament_id
      and schedule_window.status = 'active'
      and schedule_window.window_type = 'availability'
      and (schedule_window.category_id is null or schedule_window.category_id = v_match.category_id)
      and (schedule_window.venue_id is null or schedule_window.venue_id = p_venue_id)
      and (schedule_window.court_id is null or schedule_window.court_id = p_court_id)
      and (schedule_window.specific_date = v_local_date
        or schedule_window.day_of_week = extract(isodow from v_local_date)::smallint)
      and v_local_time >= schedule_window.starts_at
      and v_local_time + make_interval(mins => v_duration) <= schedule_window.ends_at
  ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'outside_schedule_window'));
  end if;
  if exists (
    select 1 from public.tournament_schedule_windows schedule_window
    where schedule_window.organization_id = p_organization_id
      and schedule_window.tournament_id = v_match.tournament_id
      and schedule_window.status = 'active'
      and schedule_window.window_type in ('block', 'closure')
      and (schedule_window.category_id is null or schedule_window.category_id = v_match.category_id)
      and (schedule_window.venue_id is null or schedule_window.venue_id = p_venue_id)
      and (schedule_window.court_id is null or schedule_window.court_id = p_court_id)
      and (schedule_window.specific_date = v_local_date
        or schedule_window.day_of_week = extract(isodow from v_local_date)::smallint)
      and v_local_time < schedule_window.ends_at
      and v_local_time + make_interval(mins => v_duration) > schedule_window.starts_at
  ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'blocked_schedule_window'));
  end if;
  for v_other in
    select other.id from public.tournament_matches other
    where other.id <> v_match.id
      and other.organization_id = p_organization_id
      and other.court_id = p_court_id
      and other.scheduled_at is not null
      and other.status not in ('cancelled', 'completed')
      and other.scheduled_at < v_end
      and other.scheduled_at
        + make_interval(mins => coalesce(other.duration_minutes, 60) + v_buffer)
        > p_scheduled_at
  loop
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'court_overlap', 'resourceId', v_other.id
    ));
  end loop;
  for v_other in
    select other.id from public.tournament_matches other
    where other.id <> v_match.id
      and other.organization_id = p_organization_id
      and other.scheduled_at is not null
      and other.status not in ('cancelled', 'completed')
      and other.scheduled_at < v_end
      and other.scheduled_at + make_interval(mins => coalesce(other.duration_minutes, 60))
        > p_scheduled_at
      and array_remove(array[other.home_participant_id, other.away_participant_id], null)
        && array_remove(array[v_match.home_participant_id, v_match.away_participant_id], null)
  loop
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'team_overlap', 'resourceId', v_other.id
    ));
  end loop;
  v_minimum_rest := coalesce(
    (v_version.configuration_snapshot->>'minimumRestMinutes')::integer, 720
  );
  for v_other in
    select other.id, abs(extract(epoch from (other.scheduled_at - p_scheduled_at)) / 60) as minutes
    from public.tournament_matches other
    where other.id <> v_match.id
      and other.organization_id = p_organization_id
      and other.scheduled_at is not null
      and other.status not in ('cancelled', 'completed')
      and array_remove(array[other.home_participant_id, other.away_participant_id], null)
        && array_remove(array[v_match.home_participant_id, v_match.away_participant_id], null)
      and abs(extract(epoch from (other.scheduled_at - p_scheduled_at)) / 60)
        < v_minimum_rest
  loop
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'short_rest', 'resourceId', v_other.id, 'minutes', round(v_other.minutes)
    ));
  end loop;
  if (
    select count(*) from public.tournament_matches other
    where other.id <> v_match.id
      and other.tournament_id = v_match.tournament_id
      and other.scheduled_at::date = p_scheduled_at::date
      and other.status not in ('cancelled', 'completed')
  ) >= coalesce(
    (v_version.configuration_snapshot->>'maximumMatchesPerDay')::integer, 8
  ) then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'heavy_day_load'));
  end if;
  return jsonb_build_object(
    'valid', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'bufferMinutes', v_buffer,
    'checkedAt', now()
  );
end;
$$;

create or replace function public.schedule_tournament_match(
  p_organization_id uuid,
  p_match_id uuid,
  p_scheduled_at timestamptz,
  p_venue_id uuid,
  p_court_id uuid,
  p_duration_minutes integer,
  p_override_warnings boolean default false,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_validation jsonb;
  v_reason text := btrim(coalesce(p_override_reason, ''));
begin
  if auth.uid() is null
    or not public.has_tournament_organization_capability(
      p_organization_id, 'matches.schedule'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select match_row.* into v_match
  from public.tournament_matches match_row
  join public.tournament_fixture_versions version
    on version.id = match_row.fixture_version_id
    and version.status in ('draft', 'published')
    and version.invalidated_at is null
  where match_row.id = p_match_id
    and match_row.organization_id = p_organization_id
    and match_row.status = 'unscheduled'
  for update of match_row;
  if v_match.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:schedule:court:' || p_court_id::text, 0
  ));
  v_validation := public.validate_tournament_match_schedule(
    p_organization_id, p_match_id, p_scheduled_at,
    p_venue_id, p_court_id, p_duration_minutes
  );
  if jsonb_array_length(v_validation->'blockers') > 0 then
    raise exception using errcode = '23514', message = 'TORNEOS_SCHEDULE_CONFLICT';
  end if;
  if jsonb_array_length(v_validation->'warnings') > 0 and (
    not p_override_warnings
    or char_length(v_reason) not between 3 and 500
    or not public.has_tournament_organization_capability(
      p_organization_id, 'schedule_conflicts.override'
    )
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_SCHEDULE_WARNING_CONFIRMATION';
  end if;
  update public.tournament_matches
  set scheduled_at = p_scheduled_at, venue_id = p_venue_id, court_id = p_court_id,
      duration_minutes = p_duration_minutes, status = 'scheduled',
      postponed_at = null
  where id = v_match.id;
  if p_override_warnings and jsonb_array_length(v_validation->'warnings') > 0 then
    perform public.append_tournament_audit(
      p_organization_id, 'schedule_conflicts.overridden', 'match', v_match.id,
      null, v_match.tournament_id,
      jsonb_build_object('reason', v_reason, 'warnings', v_validation->'warnings')
    );
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'match.scheduled', 'match', v_match.id,
    null, v_match.tournament_id,
    jsonb_build_object(
      'scheduledAt', p_scheduled_at, 'venueId', p_venue_id,
      'courtId', p_court_id, 'durationMinutes', p_duration_minutes
    )
  );
  return jsonb_build_object(
    'matchId', v_match.id, 'status', 'scheduled',
    'scheduledAt', p_scheduled_at, 'warnings', v_validation->'warnings'
  );
end;
$$;

create or replace function public.reschedule_tournament_match(
  p_organization_id uuid,
  p_match_id uuid,
  p_scheduled_at timestamptz,
  p_venue_id uuid,
  p_court_id uuid,
  p_duration_minutes integer,
  p_reason text,
  p_override_warnings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_validation jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or char_length(v_reason) not between 3 and 500
    or not public.has_tournament_organization_capability(
      p_organization_id, 'matches.reschedule'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select match_row.* into v_match from public.tournament_matches match_row
  join public.tournament_fixture_versions version
    on version.id = match_row.fixture_version_id
    and version.status in ('draft', 'published')
    and version.invalidated_at is null
  where match_row.id = p_match_id
    and match_row.organization_id = p_organization_id
    and match_row.status in ('scheduled', 'postponed')
  for update of match_row;
  if v_match.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:schedule:court:' || p_court_id::text, 0
  ));
  v_validation := public.validate_tournament_match_schedule(
    p_organization_id, p_match_id, p_scheduled_at,
    p_venue_id, p_court_id, p_duration_minutes
  );
  if jsonb_array_length(v_validation->'blockers') > 0 then
    raise exception using errcode = '23514', message = 'TORNEOS_SCHEDULE_CONFLICT';
  end if;
  if jsonb_array_length(v_validation->'warnings') > 0 and (
    not p_override_warnings
    or not public.has_tournament_organization_capability(
      p_organization_id, 'schedule_conflicts.override'
    )
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_SCHEDULE_WARNING_CONFIRMATION';
  end if;
  insert into public.tournament_match_reschedules (
    organization_id, tournament_id, category_id, fixture_version_id, match_id,
    previous_scheduled_at, previous_venue_id, previous_court_id,
    new_scheduled_at, new_venue_id, new_court_id, reason, actor_user_id,
    previous_status, new_status
  ) values (
    v_match.organization_id, v_match.tournament_id, v_match.category_id,
    v_match.fixture_version_id, v_match.id, v_match.scheduled_at,
    v_match.venue_id, v_match.court_id, p_scheduled_at, p_venue_id, p_court_id,
    v_reason, auth.uid(), v_match.status, 'scheduled'
  );
  update public.tournament_matches
  set scheduled_at = p_scheduled_at, venue_id = p_venue_id, court_id = p_court_id,
      duration_minutes = p_duration_minutes, status = 'scheduled', postponed_at = null
  where id = v_match.id;
  if p_override_warnings and jsonb_array_length(v_validation->'warnings') > 0 then
    perform public.append_tournament_audit(
      p_organization_id, 'schedule_conflicts.overridden', 'match', v_match.id,
      null, v_match.tournament_id,
      jsonb_build_object('reason', v_reason, 'warnings', v_validation->'warnings')
    );
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'match.rescheduled', 'match', v_match.id,
    null, v_match.tournament_id,
    jsonb_build_object(
      'reason', v_reason,
      'previousScheduledAt', v_match.scheduled_at,
      'newScheduledAt', p_scheduled_at,
      'previousVenueId', v_match.venue_id, 'newVenueId', p_venue_id,
      'previousCourtId', v_match.court_id, 'newCourtId', p_court_id
    )
  );
  return jsonb_build_object('matchId', v_match.id, 'status', 'scheduled');
end;
$$;

create or replace function public.postpone_tournament_match(
  p_organization_id uuid,
  p_match_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or char_length(v_reason) not between 3 and 500
    or not public.has_tournament_organization_capability(
      p_organization_id, 'matches.postpone'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  update public.tournament_matches
  set status = 'postponed', postponed_at = now()
  where id = p_match_id and organization_id = p_organization_id
    and status = 'scheduled'
  returning * into v_match;
  if v_match.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'match.postponed', 'match', v_match.id,
    null, v_match.tournament_id,
    jsonb_build_object(
      'reason', v_reason, 'scheduledAt', v_match.scheduled_at,
      'venueId', v_match.venue_id, 'courtId', v_match.court_id
    )
  );
  return jsonb_build_object('matchId', v_match.id, 'status', 'postponed');
end;
$$;

create or replace function public.cancel_tournament_match(
  p_organization_id uuid,
  p_match_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or char_length(v_reason) not between 3 and 500
    or not public.has_tournament_organization_capability(
      p_organization_id, 'matches.cancel'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  update public.tournament_matches
  set status = 'cancelled', cancelled_at = now()
  where id = p_match_id and organization_id = p_organization_id
    and status in ('scheduled', 'postponed')
  returning * into v_match;
  if v_match.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'match.cancelled', 'match', v_match.id,
    null, v_match.tournament_id,
    jsonb_build_object(
      'reason', v_reason, 'previousStatus',
      case when v_match.postponed_at is null then 'scheduled' else 'postponed' end
    )
  );
  return jsonb_build_object('matchId', v_match.id, 'status', 'cancelled');
end;
$$;

create or replace function public.restore_tournament_match_unscheduled(
  p_organization_id uuid,
  p_match_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or char_length(v_reason) not between 3 and 500
    or not public.has_tournament_organization_capability(
      p_organization_id, 'matches.reschedule'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select match_row.* into v_match from public.tournament_matches match_row
  where match_row.id = p_match_id and match_row.organization_id = p_organization_id
    and match_row.status = 'postponed'
  for update;
  if v_match.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  insert into public.tournament_match_reschedules (
    organization_id, tournament_id, category_id, fixture_version_id, match_id,
    previous_scheduled_at, previous_venue_id, previous_court_id,
    new_scheduled_at, new_venue_id, new_court_id, reason, actor_user_id,
    previous_status, new_status
  ) values (
    v_match.organization_id, v_match.tournament_id, v_match.category_id,
    v_match.fixture_version_id, v_match.id, v_match.scheduled_at,
    v_match.venue_id, v_match.court_id, null, null, null,
    v_reason, auth.uid(), 'postponed', 'unscheduled'
  );
  update public.tournament_matches
  set status = 'unscheduled', scheduled_at = null, venue_id = null, court_id = null,
      postponed_at = null
  where id = v_match.id;
  perform public.append_tournament_audit(
    p_organization_id, 'match.restored_unscheduled', 'match', v_match.id,
    null, v_match.tournament_id, jsonb_build_object('reason', v_reason)
  );
  return jsonb_build_object('matchId', v_match.id, 'status', 'unscheduled');
end;
$$;

create or replace function public.ready_tournament_match(
  p_organization_id uuid,
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.tournament_matches%rowtype;
begin
  if auth.uid() is null or not public.has_tournament_organization_capability(
    p_organization_id, 'matches.schedule'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  update public.tournament_matches
  set status = 'ready'
  where id = p_match_id and organization_id = p_organization_id
    and status = 'scheduled' and scheduled_at is not null
  returning * into v_match;
  if v_match.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'match.ready', 'match', v_match.id,
    null, v_match.tournament_id, '{}'::jsonb
  );
  return jsonb_build_object('matchId', v_match.id, 'status', 'ready');
end;
$$;

create or replace function public.bulk_schedule_tournament_matches(
  p_organization_id uuid,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or jsonb_typeof(p_assignments) <> 'array'
    or jsonb_array_length(p_assignments) not between 1 and 100
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_SCHEDULE_BATCH';
  end if;
  for v_assignment in select value from jsonb_array_elements(p_assignments)
  loop
    v_result := public.schedule_tournament_match(
      p_organization_id,
      (v_assignment->>'matchId')::uuid,
      (v_assignment->>'scheduledAt')::timestamptz,
      (v_assignment->>'venueId')::uuid,
      (v_assignment->>'courtId')::uuid,
      (v_assignment->>'durationMinutes')::integer,
      coalesce((v_assignment->>'overrideWarnings')::boolean, false),
      v_assignment->>'overrideReason'
    );
    v_results := v_results || jsonb_build_array(v_result);
  end loop;
  return jsonb_build_object('scheduledCount', jsonb_array_length(v_results), 'results', v_results);
end;
$$;

create or replace function public.auto_schedule_tournament_matches(
  p_organization_id uuid,
  p_fixture_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.tournament_fixture_versions%rowtype;
  v_tournament public.tournaments%rowtype;
  v_match record;
  v_candidate record;
  v_validation jsonb;
  v_scheduled integer := 0;
  v_unscheduled integer := 0;
  v_done boolean;
begin
  if auth.uid() is null or not public.has_tournament_organization_capability(
    p_organization_id, 'matches.schedule'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select version.* into v_version from public.tournament_fixture_versions version
  where version.id = p_fixture_version_id
    and version.organization_id = p_organization_id
    and version.status in ('draft', 'published')
    and version.invalidated_at is null;
  select tournament.* into v_tournament from public.tournaments tournament
  where tournament.id = v_version.tournament_id;
  if v_version.id is null or v_tournament.start_date is null or v_tournament.end_date is null
    or v_tournament.end_date - v_tournament.start_date > 366
  then
    raise exception using errcode = '23514', message = 'TORNEOS_AUTOSCHEDULE_RANGE_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:auto-schedule:' || v_version.id::text, 0
  ));
  for v_match in
    select match_row.* from public.tournament_matches match_row
    where match_row.fixture_version_id = v_version.id
      and match_row.status = 'unscheduled'
      and match_row.home_participant_id is not null
      and match_row.away_participant_id is not null
    order by match_row.round_id, match_row.match_number
  loop
    v_done := false;
    for v_candidate in
      with dates as (
        select day::date as slot_date
        from generate_series(
          v_tournament.start_date::timestamp,
          v_tournament.end_date::timestamp,
          interval '1 day'
        ) day
      )
      select
        schedule_window.venue_id,
        schedule_window.court_id,
        (
          dates.slot_date
          + schedule_window.starts_at
          + make_interval(
            mins => slot.step * (
              schedule_window.slot_duration_minutes + schedule_window.buffer_minutes
            )
          )
        ) at time zone venue.timezone as scheduled_at,
        schedule_window.slot_duration_minutes as duration_minutes
      from public.tournament_schedule_windows schedule_window
      join public.tournament_venues venue
        on venue.id = schedule_window.venue_id and venue.status = 'active'
      join public.tournament_courts court
        on court.id = schedule_window.court_id and court.status = 'active'
      cross join dates
      cross join lateral generate_series(
        0,
        greatest(
          floor(
            extract(epoch from (
              schedule_window.ends_at - schedule_window.starts_at
            )) / 60
            / (
              schedule_window.slot_duration_minutes + schedule_window.buffer_minutes
            )
          )::integer - 1,
          0
        )
      ) slot(step)
      where schedule_window.organization_id = p_organization_id
        and schedule_window.tournament_id = v_version.tournament_id
        and schedule_window.status = 'active'
        and schedule_window.window_type = 'availability'
        and schedule_window.court_id is not null
        and (
          schedule_window.category_id is null
          or schedule_window.category_id = v_version.category_id
        )
        and (
          schedule_window.specific_date = dates.slot_date
          or schedule_window.day_of_week = extract(isodow from dates.slot_date)::smallint
        )
        and court.sport_modality = v_tournament.sport_modality
      order by scheduled_at, schedule_window.court_id
    loop
      v_validation := public.validate_tournament_match_schedule(
        p_organization_id, v_match.id, v_candidate.scheduled_at,
        v_candidate.venue_id, v_candidate.court_id, v_candidate.duration_minutes
      );
      if jsonb_array_length(v_validation->'blockers') = 0
        and jsonb_array_length(v_validation->'warnings') = 0
      then
        perform public.schedule_tournament_match(
          p_organization_id, v_match.id, v_candidate.scheduled_at,
          v_candidate.venue_id, v_candidate.court_id, v_candidate.duration_minutes,
          false, null
        );
        v_scheduled := v_scheduled + 1;
        v_done := true;
        exit;
      end if;
    end loop;
    if not v_done then v_unscheduled := v_unscheduled + 1; end if;
  end loop;
  perform public.append_tournament_audit(
    p_organization_id, 'matches.auto_scheduled', 'fixture_version', v_version.id,
    null, v_version.tournament_id,
    jsonb_build_object('scheduledCount', v_scheduled, 'unscheduledCount', v_unscheduled)
  );
  return jsonb_build_object(
    'fixtureVersionId', v_version.id,
    'scheduledCount', v_scheduled,
    'unscheduledCount', v_unscheduled
  );
end;
$$;

create or replace function public.can_read_tournament_match(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournament_matches match_row
    join public.tournament_organizations organization
      on organization.id = match_row.organization_id
    join public.tournaments tournament on tournament.id = match_row.tournament_id
    where match_row.id = p_match_id
      and organization.status = 'active'
      and tournament.status <> 'archived'
      and (
        public.has_tournament_organization_capability(
          match_row.organization_id, 'matches.read'
        )
        or exists (
          select 1
          from public.tournament_competition_participants participant
          join public.tournament_team_managers manager
            on manager.team_entry_id = participant.team_entry_id
            and manager.organization_id = participant.organization_id
          where participant.id in (
              match_row.home_participant_id,
              match_row.away_participant_id
            )
            and manager.user_id = auth.uid()
            and manager.status = 'active'
        )
      )
  );
$$;

create or replace function public.get_tournament_fixture_context(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_manager boolean;
begin
  if auth.uid() is null or not public.can_read_tournament_fixture_scope(
    p_organization_id, p_tournament_id
  ) or not exists (
    select 1 from public.tournament_categories category
    where category.id = p_category_id
      and category.organization_id = p_organization_id
      and category.tournament_id = p_tournament_id
      and category.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  v_is_manager := not public.has_tournament_organization_capability(
    p_organization_id, 'fixture.read'
  );
  return jsonb_build_object(
    'participantSet', (
      select jsonb_build_object(
        'id', participant_set.id,
        'versionNumber', participant_set.version_number,
        'status', participant_set.status,
        'participantFingerprint', participant_set.participant_fingerprint,
        'frozenAt', participant_set.frozen_at,
        'invalidatedAt', participant_set.invalidated_at
      )
      from public.tournament_participant_sets participant_set
      where participant_set.organization_id = p_organization_id
        and participant_set.tournament_id = p_tournament_id
        and participant_set.category_id = p_category_id
        and participant_set.status in ('frozen', 'reopened')
      order by participant_set.version_number desc limit 1
    ),
    'eligibleEntries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', entry.id, 'name', entry.name, 'shortName', entry.short_name,
        'shieldPath', entry.shield_path, 'primaryColor', entry.primary_color,
        'secondaryColor', entry.secondary_color, 'status', entry.status,
        'categoryId', entry.category_id
      ) order by entry.name, entry.id)
      from public.tournament_team_entries entry
      where entry.organization_id = p_organization_id
        and entry.tournament_id = p_tournament_id
        and entry.category_id = p_category_id
        and entry.status in ('approved', 'withdrawn')
        and (
          not v_is_manager
          or public.is_tournament_team_manager(entry.id, false)
        )
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', participant.id, 'teamEntryId', participant.team_entry_id,
        'name', participant.snapshot_name, 'shortName', participant.snapshot_short_name,
        'shieldPath', participant.snapshot_shield_path,
        'primaryColor', participant.snapshot_primary_color,
        'secondaryColor', participant.snapshot_secondary_color,
        'seedNumber', participant.seed_number, 'potNumber', participant.pot_number,
        'status', participant.status
      ) order by participant.seed_number nulls last, participant.snapshot_name, participant.id)
      from public.tournament_competition_participants participant
      join public.tournament_participant_sets participant_set
        on participant_set.id = participant.participant_set_id
      where participant.organization_id = p_organization_id
        and participant.tournament_id = p_tournament_id
        and participant.category_id = p_category_id
        and participant_set.status in ('frozen', 'reopened')
        and (
          not v_is_manager
          or public.is_tournament_team_manager(participant.team_entry_id, false)
        )
    ), '[]'::jsonb),
    'pots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pot.id, 'name', pot.name, 'number', pot.number,
        'sortOrder', pot.sort_order, 'status', pot.status,
        'members', coalesce((
          select jsonb_agg(jsonb_build_object(
            'participantId', member.participant_id, 'seedNumber', member.seed_number
          ) order by member.seed_number nulls last, member.participant_id)
          from public.tournament_draw_pot_members member where member.pot_id = pot.id
        ), '[]'::jsonb)
      ) order by pot.sort_order, pot.number)
      from public.tournament_draw_pots pot
      join public.tournament_participant_sets participant_set
        on participant_set.id = pot.participant_set_id
      where pot.organization_id = p_organization_id
        and pot.tournament_id = p_tournament_id
        and pot.category_id = p_category_id
        and pot.status = 'active' and participant_set.status = 'frozen'
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', group_row.id, 'fixtureVersionId', group_row.fixture_version_id,
        'phaseId', group_row.phase_id, 'name', group_row.name, 'code', group_row.code,
        'sortOrder', group_row.sort_order, 'status', group_row.status,
        'drawSeed', group_row.draw_seed,
        'members', coalesce((
          select jsonb_agg(jsonb_build_object(
            'participantId', member.participant_id, 'positionSeed', member.position_seed
          ) order by member.position_seed nulls last, member.participant_id)
          from public.tournament_group_members member where member.group_id = group_row.id
        ), '[]'::jsonb)
      ) order by group_row.fixture_version_id nulls first, group_row.sort_order, group_row.code)
      from public.tournament_groups group_row
      where group_row.organization_id = p_organization_id
        and group_row.tournament_id = p_tournament_id
        and group_row.category_id = p_category_id
        and group_row.status <> 'archived'
    ), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', version.id, 'versionNumber', version.version_number,
        'status', version.status, 'generationMethod', version.generation_method,
        'seed', version.seed, 'configurationSnapshot', version.configuration_snapshot,
        'createdAt', version.created_at, 'publishedAt', version.published_at,
        'invalidatedAt', version.invalidated_at,
        'phaseCount', (select count(*) from public.tournament_phases phase
          where phase.fixture_version_id = version.id),
        'roundCount', (select count(*) from public.tournament_rounds round_row
          where round_row.fixture_version_id = version.id),
        'matchCount', (select count(*) from public.tournament_matches match_row
          where match_row.fixture_version_id = version.id),
        'scheduledCount', (select count(*) from public.tournament_matches match_row
          where match_row.fixture_version_id = version.id
            and match_row.status in ('scheduled', 'ready'))
      ) order by version.version_number desc)
      from public.tournament_fixture_versions version
      where version.organization_id = p_organization_id
        and version.tournament_id = p_tournament_id
        and version.category_id = p_category_id
        and version.status <> 'archived'
    ), '[]'::jsonb),
    'phases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', phase.id, 'fixtureVersionId', phase.fixture_version_id,
        'name', phase.name, 'phaseType', phase.phase_type,
        'sequenceNumber', phase.sequence_number, 'status', phase.status,
        'configuration', phase.configuration
      ) order by phase.fixture_version_id, phase.sequence_number)
      from public.tournament_phases phase
      join public.tournament_fixture_versions version
        on version.id = phase.fixture_version_id
      where version.organization_id = p_organization_id
        and version.tournament_id = p_tournament_id
        and version.category_id = p_category_id
        and version.status <> 'archived'
    ), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', round_row.id, 'fixtureVersionId', round_row.fixture_version_id,
        'phaseId', round_row.phase_id, 'groupId', round_row.group_id,
        'roundNumber', round_row.round_number, 'name', round_row.name,
        'status', round_row.status, 'startsAt', round_row.starts_at,
        'endsAt', round_row.ends_at, 'sortOrder', round_row.sort_order
      ) order by round_row.fixture_version_id, round_row.sort_order, round_row.round_number)
      from public.tournament_rounds round_row
      join public.tournament_fixture_versions version
        on version.id = round_row.fixture_version_id
      where version.organization_id = p_organization_id
        and version.tournament_id = p_tournament_id
        and version.category_id = p_category_id
        and version.status <> 'archived'
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', match_row.id, 'fixtureVersionId', match_row.fixture_version_id,
        'phaseId', match_row.phase_id, 'groupId', match_row.group_id,
        'roundId', match_row.round_id, 'matchNumber', match_row.match_number,
        'legNumber', match_row.leg_number, 'tieKey', match_row.tie_key,
        'homeParticipantId', match_row.home_participant_id,
        'awayParticipantId', match_row.away_participant_id,
        'status', match_row.status, 'scheduledAt', match_row.scheduled_at,
        'venueId', match_row.venue_id, 'courtId', match_row.court_id,
        'durationMinutes', match_row.duration_minutes,
        'sources', coalesce((
          select jsonb_agg(jsonb_build_object(
            'side', source.side, 'type', source.source_type,
            'participantId', source.participant_id, 'matchId', source.source_match_id,
            'groupId', source.group_id, 'positionNumber', source.position_number,
            'seedNumber', source.seed_number, 'rankNumber', source.rank_number
          ) order by source.side)
          from public.tournament_match_sources source where source.match_id = match_row.id
        ), '[]'::jsonb)
      ) order by match_row.fixture_version_id, match_row.match_number)
      from public.tournament_matches match_row
      join public.tournament_fixture_versions version
        on version.id = match_row.fixture_version_id
      where version.organization_id = p_organization_id
        and version.tournament_id = p_tournament_id
        and version.category_id = p_category_id
        and version.status <> 'archived'
        and (not v_is_manager or public.can_read_tournament_match(match_row.id))
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_tournament_schedule_context(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_read_tournament_fixture_scope(
    p_organization_id, p_tournament_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  return jsonb_build_object(
    'venues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', venue.id, 'name', venue.name, 'address', venue.address,
        'placeId', venue.place_id, 'latitude', venue.latitude,
        'longitude', venue.longitude, 'locality', venue.locality,
        'timezone', venue.timezone, 'status', venue.status, 'notes', venue.notes
      ) order by venue.status, venue.name)
      from public.tournament_venues venue
      where venue.organization_id = p_organization_id
    ), '[]'::jsonb),
    'courts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', court.id, 'venueId', court.venue_id, 'name', court.name,
        'sportModality', court.sport_modality, 'status', court.status,
        'notes', court.notes
      ) order by court.status, court.name)
      from public.tournament_courts court
      where court.organization_id = p_organization_id
    ), '[]'::jsonb),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', schedule_window.id, 'categoryId', schedule_window.category_id,
        'venueId', schedule_window.venue_id, 'courtId', schedule_window.court_id,
        'dayOfWeek', schedule_window.day_of_week,
        'specificDate', schedule_window.specific_date,
        'startsAt', schedule_window.starts_at, 'endsAt', schedule_window.ends_at,
        'slotDurationMinutes', schedule_window.slot_duration_minutes,
        'bufferMinutes', schedule_window.buffer_minutes,
        'windowType', schedule_window.window_type,
        'status', schedule_window.status, 'notes', schedule_window.notes
      ) order by schedule_window.status, schedule_window.specific_date nulls last,
        schedule_window.day_of_week, schedule_window.starts_at)
      from public.tournament_schedule_windows schedule_window
      where schedule_window.organization_id = p_organization_id
        and schedule_window.tournament_id = p_tournament_id
    ), '[]'::jsonb),
    'reschedules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', reschedule.id, 'matchId', reschedule.match_id,
        'previousScheduledAt', reschedule.previous_scheduled_at,
        'newScheduledAt', reschedule.new_scheduled_at,
        'previousVenueId', reschedule.previous_venue_id,
        'newVenueId', reschedule.new_venue_id,
        'previousCourtId', reschedule.previous_court_id,
        'newCourtId', reschedule.new_court_id,
        'reason', reschedule.reason, 'previousStatus', reschedule.previous_status,
        'newStatus', reschedule.new_status, 'createdAt', reschedule.created_at
      ) order by reschedule.created_at desc)
      from public.tournament_match_reschedules reschedule
      join public.tournament_matches match_row on match_row.id = reschedule.match_id
      where reschedule.organization_id = p_organization_id
        and reschedule.tournament_id = p_tournament_id
        and reschedule.category_id = p_category_id
        and public.can_read_tournament_match(match_row.id)
    ), '[]'::jsonb)
  );
end;
$$;

alter table public.tournament_participant_sets enable row level security;
alter table public.tournament_competition_participants enable row level security;
alter table public.tournament_draw_pots enable row level security;
alter table public.tournament_draw_pot_members enable row level security;
alter table public.tournament_fixture_versions enable row level security;
alter table public.tournament_phases enable row level security;
alter table public.tournament_groups enable row level security;
alter table public.tournament_group_members enable row level security;
alter table public.tournament_rounds enable row level security;
alter table public.tournament_venues enable row level security;
alter table public.tournament_courts enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.tournament_match_sources enable row level security;
alter table public.tournament_schedule_windows enable row level security;
alter table public.tournament_match_reschedules enable row level security;

create policy tournament_participant_sets_select_scope
on public.tournament_participant_sets for select to authenticated
using (public.can_read_tournament_fixture_scope(organization_id, tournament_id));

create policy tournament_competition_participants_select_scope
on public.tournament_competition_participants for select to authenticated
using (
  public.has_tournament_organization_capability(organization_id, 'participants.read')
  or public.is_tournament_team_manager(team_entry_id, false)
);

create policy tournament_draw_pots_select_scope
on public.tournament_draw_pots for select to authenticated
using (public.can_read_tournament_fixture_scope(organization_id, tournament_id));

create policy tournament_draw_pot_members_select_scope
on public.tournament_draw_pot_members for select to authenticated
using (exists (
  select 1 from public.tournament_draw_pots pot
  where pot.id = pot_id
    and public.can_read_tournament_fixture_scope(pot.organization_id, pot.tournament_id)
));

create policy tournament_fixture_versions_select_scope
on public.tournament_fixture_versions for select to authenticated
using (public.can_read_tournament_fixture_scope(organization_id, tournament_id));

create policy tournament_phases_select_scope
on public.tournament_phases for select to authenticated
using (public.can_read_tournament_fixture_scope(organization_id, tournament_id));

create policy tournament_groups_select_scope
on public.tournament_groups for select to authenticated
using (public.can_read_tournament_fixture_scope(organization_id, tournament_id));

create policy tournament_group_members_select_scope
on public.tournament_group_members for select to authenticated
using (exists (
  select 1 from public.tournament_groups group_row
  where group_row.id = group_id
    and public.can_read_tournament_fixture_scope(
      group_row.organization_id, group_row.tournament_id
    )
));

create policy tournament_rounds_select_scope
on public.tournament_rounds for select to authenticated
using (public.can_read_tournament_fixture_scope(organization_id, tournament_id));

create policy tournament_matches_select_scope
on public.tournament_matches for select to authenticated
using (public.can_read_tournament_match(id));

create policy tournament_match_sources_select_scope
on public.tournament_match_sources for select to authenticated
using (public.can_read_tournament_match(match_id));

create policy tournament_venues_select_scope
on public.tournament_venues for select to authenticated
using (
  public.has_tournament_organization_capability(organization_id, 'venues.read')
  or exists (
    select 1 from public.tournament_matches match_row
    where match_row.venue_id = id and public.can_read_tournament_match(match_row.id)
  )
);

create policy tournament_courts_select_scope
on public.tournament_courts for select to authenticated
using (
  public.has_tournament_organization_capability(organization_id, 'courts.read')
  or exists (
    select 1 from public.tournament_matches match_row
    where match_row.court_id = id and public.can_read_tournament_match(match_row.id)
  )
);

create policy tournament_schedule_windows_select_scope
on public.tournament_schedule_windows for select to authenticated
using (
  public.has_tournament_organization_capability(
    organization_id, 'schedule_windows.read'
  )
);

create policy tournament_match_reschedules_select_scope
on public.tournament_match_reschedules for select to authenticated
using (public.can_read_tournament_match(match_id));

revoke all on table public.tournament_participant_sets from anon, authenticated;
revoke all on table public.tournament_competition_participants from anon, authenticated;
revoke all on table public.tournament_draw_pots from anon, authenticated;
revoke all on table public.tournament_draw_pot_members from anon, authenticated;
revoke all on table public.tournament_fixture_versions from anon, authenticated;
revoke all on table public.tournament_phases from anon, authenticated;
revoke all on table public.tournament_groups from anon, authenticated;
revoke all on table public.tournament_group_members from anon, authenticated;
revoke all on table public.tournament_rounds from anon, authenticated;
revoke all on table public.tournament_venues from anon, authenticated;
revoke all on table public.tournament_courts from anon, authenticated;
revoke all on table public.tournament_matches from anon, authenticated;
revoke all on table public.tournament_match_sources from anon, authenticated;
revoke all on table public.tournament_schedule_windows from anon, authenticated;
revoke all on table public.tournament_match_reschedules from anon, authenticated;

grant select on public.tournament_participant_sets to authenticated;
grant select on public.tournament_competition_participants to authenticated;
grant select on public.tournament_draw_pots to authenticated;
grant select on public.tournament_draw_pot_members to authenticated;
grant select on public.tournament_fixture_versions to authenticated;
grant select on public.tournament_phases to authenticated;
grant select on public.tournament_groups to authenticated;
grant select on public.tournament_group_members to authenticated;
grant select on public.tournament_rounds to authenticated;
grant select on public.tournament_venues to authenticated;
grant select on public.tournament_courts to authenticated;
grant select on public.tournament_matches to authenticated;
grant select on public.tournament_match_sources to authenticated;
grant select on public.tournament_schedule_windows to authenticated;
grant select on public.tournament_match_reschedules to authenticated;

revoke all on function public.can_read_tournament_fixture_scope(uuid, uuid) from public, anon;
revoke all on function public.validate_tournament_fixture_member_scope() from public, anon;
revoke all on function public.validate_tournament_match_scope() from public, anon;
revoke all on function public.validate_tournament_match_source_scope() from public, anon;
revoke all on function public.assert_tournament_fixture_scope(uuid, uuid, uuid, text, text[]) from public, anon;
revoke all on function public.freeze_tournament_participants(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.reopen_tournament_participants(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.save_tournament_draw_pots(uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.execute_tournament_group_draw(uuid, uuid, uuid, integer, text, boolean) from public, anon;
revoke all on function public.insert_tournament_match_source(uuid, text, jsonb) from public, anon;
revoke all on function public.build_tournament_round_robin(uuid, uuid, uuid, uuid[], boolean) from public, anon;
revoke all on function public.build_tournament_knockout(uuid, uuid, jsonb, boolean, boolean) from public, anon;
revoke all on function public.generate_tournament_fixture(uuid, uuid, uuid, text, jsonb, uuid) from public, anon;
revoke all on function public.create_manual_fixture_version(uuid, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.update_draft_fixture(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.validate_tournament_fixture(uuid, uuid) from public, anon;
revoke all on function public.publish_tournament_fixture(uuid, uuid) from public, anon;
revoke all on function public.archive_tournament_fixture(uuid, uuid, text) from public, anon;
revoke all on function public.supersede_tournament_fixture(uuid, uuid, uuid) from public, anon;
revoke all on function public.create_tournament_venue(uuid, text, text, text, double precision, double precision, text, text, text) from public, anon;
revoke all on function public.update_tournament_venue(uuid, uuid, jsonb) from public, anon;
revoke all on function public.create_tournament_court(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.update_tournament_court(uuid, uuid, jsonb) from public, anon;
revoke all on function public.save_tournament_schedule_windows(uuid, uuid, jsonb) from public, anon;
revoke all on function public.validate_tournament_match_schedule(uuid, uuid, timestamptz, uuid, uuid, integer) from public, anon;
revoke all on function public.schedule_tournament_match(uuid, uuid, timestamptz, uuid, uuid, integer, boolean, text) from public, anon;
revoke all on function public.reschedule_tournament_match(uuid, uuid, timestamptz, uuid, uuid, integer, text, boolean) from public, anon;
revoke all on function public.postpone_tournament_match(uuid, uuid, text) from public, anon;
revoke all on function public.cancel_tournament_match(uuid, uuid, text) from public, anon;
revoke all on function public.restore_tournament_match_unscheduled(uuid, uuid, text) from public, anon;
revoke all on function public.ready_tournament_match(uuid, uuid) from public, anon;
revoke all on function public.bulk_schedule_tournament_matches(uuid, jsonb) from public, anon;
revoke all on function public.auto_schedule_tournament_matches(uuid, uuid) from public, anon;
revoke all on function public.can_read_tournament_match(uuid) from public, anon;
revoke all on function public.get_tournament_fixture_context(uuid, uuid, uuid) from public, anon;
revoke all on function public.get_tournament_schedule_context(uuid, uuid, uuid) from public, anon;

grant execute on function public.can_read_tournament_fixture_scope(uuid, uuid) to authenticated;
grant execute on function public.can_read_tournament_match(uuid) to authenticated;
grant execute on function public.freeze_tournament_participants(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.reopen_tournament_participants(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.save_tournament_draw_pots(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.execute_tournament_group_draw(uuid, uuid, uuid, integer, text, boolean) to authenticated;
grant execute on function public.generate_tournament_fixture(uuid, uuid, uuid, text, jsonb, uuid) to authenticated;
grant execute on function public.create_manual_fixture_version(uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.update_draft_fixture(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.validate_tournament_fixture(uuid, uuid) to authenticated;
grant execute on function public.publish_tournament_fixture(uuid, uuid) to authenticated;
grant execute on function public.archive_tournament_fixture(uuid, uuid, text) to authenticated;
grant execute on function public.supersede_tournament_fixture(uuid, uuid, uuid) to authenticated;
grant execute on function public.create_tournament_venue(uuid, text, text, text, double precision, double precision, text, text, text) to authenticated;
grant execute on function public.update_tournament_venue(uuid, uuid, jsonb) to authenticated;
grant execute on function public.create_tournament_court(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.update_tournament_court(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_tournament_schedule_windows(uuid, uuid, jsonb) to authenticated;
grant execute on function public.validate_tournament_match_schedule(uuid, uuid, timestamptz, uuid, uuid, integer) to authenticated;
grant execute on function public.schedule_tournament_match(uuid, uuid, timestamptz, uuid, uuid, integer, boolean, text) to authenticated;
grant execute on function public.reschedule_tournament_match(uuid, uuid, timestamptz, uuid, uuid, integer, text, boolean) to authenticated;
grant execute on function public.postpone_tournament_match(uuid, uuid, text) to authenticated;
grant execute on function public.cancel_tournament_match(uuid, uuid, text) to authenticated;
grant execute on function public.restore_tournament_match_unscheduled(uuid, uuid, text) to authenticated;
grant execute on function public.ready_tournament_match(uuid, uuid) to authenticated;
grant execute on function public.bulk_schedule_tournament_matches(uuid, jsonb) to authenticated;
grant execute on function public.auto_schedule_tournament_matches(uuid, uuid) to authenticated;
grant execute on function public.get_tournament_fixture_context(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_tournament_schedule_context(uuid, uuid, uuid) to authenticated;

grant usage, select on sequence public.tournament_match_reschedules_id_seq to service_role;
