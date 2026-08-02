-- Arma2 Torneos: seasons and competition configuration core.
-- Local/dedicated staging only. Do not apply to the Arma2 production project.

create table public.tournament_sport_modalities (
  code text primary key,
  name text not null unique,
  team_size smallint not null,
  recommended_substitutes smallint not null,
  team_of_round_size smallint not null,
  suggested_duration_minutes smallint not null,
  requires_goalkeeper boolean not null default true,
  constraint tournament_sport_modalities_code_check
    check (code ~ '^football_(5|6|7|8|9|11)$'),
  constraint tournament_sport_modalities_values_check
    check (
      team_size between 5 and 11
      and recommended_substitutes between 0 and 15
      and team_of_round_size between 5 and 11
      and suggested_duration_minutes between 20 and 120
    )
);

insert into public.tournament_sport_modalities (
  code,
  name,
  team_size,
  recommended_substitutes,
  team_of_round_size,
  suggested_duration_minutes,
  requires_goalkeeper
)
values
  ('football_5', 'Fútbol 5', 5, 3, 5, 40, true),
  ('football_6', 'Fútbol 6', 6, 4, 6, 50, true),
  ('football_7', 'Fútbol 7', 7, 5, 7, 50, true),
  ('football_8', 'Fútbol 8', 8, 5, 8, 60, true),
  ('football_9', 'Fútbol 9', 9, 6, 9, 70, true),
  ('football_11', 'Fútbol 11', 11, 7, 11, 90, true);

create table public.tournament_competition_formats (
  code text primary key,
  name text not null unique,
  description text not null,
  constraint tournament_competition_formats_code_check
    check (
      code in (
        'league',
        'knockout',
        'groups',
        'groups_and_playoffs',
        'league_and_playoffs'
      )
    ),
  constraint tournament_competition_formats_description_check
    check (char_length(description) between 10 and 240)
);

insert into public.tournament_competition_formats (code, name, description)
values
  ('league', 'Liga', 'Todos compiten por puntos en una o dos ruedas.'),
  ('knockout', 'Eliminación directa', 'Cruces eliminatorios a partido único o ida y vuelta.'),
  ('groups', 'Fase de grupos', 'Grupos independientes con clasificación por puntos.'),
  ('groups_and_playoffs', 'Grupos y playoffs', 'Una fase de grupos clasifica a una etapa eliminatoria.'),
  ('league_and_playoffs', 'Liga y playoffs', 'Una liga general clasifica a una etapa eliminatoria.');

create table public.tournament_seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.tournament_organizations(id) on delete restrict,
  name text not null,
  slug text not null,
  status text not null default 'draft',
  start_date date,
  end_date date,
  created_by uuid not null references auth.users(id) on delete restrict,
  creation_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tournament_seasons_name_check
    check (name = btrim(name) and char_length(name) between 3 and 80),
  constraint tournament_seasons_slug_check
    check (
      slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'
      and char_length(slug) between 3 and 48
    ),
  constraint tournament_seasons_status_check
    check (status in ('draft', 'active', 'completed', 'archived')),
  constraint tournament_seasons_dates_check
    check (start_date is null or end_date is null or end_date >= start_date),
  constraint tournament_seasons_archive_state_check
    check (
      (status = 'archived' and archived_at is not null)
      or (status <> 'archived' and archived_at is null)
    ),
  constraint tournament_seasons_org_id_unique unique (organization_id, id),
  constraint tournament_seasons_slug_unique unique (organization_id, slug),
  constraint tournament_seasons_creation_unique
    unique (organization_id, created_by, creation_key)
);

create index tournament_seasons_org_status_idx
  on public.tournament_seasons (organization_id, status, updated_at desc);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  name text not null,
  slug text not null,
  description text,
  status text not null default 'draft',
  sport_modality text not null
    references public.tournament_sport_modalities(code) on delete restrict,
  competition_format text not null
    references public.tournament_competition_formats(code) on delete restrict,
  gender_category text not null default 'open',
  team_size smallint not null,
  substitutes_limit smallint,
  start_date date,
  end_date date,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  format_settings jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  creation_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tournaments_season_fk
    foreign key (organization_id, season_id)
    references public.tournament_seasons(organization_id, id) on delete restrict,
  constraint tournaments_name_check
    check (name = btrim(name) and char_length(name) between 3 and 100),
  constraint tournaments_slug_check
    check (
      slug ~ '^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$'
      and char_length(slug) between 3 and 64
    ),
  constraint tournaments_description_check
    check (description is null or char_length(description) <= 1200),
  constraint tournaments_status_check
    check (
      status in (
        'draft',
        'registration',
        'scheduled',
        'active',
        'completed',
        'archived'
      )
    ),
  constraint tournaments_gender_check
    check (gender_category in ('male', 'female', 'mixed', 'open')),
  constraint tournaments_roster_limits_check
    check (
      team_size between 5 and 11
      and (substitutes_limit is null or substitutes_limit between 0 and 30)
    ),
  constraint tournaments_dates_check
    check (start_date is null or end_date is null or end_date >= start_date),
  constraint tournaments_registration_dates_check
    check (
      registration_opens_at is null
      or registration_closes_at is null
      or registration_closes_at >= registration_opens_at
    ),
  constraint tournaments_format_settings_object_check
    check (jsonb_typeof(format_settings) = 'object'),
  constraint tournaments_archive_state_check
    check (
      (status = 'archived' and archived_at is not null)
      or (status <> 'archived' and archived_at is null)
    ),
  constraint tournaments_org_id_unique unique (organization_id, id),
  constraint tournaments_org_id_season_unique
    unique (organization_id, id, season_id),
  constraint tournaments_slug_unique unique (season_id, slug),
  constraint tournaments_creation_unique
    unique (organization_id, created_by, creation_key)
);

create index tournaments_org_season_status_idx
  on public.tournaments (organization_id, season_id, status, updated_at desc);

create table public.tournament_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  name text not null,
  slug text not null,
  description text,
  status text not null default 'active',
  sort_order integer not null default 0,
  min_age smallint,
  max_age smallint,
  gender_category text,
  sport_modality text
    references public.tournament_sport_modalities(code) on delete restrict,
  team_size smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tournament_categories_tournament_fk
    foreign key (organization_id, tournament_id)
    references public.tournaments(organization_id, id) on delete restrict,
  constraint tournament_categories_name_check
    check (name = btrim(name) and char_length(name) between 2 and 80),
  constraint tournament_categories_slug_check
    check (
      slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])$'
      and char_length(slug) between 2 and 48
    ),
  constraint tournament_categories_description_check
    check (description is null or char_length(description) <= 600),
  constraint tournament_categories_status_check
    check (status in ('active', 'archived')),
  constraint tournament_categories_age_check
    check (
      (min_age is null or min_age between 5 and 99)
      and (max_age is null or max_age between 5 and 99)
      and (min_age is null or max_age is null or max_age >= min_age)
    ),
  constraint tournament_categories_gender_check
    check (
      gender_category is null
      or gender_category in ('male', 'female', 'mixed', 'open')
    ),
  constraint tournament_categories_team_size_check
    check (team_size is null or team_size between 5 and 11),
  constraint tournament_categories_archive_state_check
    check (
      (status = 'archived' and archived_at is not null)
      or (status = 'active' and archived_at is null)
    ),
  constraint tournament_categories_slug_unique unique (tournament_id, slug),
  constraint tournament_categories_org_id_unique
    unique (organization_id, id)
);

create index tournament_categories_active_order_idx
  on public.tournament_categories (tournament_id, sort_order, created_at)
  where status = 'active';

create table public.tournament_scoring_rules (
  tournament_id uuid primary key,
  organization_id uuid not null,
  points_win smallint not null default 3,
  points_draw smallint not null default 1,
  points_loss smallint not null default 0,
  points_walkover_win smallint,
  points_walkover_loss smallint,
  allow_manual_points_adjustment boolean not null default false,
  allow_administrative_result boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_scoring_rules_tournament_fk
    foreign key (organization_id, tournament_id)
    references public.tournaments(organization_id, id) on delete restrict,
  constraint tournament_scoring_rules_points_check
    check (
      points_win between -10 and 20
      and points_draw between -10 and 20
      and points_loss between -10 and 20
      and (points_walkover_win is null or points_walkover_win between -10 and 20)
      and (points_walkover_loss is null or points_walkover_loss between -10 and 20)
    )
);

create table public.tournament_tiebreak_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  criterion text not null,
  sort_order smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_tiebreak_rules_tournament_fk
    foreign key (organization_id, tournament_id)
    references public.tournaments(organization_id, id) on delete restrict,
  constraint tournament_tiebreak_rules_criterion_check
    check (
      criterion in (
        'goal_difference',
        'goals_for',
        'head_to_head',
        'matches_won',
        'fair_play',
        'playoff_match',
        'draw'
      )
    ),
  constraint tournament_tiebreak_rules_order_check
    check (sort_order between 1 and 7),
  constraint tournament_tiebreak_rules_criterion_unique
    unique (tournament_id, criterion),
  constraint tournament_tiebreak_rules_order_unique
    unique (tournament_id, sort_order)
);

create index tournament_tiebreak_rules_order_idx
  on public.tournament_tiebreak_rules (tournament_id, sort_order);

create table public.tournament_discipline_rules (
  tournament_id uuid primary key,
  organization_id uuid not null,
  yellows_for_suspension smallint not null default 5,
  suspension_matches smallint not null default 1,
  direct_red_suggested_matches smallint,
  double_yellow_counts_as_red boolean not null default true,
  reset_yellows_each_stage boolean not null default false,
  fair_play_enabled boolean not null default true,
  yellow_fair_play_points smallint not null default 1,
  red_fair_play_points smallint not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_discipline_rules_tournament_fk
    foreign key (organization_id, tournament_id)
    references public.tournaments(organization_id, id) on delete restrict,
  constraint tournament_discipline_rules_values_check
    check (
      yellows_for_suspension between 1 and 20
      and suspension_matches between 1 and 12
      and (
        direct_red_suggested_matches is null
        or direct_red_suggested_matches between 1 and 12
      )
      and yellow_fair_play_points between 0 and 20
      and red_fair_play_points between 0 and 40
    )
);

create table public.user_tournament_context_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null
    references public.tournament_organizations(id) on delete cascade,
  active_season_id uuid,
  active_tournament_id uuid,
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id),
  constraint user_tournament_context_season_fk
    foreign key (organization_id, active_season_id)
    references public.tournament_seasons(organization_id, id) on delete restrict,
  constraint user_tournament_context_tournament_fk
    foreign key (organization_id, active_tournament_id, active_season_id)
    references public.tournaments(organization_id, id, season_id) on delete restrict,
  constraint user_tournament_context_tournament_requires_season
    check (active_tournament_id is null or active_season_id is not null)
);

create index user_tournament_context_active_season_idx
  on public.user_tournament_context_preferences (active_season_id)
  where active_season_id is not null;

create index user_tournament_context_active_tournament_idx
  on public.user_tournament_context_preferences (active_tournament_id)
  where active_tournament_id is not null;

create or replace function public.tournament_role_capabilities(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then array[
      'organization.read',
      'organization.update',
      'organization.archive',
      'members.read',
      'members.invite',
      'members.update_role',
      'members.remove',
      'workspace.access',
      'workspace.manage',
      'seasons.read',
      'seasons.create',
      'seasons.update',
      'seasons.archive',
      'tournaments.read',
      'tournaments.create',
      'tournaments.update',
      'tournaments.change_status',
      'tournaments.archive',
      'categories.read',
      'categories.create',
      'categories.update',
      'categories.archive',
      'competition_rules.read',
      'competition_rules.update'
    ]::text[]
    when 'admin' then array[
      'organization.read',
      'organization.update',
      'members.read',
      'members.invite',
      'members.update_role',
      'members.remove',
      'workspace.access',
      'workspace.manage',
      'seasons.read',
      'seasons.create',
      'seasons.update',
      'seasons.archive',
      'tournaments.read',
      'tournaments.create',
      'tournaments.update',
      'tournaments.change_status',
      'tournaments.archive',
      'categories.read',
      'categories.create',
      'categories.update',
      'categories.archive',
      'competition_rules.read',
      'competition_rules.update'
    ]::text[]
    when 'collaborator' then array[
      'organization.read',
      'members.read',
      'workspace.access',
      'seasons.read',
      'tournaments.read',
      'categories.read',
      'competition_rules.read'
    ]::text[]
    else array[]::text[]
  end;
$$;

create or replace function public.normalize_tournament_competition_slug(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    regexp_replace(
      translate(
        lower(btrim(coalesce(p_value, ''))),
        'áéíóúüñ',
        'aeiouun'
      ),
      '[^a-z0-9]+',
      '-',
      'g'
    ),
    '-+', '-', 'g'
  ));
$$;

create or replace function public.is_valid_tournament_format_settings(
  p_format text,
  p_settings jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_settings) <> 'object' then
    return false;
  end if;

  case p_format
    when 'league' then
      if not (
        p_settings ?& array['rounds', 'qualifiers']
        and not exists (
          select 1 from jsonb_object_keys(p_settings) key
          where key not in ('rounds', 'qualifiers')
        )
        and jsonb_typeof(p_settings->'rounds') = 'string'
        and jsonb_typeof(p_settings->'qualifiers') = 'number'
      ) then
        return false;
      end if;
      return p_settings->>'rounds' in ('single', 'double')
        and (p_settings->>'qualifiers')::integer between 0 and 64;
    when 'knockout' then
      if not (
        p_settings ?& array['legs', 'thirdPlace']
        and not exists (
          select 1 from jsonb_object_keys(p_settings) key
          where key not in ('legs', 'thirdPlace')
        )
        and jsonb_typeof(p_settings->'legs') = 'string'
        and jsonb_typeof(p_settings->'thirdPlace') = 'boolean'
      ) then
        return false;
      end if;
      return p_settings->>'legs' in ('single', 'double')
        and (p_settings->>'thirdPlace')::boolean in (true, false);
    when 'groups' then
      if not (
        p_settings ?& array['groupCount', 'qualifiersPerGroup', 'rounds']
        and not exists (
          select 1 from jsonb_object_keys(p_settings) key
          where key not in ('groupCount', 'qualifiersPerGroup', 'rounds')
        )
        and jsonb_typeof(p_settings->'groupCount') = 'number'
        and jsonb_typeof(p_settings->'qualifiersPerGroup') = 'number'
        and jsonb_typeof(p_settings->'rounds') = 'string'
      ) then
        return false;
      end if;
      return (p_settings->>'groupCount')::integer between 2 and 32
        and (p_settings->>'qualifiersPerGroup')::integer between 1 and 16
        and p_settings->>'rounds' in ('single', 'double');
    when 'groups_and_playoffs' then
      if not (
        p_settings ?& array[
          'groupCount',
          'qualifiersPerGroup',
          'groupRounds',
          'knockoutLegs'
        ]
        and not exists (
          select 1 from jsonb_object_keys(p_settings) key
          where key not in (
            'groupCount',
            'qualifiersPerGroup',
            'groupRounds',
            'knockoutLegs'
          )
        )
        and jsonb_typeof(p_settings->'groupCount') = 'number'
        and jsonb_typeof(p_settings->'qualifiersPerGroup') = 'number'
        and jsonb_typeof(p_settings->'groupRounds') = 'string'
        and jsonb_typeof(p_settings->'knockoutLegs') = 'string'
      ) then
        return false;
      end if;
      return (p_settings->>'groupCount')::integer between 2 and 32
        and (p_settings->>'qualifiersPerGroup')::integer between 1 and 16
        and p_settings->>'groupRounds' in ('single', 'double')
        and p_settings->>'knockoutLegs' in ('single', 'double');
    when 'league_and_playoffs' then
      if not (
        p_settings ?& array['leagueRounds', 'qualifiers', 'knockoutLegs']
        and not exists (
          select 1 from jsonb_object_keys(p_settings) key
          where key not in ('leagueRounds', 'qualifiers', 'knockoutLegs')
        )
        and jsonb_typeof(p_settings->'leagueRounds') = 'string'
        and jsonb_typeof(p_settings->'qualifiers') = 'number'
        and jsonb_typeof(p_settings->'knockoutLegs') = 'string'
      ) then
        return false;
      end if;
      return p_settings->>'leagueRounds' in ('single', 'double')
        and (p_settings->>'qualifiers')::integer between 2 and 64
        and p_settings->>'knockoutLegs' in ('single', 'double');
    else
      return false;
  end case;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return false;
end;
$$;

create or replace function public.protect_tournament_competition_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
  end if;

  if tg_table_name = 'tournament_seasons'
    and (
      to_jsonb(new)->>'id' is distinct from to_jsonb(old)->>'id'
      or to_jsonb(new)->>'created_by' is distinct from to_jsonb(old)->>'created_by'
      or to_jsonb(new)->>'creation_key' is distinct from to_jsonb(old)->>'creation_key'
    )
  then
    raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
  elsif tg_table_name = 'tournaments'
    and (
      to_jsonb(new)->>'id' is distinct from to_jsonb(old)->>'id'
      or to_jsonb(new)->>'season_id' is distinct from to_jsonb(old)->>'season_id'
      or to_jsonb(new)->>'created_by' is distinct from to_jsonb(old)->>'created_by'
      or to_jsonb(new)->>'creation_key' is distinct from to_jsonb(old)->>'creation_key'
    )
  then
    raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
  elsif tg_table_name = 'tournament_categories'
    and (
      to_jsonb(new)->>'id' is distinct from to_jsonb(old)->>'id'
      or to_jsonb(new)->>'tournament_id' is distinct from to_jsonb(old)->>'tournament_id'
    )
  then
    raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
  elsif tg_table_name in (
    'tournament_scoring_rules',
    'tournament_discipline_rules',
    'tournament_tiebreak_rules'
  )
    and to_jsonb(new)->>'tournament_id'
      is distinct from to_jsonb(old)->>'tournament_id'
  then
    raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
  end if;

  return new;
end;
$$;

create trigger tournament_seasons_touch_updated_at
before update on public.tournament_seasons
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournaments_touch_updated_at
before update on public.tournaments
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_categories_touch_updated_at
before update on public.tournament_categories
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_scoring_rules_touch_updated_at
before update on public.tournament_scoring_rules
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_tiebreak_rules_touch_updated_at
before update on public.tournament_tiebreak_rules
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_discipline_rules_touch_updated_at
before update on public.tournament_discipline_rules
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger user_tournament_context_touch_updated_at
before update on public.user_tournament_context_preferences
for each row execute function public.touch_tournament_workspace_updated_at();

create trigger tournament_seasons_protect_scope
before update on public.tournament_seasons
for each row execute function public.protect_tournament_competition_scope();
create trigger tournaments_protect_scope
before update on public.tournaments
for each row execute function public.protect_tournament_competition_scope();
create trigger tournament_categories_protect_scope
before update on public.tournament_categories
for each row execute function public.protect_tournament_competition_scope();
create trigger tournament_scoring_rules_protect_scope
before update on public.tournament_scoring_rules
for each row execute function public.protect_tournament_competition_scope();
create trigger tournament_tiebreak_rules_protect_scope
before update on public.tournament_tiebreak_rules
for each row execute function public.protect_tournament_competition_scope();
create trigger tournament_discipline_rules_protect_scope
before update on public.tournament_discipline_rules
for each row execute function public.protect_tournament_competition_scope();

alter table public.tournament_sport_modalities enable row level security;
alter table public.tournament_competition_formats enable row level security;
alter table public.tournament_seasons enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_categories enable row level security;
alter table public.tournament_scoring_rules enable row level security;
alter table public.tournament_tiebreak_rules enable row level security;
alter table public.tournament_discipline_rules enable row level security;
alter table public.user_tournament_context_preferences enable row level security;

create policy tournament_sport_modalities_select_authenticated
on public.tournament_sport_modalities for select to authenticated using (true);
create policy tournament_competition_formats_select_authenticated
on public.tournament_competition_formats for select to authenticated using (true);
create policy tournament_seasons_select_capability
on public.tournament_seasons for select to authenticated
using (public.has_tournament_organization_capability(organization_id, 'seasons.read'));
create policy tournaments_select_capability
on public.tournaments for select to authenticated
using (public.has_tournament_organization_capability(organization_id, 'tournaments.read'));
create policy tournament_categories_select_capability
on public.tournament_categories for select to authenticated
using (public.has_tournament_organization_capability(organization_id, 'categories.read'));
create policy tournament_scoring_rules_select_capability
on public.tournament_scoring_rules for select to authenticated
using (public.has_tournament_organization_capability(organization_id, 'competition_rules.read'));
create policy tournament_tiebreak_rules_select_capability
on public.tournament_tiebreak_rules for select to authenticated
using (public.has_tournament_organization_capability(organization_id, 'competition_rules.read'));
create policy tournament_discipline_rules_select_capability
on public.tournament_discipline_rules for select to authenticated
using (public.has_tournament_organization_capability(organization_id, 'competition_rules.read'));
create policy user_tournament_context_select_own
on public.user_tournament_context_preferences for select to authenticated
using (
  user_id = auth.uid()
  and public.has_tournament_organization_capability(organization_id, 'workspace.access')
);

create or replace function public.tournament_registration_checklist(
  p_organization_id uuid,
  p_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_errors text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_category_count integer;
  v_tiebreak_count integer;
  v_tiebreak_min smallint;
  v_tiebreak_max smallint;
  v_has_scoring boolean;
  v_has_discipline boolean;
  v_season_valid boolean;
  v_has_fair_play_tiebreak boolean;
  v_fair_play_enabled boolean;
begin
  if auth.uid() is null
    or not public.has_tournament_organization_capability(
      p_organization_id,
      'tournaments.read'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  select tournament.*
  into v_tournament
  from public.tournaments tournament
  where tournament.id = p_tournament_id
    and tournament.organization_id = p_organization_id
    and tournament.status <> 'archived';

  if v_tournament.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  select exists (
    select 1
    from public.tournament_seasons season
    where season.id = v_tournament.season_id
      and season.organization_id = p_organization_id
      and season.status <> 'archived'
  ) into v_season_valid;

  select count(*) into v_category_count
  from public.tournament_categories category
  where category.organization_id = p_organization_id
    and category.tournament_id = p_tournament_id
    and category.status = 'active';

  select count(*), min(rule.sort_order), max(rule.sort_order)
  into v_tiebreak_count, v_tiebreak_min, v_tiebreak_max
  from public.tournament_tiebreak_rules rule
  where rule.organization_id = p_organization_id
    and rule.tournament_id = p_tournament_id;

  select exists (
    select 1
    from public.tournament_tiebreak_rules rule
    where rule.organization_id = p_organization_id
      and rule.tournament_id = p_tournament_id
      and rule.criterion = 'fair_play'
  ) into v_has_fair_play_tiebreak;

  select exists(
    select 1 from public.tournament_scoring_rules rule
    where rule.organization_id = p_organization_id
      and rule.tournament_id = p_tournament_id
  ) into v_has_scoring;

  select exists(
    select 1
    from public.tournament_discipline_rules rule
    where rule.organization_id = p_organization_id
      and rule.tournament_id = p_tournament_id
  ) into v_has_discipline;

  select coalesce(bool_or(rule.fair_play_enabled), false)
  into v_fair_play_enabled
  from public.tournament_discipline_rules rule
  where rule.organization_id = p_organization_id
    and rule.tournament_id = p_tournament_id;

  if not v_season_valid then
    v_errors := array_append(v_errors, 'season');
  end if;
  if char_length(v_tournament.name) < 3 then
    v_errors := array_append(v_errors, 'name');
  end if;
  if v_tournament.sport_modality is null then
    v_errors := array_append(v_errors, 'sport_modality');
  end if;
  if v_tournament.competition_format is null
    or not public.is_valid_tournament_format_settings(
      v_tournament.competition_format,
      v_tournament.format_settings
    )
  then
    v_errors := array_append(v_errors, 'competition_format');
  end if;
  if v_tournament.start_date is not null
    and v_tournament.end_date is not null
    and v_tournament.end_date < v_tournament.start_date
  then
    v_errors := array_append(v_errors, 'dates');
  end if;
  if v_category_count < 1 then
    v_errors := array_append(v_errors, 'categories');
  end if;
  if not v_has_scoring then
    v_errors := array_append(v_errors, 'scoring');
  end if;
  if v_tiebreak_count < 1
    or v_tiebreak_min <> 1
    or v_tiebreak_max <> v_tiebreak_count
  then
    v_errors := array_append(v_errors, 'tiebreaks');
  end if;
  if not v_has_discipline
    or (v_has_fair_play_tiebreak and not v_fair_play_enabled)
  then
    v_errors := array_append(v_errors, 'discipline');
  end if;
  if v_tournament.start_date is null then
    v_warnings := array_append(v_warnings, 'start_date');
  end if;
  if v_tournament.registration_opens_at is null
    or v_tournament.registration_closes_at is null
  then
    v_warnings := array_append(v_warnings, 'registration_dates');
  end if;

  return jsonb_build_object(
    'ready', cardinality(v_errors) = 0,
    'errors', to_jsonb(v_errors),
    'warnings', to_jsonb(v_warnings),
    'checks', jsonb_build_object(
      'information', char_length(v_tournament.name) >= 3,
      'season', v_season_valid,
      'modality', v_tournament.sport_modality is not null,
      'format', public.is_valid_tournament_format_settings(
        v_tournament.competition_format,
        v_tournament.format_settings
      ),
      'categories', v_category_count > 0,
      'scoring', v_has_scoring,
      'tiebreaks', (
        v_tiebreak_count > 0
        and v_tiebreak_min = 1
        and v_tiebreak_max = v_tiebreak_count
      ),
      'discipline', (
        v_has_discipline
        and (not v_has_fair_play_tiebreak or v_fair_play_enabled)
      )
    )
  );
end;
$$;

create or replace function public.create_tournament_season(
  p_organization_id uuid,
  p_name text,
  p_slug text,
  p_start_date date,
  p_end_date date,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := public.normalize_tournament_competition_slug(p_slug);
  v_season public.tournament_seasons%rowtype;
  v_constraint_name text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id,
    'seasons.create'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;
  if char_length(v_name) not between 3 and 80
    or char_length(v_slug) not between 3 and 48
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_SEASON';
  end if;
  if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_DATES';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || v_user_id::text || ':season',
    0
  ));

  perform 1
  from public.tournament_organizations organization
  where organization.id = p_organization_id
    and organization.status = 'active'
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  select season.* into v_season
  from public.tournament_seasons season
  where season.organization_id = p_organization_id
    and season.created_by = v_user_id
    and season.creation_key = p_idempotency_key;

  if v_season.id is not null and v_season.status = 'archived' then
    raise exception using errcode = '23514', message = 'TORNEOS_IDEMPOTENCY_CONFLICT';
  end if;

  if v_season.id is null then
    begin
      insert into public.tournament_seasons (
        organization_id,
        name,
        slug,
        status,
        start_date,
        end_date,
        created_by,
        creation_key
      )
      values (
        p_organization_id,
        v_name,
        v_slug,
        'draft',
        p_start_date,
        p_end_date,
        v_user_id,
        p_idempotency_key
      )
      returning * into v_season;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'tournament_seasons_slug_unique' then
        raise exception using errcode = '23505', message = 'TORNEOS_SEASON_SLUG_TAKEN';
      elsif v_constraint_name = 'tournament_seasons_creation_unique' then
        select season.* into v_season
        from public.tournament_seasons season
        where season.organization_id = p_organization_id
          and season.created_by = v_user_id
          and season.creation_key = p_idempotency_key;
      else
        raise;
      end if;
    end;
  end if;

  insert into public.user_tournament_context_preferences (
    user_id,
    organization_id,
    active_season_id,
    active_tournament_id
  )
  values (v_user_id, p_organization_id, v_season.id, null)
  on conflict (user_id, organization_id) do update
  set active_season_id = excluded.active_season_id,
      active_tournament_id = null;

  return jsonb_build_object(
    'id', v_season.id,
    'organizationId', v_season.organization_id,
    'name', v_season.name,
    'slug', v_season.slug,
    'status', v_season.status,
    'startDate', v_season.start_date,
    'endDate', v_season.end_date,
    'createdAt', v_season.created_at,
    'updatedAt', v_season.updated_at
  );
end;
$$;

create or replace function public.update_tournament_season(
  p_organization_id uuid,
  p_season_id uuid,
  p_name text default null,
  p_slug text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_status text default null,
  p_clear_start_date boolean default false,
  p_clear_end_date boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season public.tournament_seasons%rowtype;
  v_name text;
  v_slug text;
  v_start_date date;
  v_end_date date;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id,
    case when p_status = 'archived' then 'seasons.archive' else 'seasons.update' end
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  select season.* into v_season
  from public.tournament_seasons season
  where season.id = p_season_id
    and season.organization_id = p_organization_id
  for update;

  if v_season.id is null or v_season.status = 'archived' then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if p_status is not null
    and not (
      (v_season.status = 'draft' and p_status in ('active', 'archived'))
      or (v_season.status = 'active' and p_status = 'completed')
      or (v_season.status = 'completed' and p_status = 'archived')
    )
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_SEASON_TRANSITION';
  end if;
  if p_status = 'archived' and exists (
    select 1 from public.tournaments tournament
    where tournament.organization_id = p_organization_id
      and tournament.season_id = p_season_id
      and tournament.status <> 'archived'
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_SEASON_HAS_TOURNAMENTS';
  end if;

  v_name := case when p_name is null then v_season.name else btrim(p_name) end;
  v_slug := case
    when p_slug is null then v_season.slug
    else public.normalize_tournament_competition_slug(p_slug)
  end;
  v_start_date := case
    when p_clear_start_date then null
    else coalesce(p_start_date, v_season.start_date)
  end;
  v_end_date := case
    when p_clear_end_date then null
    else coalesce(p_end_date, v_season.end_date)
  end;

  if char_length(v_name) not between 3 and 80
    or char_length(v_slug) not between 3 and 48
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_SEASON';
  end if;
  if v_start_date is not null and v_end_date is not null and v_end_date < v_start_date then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_DATES';
  end if;

  begin
    update public.tournament_seasons
    set name = v_name,
        slug = v_slug,
        start_date = v_start_date,
        end_date = v_end_date,
        status = coalesce(p_status, status),
        archived_at = case when p_status = 'archived' then now() else archived_at end
    where id = p_season_id
    returning * into v_season;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'TORNEOS_SEASON_SLUG_TAKEN';
  end;

  if v_season.status = 'archived' then
    update public.user_tournament_context_preferences
    set active_season_id = null,
        active_tournament_id = null
    where organization_id = p_organization_id
      and active_season_id = p_season_id;
  end if;

  return jsonb_build_object(
    'id', v_season.id,
    'organizationId', v_season.organization_id,
    'name', v_season.name,
    'slug', v_season.slug,
    'status', v_season.status,
    'startDate', v_season.start_date,
    'endDate', v_season.end_date,
    'createdAt', v_season.created_at,
    'updatedAt', v_season.updated_at
  );
end;
$$;

create or replace function public.create_tournament_with_defaults(
  p_organization_id uuid,
  p_season_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_sport_modality text,
  p_competition_format text,
  p_gender_category text,
  p_start_date date,
  p_end_date date,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := public.normalize_tournament_competition_slug(p_slug);
  v_tournament public.tournaments%rowtype;
  v_team_size smallint;
  v_substitutes smallint;
  v_constraint_name text;
  v_format_settings jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id,
    'tournaments.create'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;
  if char_length(v_name) not between 3 and 100
    or char_length(v_slug) not between 3 and 64
    or p_gender_category not in ('male', 'female', 'mixed', 'open')
    or p_competition_format not in (
      'league',
      'knockout',
      'groups',
      'groups_and_playoffs',
      'league_and_playoffs'
    )
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_TOURNAMENT';
  end if;
  if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_DATES';
  end if;

  select modality.team_size, modality.recommended_substitutes
  into v_team_size, v_substitutes
  from public.tournament_sport_modalities modality
  where modality.code = p_sport_modality;

  if v_team_size is null then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_MODALITY';
  end if;

  v_format_settings := case p_competition_format
    when 'league' then '{"rounds":"single","qualifiers":0}'::jsonb
    when 'knockout' then '{"legs":"single","thirdPlace":false}'::jsonb
    when 'groups' then '{"groupCount":2,"qualifiersPerGroup":1,"rounds":"single"}'::jsonb
    when 'groups_and_playoffs' then '{"groupCount":2,"qualifiersPerGroup":1,"groupRounds":"single","knockoutLegs":"single"}'::jsonb
    else '{"leagueRounds":"single","qualifiers":2,"knockoutLegs":"single"}'::jsonb
  end;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || v_user_id::text || ':tournament',
    0
  ));

  perform 1
  from public.tournament_seasons season
  join public.tournament_organizations organization
    on organization.id = season.organization_id
  where season.id = p_season_id
    and season.organization_id = p_organization_id
    and season.status <> 'archived'
    and organization.status = 'active'
  for share of season, organization;

  if not found then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  select tournament.* into v_tournament
  from public.tournaments tournament
  where tournament.organization_id = p_organization_id
    and tournament.created_by = v_user_id
    and tournament.creation_key = p_idempotency_key;

  if v_tournament.id is not null and v_tournament.status = 'archived' then
    raise exception using errcode = '23514', message = 'TORNEOS_IDEMPOTENCY_CONFLICT';
  end if;

  if v_tournament.id is null then
    begin
      insert into public.tournaments (
        organization_id,
        season_id,
        name,
        slug,
        description,
        status,
        sport_modality,
        competition_format,
        gender_category,
        team_size,
        substitutes_limit,
        start_date,
        end_date,
        format_settings,
        created_by,
        creation_key
      )
      values (
        p_organization_id,
        p_season_id,
        v_name,
        v_slug,
        nullif(btrim(coalesce(p_description, '')), ''),
        'draft',
        p_sport_modality,
        p_competition_format,
        p_gender_category,
        v_team_size,
        v_substitutes,
        p_start_date,
        p_end_date,
        v_format_settings,
        v_user_id,
        p_idempotency_key
      )
      returning * into v_tournament;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'tournaments_slug_unique' then
        raise exception using errcode = '23505', message = 'TORNEOS_TOURNAMENT_SLUG_TAKEN';
      elsif v_constraint_name = 'tournaments_creation_unique' then
        select tournament.* into v_tournament
        from public.tournaments tournament
        where tournament.organization_id = p_organization_id
          and tournament.created_by = v_user_id
          and tournament.creation_key = p_idempotency_key;
      else
        raise;
      end if;
    end;

    insert into public.tournament_scoring_rules (
      tournament_id,
      organization_id
    )
    values (v_tournament.id, p_organization_id);

    insert into public.tournament_tiebreak_rules (
      organization_id,
      tournament_id,
      criterion,
      sort_order
    )
    values
      (p_organization_id, v_tournament.id, 'goal_difference', 1),
      (p_organization_id, v_tournament.id, 'goals_for', 2),
      (p_organization_id, v_tournament.id, 'head_to_head', 3),
      (p_organization_id, v_tournament.id, 'fair_play', 4);

    insert into public.tournament_discipline_rules (
      tournament_id,
      organization_id
    )
    values (v_tournament.id, p_organization_id);
  end if;

  insert into public.user_tournament_context_preferences (
    user_id,
    organization_id,
    active_season_id,
    active_tournament_id
  )
  values (v_user_id, p_organization_id, v_tournament.season_id, v_tournament.id)
  on conflict (user_id, organization_id) do update
  set active_season_id = excluded.active_season_id,
      active_tournament_id = excluded.active_tournament_id;

  return jsonb_build_object(
    'id', v_tournament.id,
    'organizationId', v_tournament.organization_id,
    'seasonId', v_tournament.season_id,
    'name', v_tournament.name,
    'slug', v_tournament.slug,
    'status', v_tournament.status
  );
end;
$$;

create or replace function public.update_tournament_configuration(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_name text;
  v_slug text;
  v_modality text;
  v_format text;
  v_gender text;
  v_team_size smallint;
  v_substitutes smallint;
  v_start_date date;
  v_end_date date;
  v_registration_opens timestamptz;
  v_registration_closes timestamptz;
  v_format_settings jsonb;
  v_scoring jsonb;
  v_discipline jsonb;
  v_tiebreaks jsonb;
  v_criterion text;
  v_position smallint := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id,
    'tournaments.update'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if jsonb_typeof(v_patch) <> 'object'
    or exists (
      select 1
      from jsonb_object_keys(v_patch) key
      where key not in (
        'name', 'slug', 'description', 'sportModality', 'competitionFormat',
        'genderCategory', 'teamSize', 'substitutesLimit', 'startDate', 'endDate',
        'registrationOpensAt', 'registrationClosesAt', 'formatSettings',
        'scoring', 'tiebreaks', 'discipline'
      )
    )
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_PATCH';
  end if;

  select tournament.* into v_tournament
  from public.tournaments tournament
  where tournament.id = p_tournament_id
    and tournament.organization_id = p_organization_id
  for update;

  if v_tournament.id is null or v_tournament.status not in ('draft', 'registration') then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  v_name := case
    when v_patch ? 'name' then btrim(v_patch->>'name')
    else v_tournament.name
  end;
  v_slug := case
    when v_patch ? 'slug'
      then public.normalize_tournament_competition_slug(v_patch->>'slug')
    else v_tournament.slug
  end;
  v_modality := coalesce(v_patch->>'sportModality', v_tournament.sport_modality);
  v_format := coalesce(v_patch->>'competitionFormat', v_tournament.competition_format);
  v_gender := coalesce(v_patch->>'genderCategory', v_tournament.gender_category);
  v_team_size := coalesce((v_patch->>'teamSize')::smallint, v_tournament.team_size);
  v_substitutes := case
    when v_patch ? 'substitutesLimit' then (v_patch->>'substitutesLimit')::smallint
    else v_tournament.substitutes_limit
  end;
  v_start_date := case
    when v_patch ? 'startDate' then nullif(v_patch->>'startDate', '')::date
    else v_tournament.start_date
  end;
  v_end_date := case
    when v_patch ? 'endDate' then nullif(v_patch->>'endDate', '')::date
    else v_tournament.end_date
  end;
  v_registration_opens := case
    when v_patch ? 'registrationOpensAt'
      then nullif(v_patch->>'registrationOpensAt', '')::timestamptz
    else v_tournament.registration_opens_at
  end;
  v_registration_closes := case
    when v_patch ? 'registrationClosesAt'
      then nullif(v_patch->>'registrationClosesAt', '')::timestamptz
    else v_tournament.registration_closes_at
  end;
  v_format_settings := case
    when v_patch ? 'formatSettings' then v_patch->'formatSettings'
    when v_patch ? 'competitionFormat' then case v_format
      when 'league' then '{"rounds":"single","qualifiers":0}'::jsonb
      when 'knockout' then '{"legs":"single","thirdPlace":false}'::jsonb
      when 'groups' then '{"groupCount":2,"qualifiersPerGroup":1,"rounds":"single"}'::jsonb
      when 'groups_and_playoffs' then '{"groupCount":2,"qualifiersPerGroup":1,"groupRounds":"single","knockoutLegs":"single"}'::jsonb
      else '{"leagueRounds":"single","qualifiers":2,"knockoutLegs":"single"}'::jsonb
    end
    else v_tournament.format_settings
  end;

  if char_length(v_name) not between 3 and 100
    or char_length(v_slug) not between 3 and 64
    or v_gender not in ('male', 'female', 'mixed', 'open')
    or v_team_size not between 5 and 11
    or v_substitutes not between 0 and 30
    or not exists (
      select 1 from public.tournament_sport_modalities modality
      where modality.code = v_modality
    )
    or not public.is_valid_tournament_format_settings(v_format, v_format_settings)
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_TOURNAMENT';
  end if;
  if v_start_date is not null and v_end_date is not null and v_end_date < v_start_date then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_DATES';
  end if;
  if v_registration_opens is not null
    and v_registration_closes is not null
    and v_registration_closes < v_registration_opens
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_DATES';
  end if;

  begin
    update public.tournaments
    set name = v_name,
        slug = v_slug,
        description = case
          when v_patch ? 'description' then nullif(btrim(v_patch->>'description'), '')
          else description
        end,
        sport_modality = v_modality,
        competition_format = v_format,
        gender_category = v_gender,
        team_size = v_team_size,
        substitutes_limit = v_substitutes,
        start_date = v_start_date,
        end_date = v_end_date,
        registration_opens_at = v_registration_opens,
        registration_closes_at = v_registration_closes,
        format_settings = v_format_settings
    where id = p_tournament_id
    returning * into v_tournament;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'TORNEOS_TOURNAMENT_SLUG_TAKEN';
  end;

  if v_patch ? 'scoring' then
    if not public.has_tournament_organization_capability(
      p_organization_id,
      'competition_rules.update'
    ) then
      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
    end if;
    v_scoring := v_patch->'scoring';
    if jsonb_typeof(v_scoring) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_scoring) key
        where key not in (
          'pointsWin',
          'pointsDraw',
          'pointsLoss',
          'pointsWalkoverWin',
          'pointsWalkoverLoss',
          'allowManualPointsAdjustment',
          'allowAdministrativeResult'
        )
      )
    then
      raise exception using errcode = '22023', message = 'TORNEOS_INVALID_SCORING';
    end if;
    update public.tournament_scoring_rules
    set points_win = coalesce((v_scoring->>'pointsWin')::smallint, points_win),
        points_draw = coalesce((v_scoring->>'pointsDraw')::smallint, points_draw),
        points_loss = coalesce((v_scoring->>'pointsLoss')::smallint, points_loss),
        points_walkover_win = case
          when v_scoring ? 'pointsWalkoverWin'
            then nullif(v_scoring->>'pointsWalkoverWin', '')::smallint
          else points_walkover_win
        end,
        points_walkover_loss = case
          when v_scoring ? 'pointsWalkoverLoss'
            then nullif(v_scoring->>'pointsWalkoverLoss', '')::smallint
          else points_walkover_loss
        end,
        allow_manual_points_adjustment = coalesce(
          (v_scoring->>'allowManualPointsAdjustment')::boolean,
          allow_manual_points_adjustment
        ),
        allow_administrative_result = coalesce(
          (v_scoring->>'allowAdministrativeResult')::boolean,
          allow_administrative_result
        )
    where tournament_id = p_tournament_id
      and organization_id = p_organization_id;
  end if;

  if v_patch ? 'tiebreaks' then
    if not public.has_tournament_organization_capability(
      p_organization_id,
      'competition_rules.update'
    ) then
      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
    end if;
    v_tiebreaks := v_patch->'tiebreaks';
    if jsonb_typeof(v_tiebreaks) <> 'array'
      or jsonb_array_length(v_tiebreaks) not between 1 and 7
      or (
        select count(*) <> count(distinct criterion)
        from jsonb_array_elements_text(v_tiebreaks) item(criterion)
      )
      or exists (
        select 1
        from jsonb_array_elements_text(v_tiebreaks) item(criterion)
        where criterion not in (
          'goal_difference',
          'goals_for',
          'head_to_head',
          'matches_won',
          'fair_play',
          'playoff_match',
          'draw'
        )
      )
    then
      raise exception using errcode = '22023', message = 'TORNEOS_INVALID_TIEBREAKS';
    end if;

    delete from public.tournament_tiebreak_rules
    where organization_id = p_organization_id
      and tournament_id = p_tournament_id;
    for v_criterion in select jsonb_array_elements_text(v_tiebreaks)
    loop
      v_position := v_position + 1;
      insert into public.tournament_tiebreak_rules (
        organization_id,
        tournament_id,
        criterion,
        sort_order
      )
      values (p_organization_id, p_tournament_id, v_criterion, v_position);
    end loop;
  end if;

  if v_patch ? 'discipline' then
    if not public.has_tournament_organization_capability(
      p_organization_id,
      'competition_rules.update'
    ) then
      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
    end if;
    v_discipline := v_patch->'discipline';
    if jsonb_typeof(v_discipline) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_discipline) key
        where key not in (
          'yellowsForSuspension',
          'suspensionMatches',
          'directRedSuggestedMatches',
          'doubleYellowCountsAsRed',
          'resetYellowsEachStage',
          'fairPlayEnabled',
          'yellowFairPlayPoints',
          'redFairPlayPoints'
        )
      )
    then
      raise exception using errcode = '22023', message = 'TORNEOS_INVALID_DISCIPLINE';
    end if;
    update public.tournament_discipline_rules
    set yellows_for_suspension = coalesce(
          (v_discipline->>'yellowsForSuspension')::smallint,
          yellows_for_suspension
        ),
        suspension_matches = coalesce(
          (v_discipline->>'suspensionMatches')::smallint,
          suspension_matches
        ),
        direct_red_suggested_matches = case
          when v_discipline ? 'directRedSuggestedMatches'
            then nullif(v_discipline->>'directRedSuggestedMatches', '')::smallint
          else direct_red_suggested_matches
        end,
        double_yellow_counts_as_red = coalesce(
          (v_discipline->>'doubleYellowCountsAsRed')::boolean,
          double_yellow_counts_as_red
        ),
        reset_yellows_each_stage = coalesce(
          (v_discipline->>'resetYellowsEachStage')::boolean,
          reset_yellows_each_stage
        ),
        fair_play_enabled = coalesce(
          (v_discipline->>'fairPlayEnabled')::boolean,
          fair_play_enabled
        ),
        yellow_fair_play_points = coalesce(
          (v_discipline->>'yellowFairPlayPoints')::smallint,
          yellow_fair_play_points
        ),
        red_fair_play_points = coalesce(
          (v_discipline->>'redFairPlayPoints')::smallint,
          red_fair_play_points
        )
    where tournament_id = p_tournament_id
      and organization_id = p_organization_id;
  end if;

  return jsonb_build_object(
    'id', v_tournament.id,
    'organizationId', v_tournament.organization_id,
    'seasonId', v_tournament.season_id,
    'name', v_tournament.name,
    'slug', v_tournament.slug,
    'status', v_tournament.status
  );
end;
$$;

create or replace function public.save_tournament_category(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_sort_order integer,
  p_min_age smallint,
  p_max_age smallint,
  p_gender_category text,
  p_sport_modality text,
  p_team_size smallint,
  p_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.tournament_categories%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := public.normalize_tournament_competition_slug(p_slug);
  v_capability text := case
    when p_status = 'archived' then 'categories.archive'
    when p_category_id is null then 'categories.create'
    else 'categories.update'
  end;
  v_active_count integer;
  v_current_order integer;
  v_target_order integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id,
    v_capability
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  perform 1
  from public.tournaments tournament
  where tournament.id = p_tournament_id
    and tournament.organization_id = p_organization_id
    and tournament.status in ('draft', 'registration')
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if char_length(v_name) not between 2 and 80
    or char_length(v_slug) not between 2 and 48
    or p_status not in ('active', 'archived')
    or (p_category_id is null and p_status = 'archived')
    or (p_min_age is not null and p_min_age not between 5 and 99)
    or (p_max_age is not null and p_max_age not between 5 and 99)
    or (p_min_age is not null and p_max_age is not null and p_max_age < p_min_age)
    or (p_team_size is not null and p_team_size not between 5 and 11)
    or (
      p_gender_category is not null
      and p_gender_category not in ('male', 'female', 'mixed', 'open')
    )
    or (
      p_sport_modality is not null
      and not exists (
        select 1 from public.tournament_sport_modalities modality
        where modality.code = p_sport_modality
      )
    )
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_CATEGORY';
  end if;

  select count(*)
  into v_active_count
  from public.tournament_categories category
  where category.organization_id = p_organization_id
    and category.tournament_id = p_tournament_id
    and category.status = 'active';

  if p_category_id is null then
    v_target_order := least(
      greatest(coalesce(p_sort_order, v_active_count), 0),
      v_active_count
    );

    update public.tournament_categories
    set sort_order = sort_order + 1
    where organization_id = p_organization_id
      and tournament_id = p_tournament_id
      and status = 'active'
      and sort_order >= v_target_order;

    begin
      insert into public.tournament_categories (
        organization_id,
        tournament_id,
        name,
        slug,
        description,
        status,
        sort_order,
        min_age,
        max_age,
        gender_category,
        sport_modality,
        team_size,
        archived_at
      )
      values (
        p_organization_id,
        p_tournament_id,
        v_name,
        v_slug,
        nullif(btrim(coalesce(p_description, '')), ''),
        p_status,
        v_target_order,
        p_min_age,
        p_max_age,
        p_gender_category,
        p_sport_modality,
        p_team_size,
        case when p_status = 'archived' then now() else null end
      )
      returning * into v_category;
    exception when unique_violation then
      raise exception using errcode = '23505', message = 'TORNEOS_CATEGORY_SLUG_TAKEN';
    end;
  else
    select category.* into v_category
    from public.tournament_categories category
    where category.id = p_category_id
      and category.organization_id = p_organization_id
      and category.tournament_id = p_tournament_id
    for update;

    if v_category.id is null or v_category.status = 'archived' then
      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
    end if;
    v_current_order := v_category.sort_order;
    if p_status = 'archived'
      and exists (
        select 1 from public.tournaments tournament
        where tournament.id = p_tournament_id
          and tournament.status = 'registration'
      )
      and (
        select count(*) from public.tournament_categories category
        where category.tournament_id = p_tournament_id
          and category.status = 'active'
      ) <= 1
    then
      raise exception using errcode = '23514', message = 'TORNEOS_CATEGORY_REQUIRED';
    end if;

    if p_status = 'active' then
      v_target_order := least(
        greatest(coalesce(p_sort_order, v_current_order), 0),
        greatest(v_active_count - 1, 0)
      );

      if v_target_order < v_current_order then
        update public.tournament_categories
        set sort_order = sort_order + 1
        where organization_id = p_organization_id
          and tournament_id = p_tournament_id
          and status = 'active'
          and id <> p_category_id
          and sort_order >= v_target_order
          and sort_order < v_current_order;
      elsif v_target_order > v_current_order then
        update public.tournament_categories
        set sort_order = sort_order - 1
        where organization_id = p_organization_id
          and tournament_id = p_tournament_id
          and status = 'active'
          and id <> p_category_id
          and sort_order > v_current_order
          and sort_order <= v_target_order;
      end if;
    else
      v_target_order := v_current_order;
    end if;

    begin
      update public.tournament_categories
      set name = v_name,
          slug = v_slug,
          description = nullif(btrim(coalesce(p_description, '')), ''),
          status = p_status,
          sort_order = v_target_order,
          min_age = p_min_age,
          max_age = p_max_age,
          gender_category = p_gender_category,
          sport_modality = p_sport_modality,
          team_size = p_team_size,
          archived_at = case when p_status = 'archived' then now() else null end
      where id = p_category_id
      returning * into v_category;
    exception when unique_violation then
      raise exception using errcode = '23505', message = 'TORNEOS_CATEGORY_SLUG_TAKEN';
    end;

    if p_status = 'archived' then
      update public.tournament_categories
      set sort_order = sort_order - 1
      where organization_id = p_organization_id
        and tournament_id = p_tournament_id
        and status = 'active'
        and sort_order > v_current_order;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_category.id,
    'organizationId', v_category.organization_id,
    'tournamentId', v_category.tournament_id,
    'name', v_category.name,
    'slug', v_category.slug,
    'status', v_category.status,
    'sortOrder', v_category.sort_order
  );
end;
$$;

create or replace function public.change_tournament_status(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_checklist jsonb;
  v_capability text := case
    when p_status = 'archived' then 'tournaments.archive'
    else 'tournaments.change_status'
  end;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id,
    v_capability
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  select tournament.* into v_tournament
  from public.tournaments tournament
  where tournament.id = p_tournament_id
    and tournament.organization_id = p_organization_id
  for update;

  if v_tournament.id is null
    or not (
      (v_tournament.status = 'draft' and p_status in ('registration', 'archived'))
      or (v_tournament.status = 'registration' and p_status in ('draft', 'archived'))
    )
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_TOURNAMENT_TRANSITION';
  end if;

  if p_status = 'registration' then
    v_checklist := public.tournament_registration_checklist(
      p_organization_id,
      p_tournament_id
    );
    if not (v_checklist->>'ready')::boolean then
      raise exception using
        errcode = '23514',
        message = 'TORNEOS_REGISTRATION_INCOMPLETE';
    end if;
  end if;

  update public.tournaments
  set status = p_status,
      archived_at = case when p_status = 'archived' then now() else null end
  where id = p_tournament_id
  returning * into v_tournament;

  if p_status = 'archived' then
    update public.user_tournament_context_preferences
    set active_tournament_id = null
    where organization_id = p_organization_id
      and active_tournament_id = p_tournament_id;
  end if;

  return jsonb_build_object(
    'id', v_tournament.id,
    'status', v_tournament.status,
    'checklist', case
      when p_status = 'archived' then null
      else coalesce(
        v_checklist,
        public.tournament_registration_checklist(
          p_organization_id,
          p_tournament_id
        )
      )
    end
  );
end;
$$;

create or replace function public.set_active_tournament_context(
  p_organization_id uuid,
  p_season_id uuid,
  p_tournament_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id,
    'workspace.access'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_CONTEXT_FORBIDDEN';
  end if;
  perform 1
  from public.tournament_seasons season
  where season.id = p_season_id
    and season.organization_id = p_organization_id
    and season.status <> 'archived'
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'TORNEOS_CONTEXT_FORBIDDEN';
  end if;

  if p_tournament_id is not null then
    perform 1
    from public.tournaments tournament
    where tournament.id = p_tournament_id
      and tournament.organization_id = p_organization_id
      and tournament.season_id = p_season_id
      and tournament.status <> 'archived'
    for share;

    if not found then
      raise exception using errcode = '42501', message = 'TORNEOS_CONTEXT_FORBIDDEN';
    end if;
  end if;

  insert into public.user_tournament_context_preferences (
    user_id,
    organization_id,
    active_season_id,
    active_tournament_id
  )
  values (v_user_id, p_organization_id, p_season_id, p_tournament_id)
  on conflict (user_id, organization_id) do update
  set active_season_id = excluded.active_season_id,
      active_tournament_id = excluded.active_tournament_id;

  return jsonb_build_object(
    'organizationId', p_organization_id,
    'activeSeasonId', p_season_id,
    'activeTournamentId', p_tournament_id
  );
end;
$$;

create or replace function public.get_tournament_competition_context(
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_preference public.user_tournament_context_preferences%rowtype;
  v_seasons jsonb;
  v_tournaments jsonb;
  v_modalities jsonb;
  v_formats jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id,
    'tournaments.read'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  select preference.* into v_preference
  from public.user_tournament_context_preferences preference
  where preference.user_id = v_user_id
    and preference.organization_id = p_organization_id;

  if v_preference.user_id is null
    or (
      v_preference.active_season_id is not null
      and not exists (
        select 1 from public.tournament_seasons season
        where season.id = v_preference.active_season_id
          and season.organization_id = p_organization_id
          and season.status <> 'archived'
      )
    )
    or (
      v_preference.active_tournament_id is not null
      and not exists (
        select 1 from public.tournaments tournament
        where tournament.id = v_preference.active_tournament_id
          and tournament.organization_id = p_organization_id
          and tournament.season_id = v_preference.active_season_id
          and tournament.status <> 'archived'
      )
    )
  then
    insert into public.user_tournament_context_preferences (
      user_id,
      organization_id,
      active_season_id,
      active_tournament_id
    )
    select
      v_user_id,
      p_organization_id,
      fallback.season_id,
      fallback.tournament_id
    from (
      select tournament.season_id, tournament.id as tournament_id
      from public.tournaments tournament
      join public.tournament_seasons season on season.id = tournament.season_id
      where tournament.organization_id = p_organization_id
        and tournament.status <> 'archived'
        and season.status <> 'archived'
      order by tournament.updated_at desc, tournament.id
      limit 1
    ) fallback
    on conflict (user_id, organization_id) do update
    set active_season_id = excluded.active_season_id,
        active_tournament_id = excluded.active_tournament_id
    returning * into v_preference;

    if v_preference.user_id is null then
      insert into public.user_tournament_context_preferences (
        user_id,
        organization_id,
        active_season_id,
        active_tournament_id
      )
      select
        v_user_id,
        p_organization_id,
        season.id,
        null
      from public.tournament_seasons season
      where season.organization_id = p_organization_id
        and season.status <> 'archived'
      order by season.updated_at desc, season.id
      limit 1
      on conflict (user_id, organization_id) do update
      set active_season_id = excluded.active_season_id,
          active_tournament_id = null
      returning * into v_preference;
    end if;

    if v_preference.user_id is null then
      insert into public.user_tournament_context_preferences (
        user_id,
        organization_id,
        active_season_id,
        active_tournament_id
      )
      values (v_user_id, p_organization_id, null, null)
      on conflict (user_id, organization_id) do update
      set active_season_id = null,
          active_tournament_id = null
      returning * into v_preference;
    end if;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'code', modality.code,
      'name', modality.name,
      'teamSize', modality.team_size,
      'recommendedSubstitutes', modality.recommended_substitutes,
      'teamOfRoundSize', modality.team_of_round_size,
      'suggestedDurationMinutes', modality.suggested_duration_minutes,
      'requiresGoalkeeper', modality.requires_goalkeeper
    ) order by modality.team_size
  ), '[]'::jsonb)
  into v_modalities
  from public.tournament_sport_modalities modality;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'code', format.code,
      'name', format.name,
      'description', format.description
    ) order by case format.code
      when 'league' then 1
      when 'knockout' then 2
      when 'groups' then 3
      when 'groups_and_playoffs' then 4
      else 5
    end
  ), '[]'::jsonb)
  into v_formats
  from public.tournament_competition_formats format;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', season.id,
      'organizationId', season.organization_id,
      'name', season.name,
      'slug', season.slug,
      'status', season.status,
      'startDate', season.start_date,
      'endDate', season.end_date,
      'createdAt', season.created_at,
      'updatedAt', season.updated_at
    ) order by season.updated_at desc, season.id
  ), '[]'::jsonb)
  into v_seasons
  from public.tournament_seasons season
  where season.organization_id = p_organization_id
    and season.status <> 'archived';

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', tournament.id,
      'organizationId', tournament.organization_id,
      'seasonId', tournament.season_id,
      'name', tournament.name,
      'slug', tournament.slug,
      'description', tournament.description,
      'status', tournament.status,
      'sportModality', tournament.sport_modality,
      'competitionFormat', tournament.competition_format,
      'genderCategory', tournament.gender_category,
      'teamSize', tournament.team_size,
      'substitutesLimit', tournament.substitutes_limit,
      'startDate', tournament.start_date,
      'endDate', tournament.end_date,
      'registrationOpensAt', tournament.registration_opens_at,
      'registrationClosesAt', tournament.registration_closes_at,
      'formatSettings', tournament.format_settings,
      'createdAt', tournament.created_at,
      'updatedAt', tournament.updated_at,
      'categories', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', category.id,
          'name', category.name,
          'slug', category.slug,
          'description', category.description,
          'status', category.status,
          'sortOrder', category.sort_order,
          'minAge', category.min_age,
          'maxAge', category.max_age,
          'genderCategory', category.gender_category,
          'sportModality', category.sport_modality,
          'teamSize', category.team_size
        ) order by category.sort_order, category.created_at)
        from public.tournament_categories category
        where category.tournament_id = tournament.id
          and category.organization_id = p_organization_id
          and category.status = 'active'
      ), '[]'::jsonb),
      'scoring', (
        select jsonb_build_object(
          'pointsWin', scoring.points_win,
          'pointsDraw', scoring.points_draw,
          'pointsLoss', scoring.points_loss,
          'pointsWalkoverWin', scoring.points_walkover_win,
          'pointsWalkoverLoss', scoring.points_walkover_loss,
          'allowManualPointsAdjustment', scoring.allow_manual_points_adjustment,
          'allowAdministrativeResult', scoring.allow_administrative_result
        )
        from public.tournament_scoring_rules scoring
        where scoring.tournament_id = tournament.id
          and scoring.organization_id = p_organization_id
      ),
      'tiebreaks', coalesce((
        select jsonb_agg(tiebreak.criterion order by tiebreak.sort_order)
        from public.tournament_tiebreak_rules tiebreak
        where tiebreak.tournament_id = tournament.id
          and tiebreak.organization_id = p_organization_id
      ), '[]'::jsonb),
      'discipline', (
        select jsonb_build_object(
          'yellowsForSuspension', discipline.yellows_for_suspension,
          'suspensionMatches', discipline.suspension_matches,
          'directRedSuggestedMatches', discipline.direct_red_suggested_matches,
          'doubleYellowCountsAsRed', discipline.double_yellow_counts_as_red,
          'resetYellowsEachStage', discipline.reset_yellows_each_stage,
          'fairPlayEnabled', discipline.fair_play_enabled,
          'yellowFairPlayPoints', discipline.yellow_fair_play_points,
          'redFairPlayPoints', discipline.red_fair_play_points
        )
        from public.tournament_discipline_rules discipline
        where discipline.tournament_id = tournament.id
          and discipline.organization_id = p_organization_id
      ),
      'checklist', public.tournament_registration_checklist(
        p_organization_id,
        tournament.id
      )
    ) order by tournament.updated_at desc, tournament.id
  ), '[]'::jsonb)
  into v_tournaments
  from public.tournaments tournament
  join public.tournament_seasons season
    on season.id = tournament.season_id
    and season.organization_id = tournament.organization_id
  where tournament.organization_id = p_organization_id
    and tournament.status <> 'archived'
    and season.status <> 'archived';

  return jsonb_build_object(
    'preference', jsonb_build_object(
      'organizationId', p_organization_id,
      'activeSeasonId', v_preference.active_season_id,
      'activeTournamentId', v_preference.active_tournament_id,
      'updatedAt', v_preference.updated_at
    ),
    'seasons', v_seasons,
    'tournaments', v_tournaments,
    'modalities', v_modalities,
    'formats', v_formats
  );
end;
$$;

revoke all on table public.tournament_sport_modalities from anon, authenticated;
revoke all on table public.tournament_competition_formats from anon, authenticated;
revoke all on table public.tournament_seasons from anon, authenticated;
revoke all on table public.tournaments from anon, authenticated;
revoke all on table public.tournament_categories from anon, authenticated;
revoke all on table public.tournament_scoring_rules from anon, authenticated;
revoke all on table public.tournament_tiebreak_rules from anon, authenticated;
revoke all on table public.tournament_discipline_rules from anon, authenticated;
revoke all on table public.user_tournament_context_preferences from anon, authenticated;

grant select on table public.tournament_sport_modalities to authenticated;
grant select on table public.tournament_competition_formats to authenticated;
grant select on table public.tournament_seasons to authenticated;
grant select on table public.tournaments to authenticated;
grant select on table public.tournament_categories to authenticated;
grant select on table public.tournament_scoring_rules to authenticated;
grant select on table public.tournament_tiebreak_rules to authenticated;
grant select on table public.tournament_discipline_rules to authenticated;
grant select on table public.user_tournament_context_preferences to authenticated;

revoke all on function public.normalize_tournament_competition_slug(text) from public;
revoke all on function public.is_valid_tournament_format_settings(text, jsonb) from public;
revoke all on function public.protect_tournament_competition_scope() from public;
revoke all on function public.tournament_registration_checklist(uuid, uuid) from public;
revoke all on function public.create_tournament_season(uuid, text, text, date, date, uuid) from public;
revoke all on function public.update_tournament_season(
  uuid,
  uuid,
  text,
  text,
  date,
  date,
  text,
  boolean,
  boolean
) from public;
revoke all on function public.create_tournament_with_defaults(uuid, uuid, text, text, text, text, text, text, date, date, uuid) from public;
revoke all on function public.update_tournament_configuration(uuid, uuid, jsonb) from public;
revoke all on function public.save_tournament_category(uuid, uuid, uuid, text, text, text, integer, smallint, smallint, text, text, smallint, text) from public;
revoke all on function public.change_tournament_status(uuid, uuid, text) from public;
revoke all on function public.set_active_tournament_context(uuid, uuid, uuid) from public;
revoke all on function public.get_tournament_competition_context(uuid) from public;

grant execute on function public.normalize_tournament_competition_slug(text)
  to authenticated;
grant execute on function public.is_valid_tournament_format_settings(text, jsonb)
  to authenticated;
grant execute on function public.tournament_registration_checklist(uuid, uuid)
  to authenticated;
grant execute on function public.create_tournament_season(uuid, text, text, date, date, uuid)
  to authenticated;
grant execute on function public.update_tournament_season(
  uuid,
  uuid,
  text,
  text,
  date,
  date,
  text,
  boolean,
  boolean
)
  to authenticated;
grant execute on function public.create_tournament_with_defaults(uuid, uuid, text, text, text, text, text, text, date, date, uuid)
  to authenticated;
grant execute on function public.update_tournament_configuration(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.save_tournament_category(uuid, uuid, uuid, text, text, text, integer, smallint, smallint, text, text, smallint, text)
  to authenticated;
grant execute on function public.change_tournament_status(uuid, uuid, text)
  to authenticated;
grant execute on function public.set_active_tournament_context(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.get_tournament_competition_context(uuid)
  to authenticated;

comment on table public.tournament_seasons is
  'Organization seasons for the isolated Arma2 Torneos competition core.';
comment on table public.tournaments is
  'Tournament identity, lifecycle and competition format defaults.';
comment on table public.tournament_categories is
  'Tournament-scoped categories with explicit optional modality and gender overrides.';
comment on table public.tournament_scoring_rules is
  'One scoring configuration per tournament. No standings are calculated in this phase.';
comment on table public.tournament_tiebreak_rules is
  'Ordered tiebreak criteria; points are implicit and always first.';
comment on table public.tournament_discipline_rules is
  'Pre-competition discipline defaults; does not create real sanctions.';
comment on table public.user_tournament_context_preferences is
  'Server-authoritative active season and tournament per user and organization.';
