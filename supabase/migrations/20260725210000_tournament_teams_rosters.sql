-- Arma2 Torneos: team registrations, managers and tournament rosters.
-- Local/dedicated staging only. Do not apply to the Arma2 production project.

create extension if not exists pgcrypto;

alter table public.tournament_categories
  add constraint tournament_categories_org_tournament_id_unique
  unique (organization_id, tournament_id, id);

create table public.tournament_roster_settings (
  tournament_id uuid primary key,
  organization_id uuid not null,
  minimum_players smallint not null,
  maximum_players smallint not null,
  shirt_number_required boolean not null default false,
  unique_shirt_numbers boolean not null default true,
  position_required boolean not null default false,
  minimum_goalkeepers smallint not null default 1,
  allow_provisional_players boolean not null default true,
  allow_players_without_account boolean not null default true,
  allow_player_multiple_teams boolean not null default false,
  require_individual_player_approval boolean not null default false,
  lock_changes_when_registration_closes boolean not null default true,
  roster_opens_at timestamptz,
  roster_closes_at timestamptz,
  future_reopens_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_roster_settings_tournament_fk
    foreign key (organization_id, tournament_id)
    references public.tournaments(organization_id, id) on delete restrict,
  constraint tournament_roster_settings_limits_check
    check (
      minimum_players between 1 and 60
      and maximum_players between minimum_players and 80
      and minimum_goalkeepers between 0 and maximum_players
    ),
  constraint tournament_roster_settings_dates_check
    check (
      roster_opens_at is null
      or roster_closes_at is null
      or roster_opens_at <= roster_closes_at
    ),
  constraint tournament_roster_settings_reopen_check
    check (
      future_reopens_at is null
      or roster_closes_at is null
      or future_reopens_at > roster_closes_at
    )
);

create table public.tournament_team_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  arma2_team_id uuid references public.teams(id) on delete restrict,
  name text not null,
  slug text not null,
  short_name text,
  shield_path text,
  primary_color text,
  secondary_color text,
  status text not null default 'draft',
  registration_source text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  submitted_by uuid references auth.users(id) on delete restrict,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  idempotency_key uuid not null,
  constraint tournament_team_entries_tournament_fk
    foreign key (organization_id, tournament_id, season_id)
    references public.tournaments(organization_id, id, season_id) on delete restrict,
  constraint tournament_team_entries_category_fk
    foreign key (organization_id, tournament_id, category_id)
    references public.tournament_categories(organization_id, tournament_id, id) on delete restrict,
  constraint tournament_team_entries_name_check
    check (name = btrim(name) and char_length(name) between 2 and 100),
  constraint tournament_team_entries_slug_check
    check (
      slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])$'
      and char_length(slug) between 2 and 64
    ),
  constraint tournament_team_entries_short_name_check
    check (short_name is null or char_length(btrim(short_name)) between 2 and 20),
  constraint tournament_team_entries_colors_check
    check (
      (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$')
      and (secondary_color is null or secondary_color ~ '^#[0-9A-Fa-f]{6}$')
    ),
  constraint tournament_team_entries_shield_path_check
    check (
      shield_path is null
      or (
        char_length(shield_path) between 1 and 512
        and shield_path ~ '^[a-zA-Z0-9][a-zA-Z0-9._/-]*$'
        and shield_path !~ '(^|/)\.{1,2}(/|$)'
        and shield_path !~ '//'
      )
    ),
  constraint tournament_team_entries_status_check
    check (status in (
      'draft', 'invited', 'in_progress', 'submitted', 'changes_requested',
      'approved', 'rejected', 'withdrawn', 'archived'
    )),
  constraint tournament_team_entries_source_check
    check (registration_source in ('manual', 'invitation', 'arma2_team', 'provisional')),
  constraint tournament_team_entries_source_identity_check
    check (
      (registration_source = 'arma2_team' and arma2_team_id is not null)
      or registration_source <> 'arma2_team'
    ),
  constraint tournament_team_entries_lifecycle_check
    check (
      (submitted_at is null or submitted_by is not null)
      and (approved_at is null or status in ('approved', 'withdrawn', 'archived'))
      and (rejected_at is null or status in ('rejected', 'archived'))
      and (withdrawn_at is null or status in ('withdrawn', 'archived'))
      and (
        (status = 'archived' and archived_at is not null)
        or (status <> 'archived' and archived_at is null)
      )
    ),
  constraint tournament_team_entries_idempotency_unique
    unique (organization_id, created_by, idempotency_key),
  constraint tournament_team_entries_org_id_unique unique (organization_id, id),
  constraint tournament_team_entries_org_tournament_id_unique
    unique (organization_id, tournament_id, id)
);

create unique index tournament_team_entries_linked_active_unique
  on public.tournament_team_entries (tournament_id, category_id, arma2_team_id)
  where arma2_team_id is not null
    and status not in ('withdrawn', 'archived', 'rejected');
create index tournament_team_entries_tournament_status_idx
  on public.tournament_team_entries (tournament_id, status, updated_at desc);
create index tournament_team_entries_category_status_idx
  on public.tournament_team_entries (category_id, status, name);

create table public.tournament_team_managers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  team_entry_id uuid not null,
  user_id uuid references auth.users(id) on delete restrict,
  email_normalized text,
  display_name text not null,
  role text not null,
  status text not null default 'pending',
  invited_by uuid not null references auth.users(id) on delete restrict,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_team_managers_entry_fk
    foreign key (organization_id, team_entry_id)
    references public.tournament_team_entries(organization_id, id) on delete restrict,
  constraint tournament_team_managers_name_check
    check (display_name = btrim(display_name) and char_length(display_name) between 2 and 100),
  constraint tournament_team_managers_email_check
    check (
      email_normalized is null
      or (
        email_normalized = lower(btrim(email_normalized))
        and char_length(email_normalized) between 5 and 254
        and email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ),
  constraint tournament_team_managers_identity_check
    check (user_id is not null or email_normalized is not null),
  constraint tournament_team_managers_role_check
    check (role in ('captain', 'delegate', 'assistant')),
  constraint tournament_team_managers_status_check
    check (status in ('pending', 'active', 'revoked')),
  constraint tournament_team_managers_lifecycle_check
    check (
      (status <> 'active' or (user_id is not null and accepted_at is not null))
      and (status <> 'revoked' or revoked_at is not null)
    ),
  constraint tournament_team_managers_scope_unique
    unique (organization_id, team_entry_id, id)
);

create unique index tournament_team_managers_active_user_unique
  on public.tournament_team_managers (team_entry_id, user_id)
  where user_id is not null and status <> 'revoked';
create unique index tournament_team_managers_active_email_unique
  on public.tournament_team_managers (team_entry_id, email_normalized)
  where email_normalized is not null and status <> 'revoked';
create index tournament_team_managers_user_status_idx
  on public.tournament_team_managers (user_id, status, team_entry_id);

create table public.tournament_team_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null,
  team_entry_id uuid not null,
  manager_id uuid not null,
  email_normalized text not null,
  role text not null,
  token_hash text not null unique,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint tournament_team_invitations_entry_fk
    foreign key (organization_id, tournament_id, team_entry_id)
    references public.tournament_team_entries(organization_id, tournament_id, id) on delete restrict,
  constraint tournament_team_invitations_tournament_fk
    foreign key (organization_id, tournament_id)
    references public.tournaments(organization_id, id) on delete restrict,
  constraint tournament_team_invitations_manager_fk
    foreign key (organization_id, team_entry_id, manager_id)
    references public.tournament_team_managers(organization_id, team_entry_id, id) on delete restrict,
  constraint tournament_team_invitations_role_check
    check (role in ('captain', 'delegate', 'assistant')),
  constraint tournament_team_invitations_status_check
    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  constraint tournament_team_invitations_expiry_check
    check (expires_at > created_at),
  constraint tournament_team_invitations_lifecycle_check
    check (
      (status <> 'accepted' or accepted_at is not null)
      and (status <> 'revoked' or revoked_at is not null)
      and (accepted_at is null or accepted_at <= expires_at)
    )
);

create index tournament_team_invitations_entry_status_idx
  on public.tournament_team_invitations (team_entry_id, status, created_at desc);
create index tournament_team_invitations_email_pending_idx
  on public.tournament_team_invitations (email_normalized, expires_at)
  where status = 'pending';

create table public.tournament_provisional_players (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.tournament_organizations(id) on delete restrict,
  display_name text not null,
  normalized_name text not null,
  contact_email text,
  contact_phone text,
  created_by uuid not null references auth.users(id) on delete restrict,
  claimed_by_user_id uuid references auth.users(id) on delete restrict,
  claim_status text not null default 'unclaimed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_provisional_players_name_check
    check (
      display_name = btrim(display_name)
      and char_length(display_name) between 2 and 100
      and char_length(normalized_name) between 2 and 120
    ),
  constraint tournament_provisional_players_email_check
    check (contact_email is null or char_length(contact_email) between 5 and 254),
  constraint tournament_provisional_players_phone_check
    check (contact_phone is null or char_length(contact_phone) between 6 and 32),
  constraint tournament_provisional_players_claim_check
    check (
      claim_status in ('unclaimed', 'pending', 'claimed', 'rejected')
      and (claim_status <> 'claimed' or claimed_by_user_id is not null)
    ),
  constraint tournament_provisional_players_org_id_unique unique (organization_id, id)
);

create index tournament_provisional_players_name_idx
  on public.tournament_provisional_players (organization_id, normalized_name);

create table public.tournament_rosters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  team_entry_id uuid not null,
  version integer not null default 1,
  status text not null default 'draft',
  submitted_at timestamptz,
  approved_at timestamptz,
  locked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_rosters_entry_fk
    foreign key (organization_id, team_entry_id)
    references public.tournament_team_entries(organization_id, id) on delete restrict,
  constraint tournament_rosters_version_check check (version > 0),
  constraint tournament_rosters_status_check
    check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'locked', 'superseded')),
  constraint tournament_rosters_lifecycle_check
    check (
      (status not in ('submitted', 'changes_requested', 'approved', 'locked', 'superseded') or submitted_at is not null)
      and (status not in ('approved', 'locked', 'superseded') or approved_at is not null)
      and (status <> 'locked' or locked_at is not null)
    ),
  constraint tournament_rosters_version_unique unique (team_entry_id, version),
  constraint tournament_rosters_org_id_unique unique (organization_id, id),
  constraint tournament_rosters_scope_unique
    unique (organization_id, team_entry_id, id)
);

create unique index tournament_rosters_editable_unique
  on public.tournament_rosters (team_entry_id)
  where status in ('draft', 'changes_requested');
create index tournament_rosters_entry_version_idx
  on public.tournament_rosters (team_entry_id, version desc);

create table public.tournament_roster_players (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  team_entry_id uuid not null,
  roster_id uuid not null,
  arma2_user_id uuid references auth.users(id) on delete restrict,
  provisional_player_id uuid,
  display_name text not null,
  avatar_url text,
  shirt_number smallint,
  primary_position text,
  secondary_position text,
  is_goalkeeper boolean not null default false,
  status text not null default 'active',
  eligibility_status text not null default 'pending',
  added_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint tournament_roster_players_roster_fk
    foreign key (organization_id, team_entry_id, roster_id)
    references public.tournament_rosters(organization_id, team_entry_id, id) on delete restrict,
  constraint tournament_roster_players_entry_fk
    foreign key (organization_id, team_entry_id)
    references public.tournament_team_entries(organization_id, id) on delete restrict,
  constraint tournament_roster_players_provisional_fk
    foreign key (organization_id, provisional_player_id)
    references public.tournament_provisional_players(organization_id, id) on delete restrict,
  constraint tournament_roster_players_identity_check
    check (num_nonnulls(arma2_user_id, provisional_player_id) = 1),
  constraint tournament_roster_players_name_check
    check (display_name = btrim(display_name) and char_length(display_name) between 2 and 100),
  constraint tournament_roster_players_avatar_check
    check (avatar_url is null or char_length(avatar_url) <= 1000),
  constraint tournament_roster_players_number_check
    check (shirt_number is null or shirt_number between 0 and 99),
  constraint tournament_roster_players_positions_check
    check (
      (primary_position is null or primary_position in ('ARQ', 'DEF', 'MED', 'DEL'))
      and (secondary_position is null or secondary_position in ('ARQ', 'DEF', 'MED', 'DEL'))
      and (secondary_position is null or secondary_position <> primary_position)
      and (not is_goalkeeper or primary_position = 'ARQ' or secondary_position = 'ARQ')
    ),
  constraint tournament_roster_players_status_check check (status in ('active', 'removed')),
  constraint tournament_roster_players_eligibility_check
    check (eligibility_status in ('pending', 'eligible', 'ineligible', 'under_review')),
  constraint tournament_roster_players_removed_check
    check (
      (status = 'active' and removed_at is null)
      or (status = 'removed' and removed_at is not null)
    )
);

create unique index tournament_roster_players_active_user_unique
  on public.tournament_roster_players (roster_id, arma2_user_id)
  where status = 'active' and arma2_user_id is not null;
create unique index tournament_roster_players_active_provisional_unique
  on public.tournament_roster_players (roster_id, provisional_player_id)
  where status = 'active' and provisional_player_id is not null;
create index tournament_roster_players_roster_active_idx
  on public.tournament_roster_players (roster_id, status, display_name);

create table public.tournament_team_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  team_entry_id uuid not null,
  roster_id uuid not null,
  decision text not null,
  reason text not null,
  issues jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tournament_team_reviews_entry_fk
    foreign key (organization_id, team_entry_id)
    references public.tournament_team_entries(organization_id, id) on delete restrict,
  constraint tournament_team_reviews_roster_fk
    foreign key (organization_id, team_entry_id, roster_id)
    references public.tournament_rosters(organization_id, team_entry_id, id) on delete restrict,
  constraint tournament_team_reviews_decision_check
    check (decision in ('changes_requested', 'approved', 'rejected')),
  constraint tournament_team_reviews_reason_check
    check (reason = btrim(reason) and char_length(reason) between 3 and 1200),
  constraint tournament_team_reviews_issues_check
    check (jsonb_typeof(issues) = 'array')
);

create index tournament_team_reviews_entry_created_idx
  on public.tournament_team_reviews (team_entry_id, created_at desc);

create table public.tournament_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null
    references public.tournament_organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_type text not null,
  action text not null,
  resource_type text not null,
  resource_id uuid not null,
  team_entry_id uuid,
  tournament_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint tournament_audit_log_actor_check
    check (actor_type in ('user', 'system')),
  constraint tournament_audit_log_action_check
    check (action ~ '^[a-z][a-z0-9_.]{2,80}$'),
  constraint tournament_audit_log_resource_check
    check (resource_type ~ '^[a-z][a-z0-9_]{2,60}$'),
  constraint tournament_audit_log_metadata_check
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  constraint tournament_audit_log_entry_context_check
    check (team_entry_id is null or tournament_id is not null),
  constraint tournament_audit_log_tournament_fk
    foreign key (organization_id, tournament_id)
    references public.tournaments(organization_id, id) on delete restrict,
  constraint tournament_audit_log_entry_fk
    foreign key (organization_id, tournament_id, team_entry_id)
    references public.tournament_team_entries(organization_id, tournament_id, id) on delete restrict
);

create index tournament_audit_log_org_created_idx
  on public.tournament_audit_log (organization_id, created_at desc);
create index tournament_audit_log_entry_created_idx
  on public.tournament_audit_log (team_entry_id, created_at desc)
  where team_entry_id is not null;

create or replace function public.normalize_tournament_person_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    translate(
      lower(btrim(coalesce(p_value, ''))),
      'áéíóúüñ',
      'aeiouun'
    ),
    '[^a-z0-9]+',
    ' ',
    'g'
  );
$$;

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
      'provisional_players.update', 'player_duplicates.override'
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
      'provisional_players.update', 'player_duplicates.override'
    ]::text[]
    when 'collaborator' then array[
      'organization.read', 'members.read', 'workspace.access',
      'seasons.read', 'tournaments.read', 'categories.read',
      'competition_rules.read', 'team_entries.read', 'team_managers.read',
      'rosters.read', 'roster_players.read'
    ]::text[]
    else array[]::text[]
  end;
$$;

create or replace function public.is_tournament_team_manager(
  p_team_entry_id uuid,
  p_require_edit boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournament_team_managers manager
    join public.tournament_team_entries entry on entry.id = manager.team_entry_id
    join public.tournament_organizations organization on organization.id = entry.organization_id
    join public.tournaments tournament on tournament.id = entry.tournament_id
    join public.tournament_categories category
      on category.id = entry.category_id
      and category.organization_id = entry.organization_id
      and category.tournament_id = entry.tournament_id
    where manager.team_entry_id = p_team_entry_id
      and manager.user_id = auth.uid()
      and manager.status = 'active'
      and organization.status = 'active'
      and tournament.status <> 'archived'
      and category.status = 'active'
      and entry.status <> 'archived'
      and (
        not p_require_edit
        or (
          manager.role in ('captain', 'delegate')
          and entry.status in ('draft', 'invited', 'in_progress', 'changes_requested')
        )
      )
  );
$$;

create or replace function public.can_read_tournament_team_entry(
  p_organization_id uuid,
  p_team_entry_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournament_team_entries entry
    join public.tournament_organizations organization
      on organization.id = entry.organization_id
    join public.tournaments tournament
      on tournament.id = entry.tournament_id
      and tournament.organization_id = entry.organization_id
    join public.tournament_categories category
      on category.id = entry.category_id
      and category.organization_id = entry.organization_id
      and category.tournament_id = entry.tournament_id
    where entry.id = p_team_entry_id
      and entry.organization_id = p_organization_id
      and entry.status <> 'archived'
      and organization.status = 'active'
      and tournament.status <> 'archived'
      and category.status = 'active'
      and (
        public.has_tournament_organization_capability(
          p_organization_id,
          'team_entries.read'
        )
        or public.is_tournament_team_manager(p_team_entry_id, false)
      )
  );
$$;

create or replace function public.can_edit_tournament_team_entry(
  p_organization_id uuid,
  p_team_entry_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournament_team_entries entry
    join public.tournament_organizations organization
      on organization.id = entry.organization_id
    join public.tournaments tournament
      on tournament.id = entry.tournament_id
      and tournament.organization_id = entry.organization_id
    join public.tournament_categories category
      on category.id = entry.category_id
      and category.organization_id = entry.organization_id
      and category.tournament_id = entry.tournament_id
    left join public.tournament_roster_settings settings
      on settings.organization_id = entry.organization_id
      and settings.tournament_id = entry.tournament_id
    where entry.id = p_team_entry_id
      and entry.organization_id = p_organization_id
      and organization.status = 'active'
      and category.status = 'active'
      and entry.status in ('draft', 'invited', 'in_progress', 'changes_requested')
      and (
        public.has_tournament_organization_capability(
          p_organization_id,
          'team_entries.update'
        )
        or exists (
          select 1
          from public.tournament_team_managers manager
          where manager.team_entry_id = entry.id
            and manager.organization_id = entry.organization_id
            and manager.user_id = auth.uid()
            and manager.status = 'active'
            and manager.role in ('captain', 'delegate')
        )
      )
      and (
        entry.status = 'changes_requested'
        or (
          tournament.status = 'registration'
          and (
            tournament.registration_opens_at is null
            or now() >= tournament.registration_opens_at
          )
          and (
            tournament.registration_closes_at is null
            or now() <= tournament.registration_closes_at
          )
          and (
            settings.roster_opens_at is null
            or now() >= settings.roster_opens_at
          )
          and (
            settings.roster_closes_at is null
            or now() <= settings.roster_closes_at
          )
        )
      )
  );
$$;

create or replace function public.append_tournament_audit(
  p_organization_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id uuid,
  p_team_entry_id uuid default null,
  p_tournament_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
    or pg_column_size(coalesce(p_metadata, '{}'::jsonb)) > 8192
  then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_AUDIT_METADATA';
  end if;
  insert into public.tournament_audit_log (
    organization_id, actor_user_id, actor_type, action, resource_type,
    resource_id, team_entry_id, tournament_id, metadata
  ) values (
    p_organization_id, auth.uid(), 'user', p_action, p_resource_type,
    p_resource_id, p_team_entry_id, p_tournament_id, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.validate_tournament_roster(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_roster_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entry public.tournament_team_entries%rowtype;
  v_settings public.tournament_roster_settings%rowtype;
  v_count integer;
  v_goalkeepers integer;
  v_missing_numbers integer;
  v_missing_positions integer;
  v_repeated_numbers integer;
  v_cross_team integer;
  v_pending_eligibility integer;
  v_errors text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
begin
  if auth.uid() is null or not public.can_read_tournament_team_entry(
    p_organization_id, p_team_entry_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  select * into v_entry from public.tournament_team_entries
  where id = p_team_entry_id and organization_id = p_organization_id;
  select * into v_settings from public.tournament_roster_settings
  where tournament_id = v_entry.tournament_id and organization_id = p_organization_id;

  if v_entry.id is null or v_settings.tournament_id is null or not exists (
    select 1 from public.tournament_rosters
    where id = p_roster_id and team_entry_id = p_team_entry_id
      and organization_id = p_organization_id
  ) or not exists (
    select 1
    from public.tournament_organizations organization
    join public.tournaments tournament
      on tournament.organization_id = organization.id
    join public.tournament_categories category
      on category.organization_id = tournament.organization_id
      and category.tournament_id = tournament.id
    where organization.id = p_organization_id
      and organization.status = 'active'
      and tournament.id = v_entry.tournament_id
      and tournament.status <> 'archived'
      and category.id = v_entry.category_id
      and category.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  select
    count(*),
    count(*) filter (where is_goalkeeper),
    count(*) filter (where shirt_number is null),
    count(*) filter (where primary_position is null),
    count(*) filter (where eligibility_status <> 'eligible')
  into v_count, v_goalkeepers, v_missing_numbers, v_missing_positions,
    v_pending_eligibility
  from public.tournament_roster_players
  where roster_id = p_roster_id and status = 'active';

  select count(*) into v_repeated_numbers from (
    select shirt_number
    from public.tournament_roster_players
    where roster_id = p_roster_id and status = 'active' and shirt_number is not null
    group by shirt_number having count(*) > 1
  ) repeated;

  select count(*) into v_cross_team
  from public.tournament_roster_players current_player
  join public.tournament_team_entries current_entry
    on current_entry.id = current_player.team_entry_id
  join public.tournament_roster_players other_player
    on other_player.team_entry_id <> current_player.team_entry_id
    and other_player.status = 'active'
    and (
      (
        current_player.arma2_user_id is not null
        and other_player.arma2_user_id = current_player.arma2_user_id
      )
      or (
        current_player.provisional_player_id is not null
        and other_player.provisional_player_id = current_player.provisional_player_id
      )
    )
  join public.tournament_team_entries other_entry
    on other_entry.id = other_player.team_entry_id
    and other_entry.tournament_id = current_entry.tournament_id
    and other_entry.category_id = current_entry.category_id
    and other_entry.status = 'approved'
  where current_player.roster_id = p_roster_id
    and current_player.status = 'active'
    and num_nonnulls(
      current_player.arma2_user_id,
      current_player.provisional_player_id
    ) = 1;

  if v_count < v_settings.minimum_players then v_errors := array_append(v_errors, 'minimum_players'); end if;
  if v_count > v_settings.maximum_players then v_errors := array_append(v_errors, 'maximum_players'); end if;
  if v_goalkeepers < v_settings.minimum_goalkeepers then v_errors := array_append(v_errors, 'minimum_goalkeepers'); end if;
  if v_settings.shirt_number_required and v_missing_numbers > 0 then v_errors := array_append(v_errors, 'shirt_number_required'); end if;
  if v_settings.position_required and v_missing_positions > 0 then v_errors := array_append(v_errors, 'position_required'); end if;
  if v_settings.unique_shirt_numbers and v_repeated_numbers > 0 then v_errors := array_append(v_errors, 'duplicate_shirt_number'); end if;
  if not v_settings.allow_player_multiple_teams and v_cross_team > 0 then v_errors := array_append(v_errors, 'player_already_approved'); end if;
  if v_settings.require_individual_player_approval and v_pending_eligibility > 0 then
    v_errors := array_append(v_errors, 'player_approval_required');
  end if;

  if exists (
    select 1
    from public.tournament_roster_players left_player
    join public.tournament_roster_players right_player
      on right_player.roster_id = left_player.roster_id
      and right_player.id > left_player.id
      and public.normalize_tournament_person_name(right_player.display_name)
        = public.normalize_tournament_person_name(left_player.display_name)
    where left_player.roster_id = p_roster_id
      and left_player.status = 'active'
      and right_player.status = 'active'
  ) then
    v_warnings := array_append(v_warnings, 'similar_player_names');
  end if;

  return jsonb_build_object(
    'valid', cardinality(v_errors) = 0,
    'errors', to_jsonb(v_errors),
    'warnings', to_jsonb(v_warnings),
    'counts', jsonb_build_object(
      'players', v_count,
      'goalkeepers', v_goalkeepers,
      'minimumPlayers', v_settings.minimum_players,
      'maximumPlayers', v_settings.maximum_players
    )
  );
end;
$$;

create or replace function public.create_tournament_team_entry(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_category_id uuid,
  p_arma2_team_id uuid,
  p_name text,
  p_short_name text,
  p_primary_color text,
  p_secondary_color text,
  p_registration_source text,
  p_manager_user_id uuid,
  p_manager_email text,
  p_manager_display_name text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tournament public.tournaments%rowtype;
  v_category public.tournament_categories%rowtype;
  v_arma2_team public.teams%rowtype;
  v_entry public.tournament_team_entries%rowtype;
  v_roster public.tournament_rosters%rowtype;
  v_manager public.tournament_team_managers%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text;
  v_source text := coalesce(p_registration_source, case when p_arma2_team_id is null then 'provisional' else 'arma2_team' end);
  v_email text := nullif(lower(btrim(coalesce(p_manager_email, ''))), '');
  v_primary_color text := p_primary_color;
  v_secondary_color text := p_secondary_color;
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  if not public.has_tournament_organization_capability(p_organization_id, 'team_entries.create') then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if p_idempotency_key is null then raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_tournament_id::text, 0));
  select * into v_entry from public.tournament_team_entries
  where organization_id = p_organization_id and created_by = v_uid
    and idempotency_key = p_idempotency_key;
  if v_entry.id is not null then
    select * into v_roster from public.tournament_rosters where team_entry_id = v_entry.id order by version desc limit 1;
    return jsonb_build_object('entryId', v_entry.id, 'rosterId', v_roster.id, 'status', v_entry.status);
  end if;

  select * into v_tournament from public.tournaments
  where id = p_tournament_id and organization_id = p_organization_id
    and status = 'registration' and archived_at is null
    and (registration_opens_at is null or now() >= registration_opens_at)
    and (registration_closes_at is null or now() <= registration_closes_at);
  select * into v_category from public.tournament_categories
  where id = p_category_id and organization_id = p_organization_id
    and tournament_id = p_tournament_id and status = 'active';
  if v_tournament.id is null or v_category.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_REGISTRATION_CLOSED';
  end if;
  if v_source not in ('manual', 'invitation', 'arma2_team', 'provisional')
    or ((v_source = 'arma2_team') <> (p_arma2_team_id is not null))
  then raise exception using errcode = '22023', message = 'TORNEOS_INVALID_TEAM_ENTRY'; end if;
  if p_manager_user_id is not null then
    raise exception using errcode = '22023', message = 'TORNEOS_MANAGER_INVITATION_REQUIRED';
  end if;
  if p_arma2_team_id is not null then
    select * into v_arma2_team
    from public.teams
    where id = p_arma2_team_id
      and is_active
      and public.team_user_is_admin_or_owner(id, v_uid);
    if v_arma2_team.id is null then
      raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
    end if;
    v_name := btrim(v_arma2_team.name);
    v_primary_color := v_arma2_team.color_primary;
    v_secondary_color := v_arma2_team.color_secondary;
  end if;
  if char_length(v_name) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_TEAM_ENTRY';
  end if;

  v_slug := public.normalize_tournament_competition_slug(v_name);
  if char_length(v_slug) < 2 then v_slug := 'equipo-' || substr(replace(public.gen_random_uuid()::text, '-', ''), 1, 8); end if;
  if exists (
    select 1 from public.tournament_team_entries
    where tournament_id = p_tournament_id and category_id = p_category_id and slug = v_slug
  ) then v_slug := left(v_slug, 54) || '-' || substr(replace(public.gen_random_uuid()::text, '-', ''), 1, 8); end if;

  insert into public.tournament_team_entries (
    organization_id, season_id, tournament_id, category_id, arma2_team_id,
    name, slug, short_name, primary_color, secondary_color, status,
    registration_source, created_by, idempotency_key
  ) values (
    p_organization_id, v_tournament.season_id, p_tournament_id, p_category_id,
    p_arma2_team_id, v_name, v_slug, nullif(btrim(coalesce(p_short_name, '')), ''),
    v_primary_color, v_secondary_color, 'draft',
    v_source, v_uid, p_idempotency_key
  ) returning * into v_entry;

  insert into public.tournament_rosters (
    organization_id, team_entry_id, version, status, created_by
  ) values (p_organization_id, v_entry.id, 1, 'draft', v_uid)
  returning * into v_roster;

  insert into public.tournament_roster_settings (
    tournament_id, organization_id, minimum_players, maximum_players,
    minimum_goalkeepers, roster_opens_at, roster_closes_at
  ) values (
    p_tournament_id, p_organization_id, v_tournament.team_size,
    least(80, v_tournament.team_size + coalesce(v_tournament.substitutes_limit, v_tournament.team_size)),
    1, v_tournament.registration_opens_at, v_tournament.registration_closes_at
  ) on conflict (tournament_id) do nothing;

  if v_email is not null then
    if char_length(btrim(coalesce(p_manager_display_name, ''))) not between 2 and 100 then
      raise exception using errcode = '22023', message = 'TORNEOS_INVALID_MANAGER';
    end if;
    insert into public.tournament_team_managers (
      organization_id, team_entry_id, user_id, email_normalized, display_name,
      role, status, invited_by, accepted_at
    ) values (
      p_organization_id, v_entry.id, null, v_email,
      btrim(p_manager_display_name), 'captain', 'pending',
      v_uid, null
    ) returning * into v_manager;
  end if;

  perform public.append_tournament_audit(
    p_organization_id, 'team_entry.created', 'team_entry', v_entry.id,
    v_entry.id, p_tournament_id,
    jsonb_build_object('source', v_source, 'categoryId', p_category_id, 'linked', p_arma2_team_id is not null)
  );
  return jsonb_build_object(
    'entryId', v_entry.id, 'rosterId', v_roster.id,
    'managerId', v_manager.id, 'status', v_entry.status
  );
exception when unique_violation then
  if p_arma2_team_id is not null then
    raise exception using errcode = '23505', message = 'TORNEOS_TEAM_ALREADY_REGISTERED';
  end if;
  raise;
end;
$$;

create or replace function public.update_tournament_team_entry(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.tournament_team_entries%rowtype;
  v_name text;
begin
  if auth.uid() is null or jsonb_typeof(p_patch) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_patch) key
    where key not in ('name', 'shortName', 'primaryColor', 'secondaryColor', 'shieldPath')
  ) then raise exception using errcode = '22023', message = 'TORNEOS_INVALID_PATCH'; end if;

  select * into v_entry from public.tournament_team_entries
  where id = p_team_entry_id and organization_id = p_organization_id for update;
  if v_entry.id is null or not public.can_edit_tournament_team_entry(
    p_organization_id,
    p_team_entry_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if v_entry.status not in ('draft', 'invited', 'in_progress', 'changes_requested') then
    raise exception using errcode = '23514', message = 'TORNEOS_ENTRY_NOT_EDITABLE';
  end if;
  v_name := case when p_patch ? 'name' then btrim(p_patch->>'name') else v_entry.name end;
  if char_length(v_name) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_TEAM_ENTRY';
  end if;
  update public.tournament_team_entries set
    name = v_name,
    short_name = case when p_patch ? 'shortName' then nullif(btrim(p_patch->>'shortName'), '') else short_name end,
    primary_color = case when p_patch ? 'primaryColor' then nullif(p_patch->>'primaryColor', '') else primary_color end,
    secondary_color = case when p_patch ? 'secondaryColor' then nullif(p_patch->>'secondaryColor', '') else secondary_color end,
    shield_path = case when p_patch ? 'shieldPath' then nullif(p_patch->>'shieldPath', '') else shield_path end,
    status = case when status in ('draft', 'invited') then 'in_progress' else status end
  where id = p_team_entry_id returning * into v_entry;
  perform public.append_tournament_audit(
    p_organization_id, 'team_entry.updated', 'team_entry', v_entry.id,
    v_entry.id, v_entry.tournament_id, jsonb_build_object('fields', (select jsonb_agg(key) from jsonb_object_keys(p_patch) key))
  );
  return jsonb_build_object('entryId', v_entry.id, 'status', v_entry.status, 'updatedAt', v_entry.updated_at);
end;
$$;

create or replace function public.create_tournament_provisional_player(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.tournament_provisional_players%rowtype;
  v_entry public.tournament_team_entries%rowtype;
begin
  select * into v_entry from public.tournament_team_entries
  where id = p_team_entry_id and organization_id = p_organization_id;
  if auth.uid() is null or v_entry.id is null
    or not public.can_edit_tournament_team_entry(
      p_organization_id,
      p_team_entry_id
    )
  then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_PLAYER';
  end if;
  insert into public.tournament_provisional_players (
    organization_id, display_name, normalized_name, created_by
  ) values (
    p_organization_id, btrim(p_display_name),
    public.normalize_tournament_person_name(p_display_name), auth.uid()
  ) returning * into v_player;
  perform public.append_tournament_audit(
    p_organization_id, 'provisional_player.created', 'provisional_player',
    v_player.id, p_team_entry_id, v_entry.tournament_id, '{}'::jsonb
  );
  return jsonb_build_object('id', v_player.id, 'displayName', v_player.display_name, 'claimStatus', v_player.claim_status);
end;
$$;

create or replace function public.add_tournament_roster_player(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_roster_id uuid,
  p_arma2_user_id uuid,
  p_provisional_player_id uuid,
  p_display_name text,
  p_avatar_url text,
  p_shirt_number smallint,
  p_primary_position text,
  p_secondary_position text,
  p_is_goalkeeper boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.tournament_team_entries%rowtype;
  v_roster public.tournament_rosters%rowtype;
  v_settings public.tournament_roster_settings%rowtype;
  v_player public.tournament_roster_players%rowtype;
  v_count integer;
  v_constraint_name text;
begin
  select * into v_entry from public.tournament_team_entries
  where id = p_team_entry_id and organization_id = p_organization_id;
  select * into v_roster from public.tournament_rosters
  where id = p_roster_id and team_entry_id = p_team_entry_id
    and organization_id = p_organization_id for update;
  if auth.uid() is null or v_entry.id is null or v_roster.id is null
    or v_roster.status not in ('draft', 'changes_requested')
    or not public.can_edit_tournament_team_entry(
      p_organization_id,
      p_team_entry_id
    )
  then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  if num_nonnulls(p_arma2_user_id, p_provisional_player_id) <> 1 then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_PLAYER_IDENTITY';
  end if;
  select * into v_settings from public.tournament_roster_settings
  where tournament_id = v_entry.tournament_id
    and organization_id = p_organization_id;
  if v_settings.tournament_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if p_provisional_player_id is not null then
    if not v_settings.allow_provisional_players
      or not v_settings.allow_players_without_account
      or not exists (
      select 1 from public.tournament_provisional_players
      where id = p_provisional_player_id and organization_id = p_organization_id
    ) then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  elsif not exists (select 1 from auth.users where id = p_arma2_user_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_roster_id::text, 0));
  select count(*) into v_count from public.tournament_roster_players
  where roster_id = p_roster_id and status = 'active';
  if v_count >= v_settings.maximum_players then
    raise exception using errcode = '23514', message = 'TORNEOS_ROSTER_MAXIMUM_REACHED';
  end if;
  if v_settings.unique_shirt_numbers and p_shirt_number is not null and exists (
    select 1 from public.tournament_roster_players
    where roster_id = p_roster_id and status = 'active' and shirt_number = p_shirt_number
  ) then raise exception using errcode = '23505', message = 'TORNEOS_DUPLICATE_SHIRT_NUMBER'; end if;
  insert into public.tournament_roster_players (
    organization_id, team_entry_id, roster_id, arma2_user_id,
    provisional_player_id, display_name, avatar_url, shirt_number,
    primary_position, secondary_position, is_goalkeeper, added_by
  ) values (
    p_organization_id, p_team_entry_id, p_roster_id, p_arma2_user_id,
    p_provisional_player_id, btrim(p_display_name), p_avatar_url, p_shirt_number,
    p_primary_position, p_secondary_position, coalesce(p_is_goalkeeper, false), auth.uid()
  ) returning * into v_player;
  perform public.append_tournament_audit(
    p_organization_id, 'roster_player.added', 'roster_player', v_player.id,
    p_team_entry_id, v_entry.tournament_id,
    jsonb_build_object('identityType', case when p_arma2_user_id is null then 'provisional' else 'arma2_user' end)
  );
  return jsonb_build_object('id', v_player.id, 'displayName', v_player.display_name, 'status', v_player.status);
exception when unique_violation then
  get stacked diagnostics v_constraint_name = constraint_name;
  if v_constraint_name in (
    'tournament_roster_players_active_user_unique',
    'tournament_roster_players_active_provisional_unique'
  ) then
    raise exception using errcode = '23505', message = 'TORNEOS_DUPLICATE_PLAYER';
  end if;
  raise;
end;
$$;

create or replace function public.update_tournament_roster_player(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_roster_player_id uuid,
  p_shirt_number smallint,
  p_primary_position text,
  p_secondary_position text,
  p_is_goalkeeper boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.tournament_roster_players%rowtype;
  v_roster public.tournament_rosters%rowtype;
  v_entry public.tournament_team_entries%rowtype;
  v_settings public.tournament_roster_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_player from public.tournament_roster_players
  where id = p_roster_player_id and organization_id = p_organization_id
    and team_entry_id = p_team_entry_id and status = 'active' for update;
  select * into v_roster from public.tournament_rosters where id = v_player.roster_id;
  select * into v_entry from public.tournament_team_entries where id = p_team_entry_id;
  select * into v_settings from public.tournament_roster_settings where tournament_id = v_entry.tournament_id;
  if v_player.id is null or v_roster.status not in ('draft', 'changes_requested')
    or not public.can_edit_tournament_team_entry(
      p_organization_id,
      p_team_entry_id
    )
  then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  if v_settings.unique_shirt_numbers and p_shirt_number is not null and exists (
    select 1 from public.tournament_roster_players
    where roster_id = v_player.roster_id and status = 'active'
      and shirt_number = p_shirt_number and id <> v_player.id
  ) then raise exception using errcode = '23505', message = 'TORNEOS_DUPLICATE_SHIRT_NUMBER'; end if;
  update public.tournament_roster_players set
    shirt_number = p_shirt_number,
    primary_position = p_primary_position,
    secondary_position = p_secondary_position,
    is_goalkeeper = coalesce(p_is_goalkeeper, false)
  where id = v_player.id returning * into v_player;
  perform public.append_tournament_audit(
    p_organization_id, 'roster_player.updated', 'roster_player', v_player.id,
    p_team_entry_id, v_entry.tournament_id, '{}'::jsonb
  );
  return jsonb_build_object('id', v_player.id, 'updatedAt', v_player.updated_at);
end;
$$;

create or replace function public.remove_tournament_roster_player(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_roster_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.tournament_roster_players%rowtype;
  v_roster public.tournament_rosters%rowtype;
  v_entry public.tournament_team_entries%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_player from public.tournament_roster_players
  where id = p_roster_player_id and organization_id = p_organization_id
    and team_entry_id = p_team_entry_id and status = 'active' for update;
  select * into v_roster from public.tournament_rosters where id = v_player.roster_id;
  select * into v_entry from public.tournament_team_entries where id = p_team_entry_id;
  if v_player.id is null or v_roster.status not in ('draft', 'changes_requested')
    or not public.can_edit_tournament_team_entry(
      p_organization_id,
      p_team_entry_id
    )
  then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  update public.tournament_roster_players set status = 'removed', removed_at = now()
  where id = v_player.id returning * into v_player;
  perform public.append_tournament_audit(
    p_organization_id, 'roster_player.removed', 'roster_player', v_player.id,
    p_team_entry_id, v_entry.tournament_id, '{}'::jsonb
  );
  return jsonb_build_object('id', v_player.id, 'status', v_player.status);
end;
$$;

create or replace function public.submit_tournament_team_entry(
  p_organization_id uuid,
  p_team_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.tournament_team_entries%rowtype;
  v_roster public.tournament_rosters%rowtype;
  v_validation jsonb;
begin
  select * into v_entry from public.tournament_team_entries
  where id = p_team_entry_id and organization_id = p_organization_id for update;
  select * into v_roster from public.tournament_rosters
  where team_entry_id = p_team_entry_id and status in ('draft', 'changes_requested')
  order by version desc limit 1 for update;
  if v_entry.id is null or v_entry.status not in ('in_progress', 'changes_requested')
    or not public.can_edit_tournament_team_entry(
      p_organization_id,
      p_team_entry_id
    )
  then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  if not exists (
    select 1 from public.tournament_team_managers
    where team_entry_id = p_team_entry_id and status = 'active'
  ) then raise exception using errcode = '23514', message = 'TORNEOS_MANAGER_REQUIRED'; end if;
  v_validation := public.validate_tournament_roster(p_organization_id, p_team_entry_id, v_roster.id);
  if not (v_validation->>'valid')::boolean then
    raise exception using errcode = '23514', message = 'TORNEOS_ROSTER_INCOMPLETE',
      detail = v_validation::text;
  end if;
  update public.tournament_rosters set status = 'submitted', submitted_at = now()
  where id = v_roster.id returning * into v_roster;
  update public.tournament_team_entries set
    status = 'submitted', submitted_by = auth.uid(), submitted_at = now(),
    reviewed_by = null, reviewed_at = null, rejected_at = null
  where id = v_entry.id returning * into v_entry;
  perform public.append_tournament_audit(
    p_organization_id, 'team_entry.submitted', 'team_entry', v_entry.id,
    v_entry.id, v_entry.tournament_id,
    jsonb_build_object('rosterId', v_roster.id, 'version', v_roster.version)
  );
  return jsonb_build_object('entryId', v_entry.id, 'rosterId', v_roster.id, 'status', v_entry.status, 'validation', v_validation);
end;
$$;

create or replace function public.review_tournament_team_entry(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_decision text,
  p_reason text,
  p_issues jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.tournament_team_entries%rowtype;
  v_roster public.tournament_rosters%rowtype;
  v_validation jsonb;
begin
  if auth.uid() is null or not public.has_tournament_organization_capability(
    p_organization_id,
    case when p_decision = 'approved' then 'team_entries.approve'
         when p_decision = 'rejected' then 'team_entries.reject'
         else 'team_entries.review' end
  ) then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  if p_decision not in ('changes_requested', 'approved', 'rejected')
    or char_length(btrim(coalesce(p_reason, ''))) not between 3 and 1200
    or jsonb_typeof(coalesce(p_issues, '[]'::jsonb)) <> 'array'
  then raise exception using errcode = '22023', message = 'TORNEOS_INVALID_REVIEW'; end if;
  select * into v_entry from public.tournament_team_entries
  where id = p_team_entry_id and organization_id = p_organization_id
    and status = 'submitted' for update;
  select * into v_roster from public.tournament_rosters
  where team_entry_id = p_team_entry_id and status = 'submitted'
  order by version desc limit 1 for update;
  if v_entry.id is null or v_roster.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if not exists (
    select 1
    from public.tournament_organizations organization
    join public.tournaments tournament
      on tournament.organization_id = organization.id
    join public.tournament_categories category
      on category.organization_id = tournament.organization_id
      and category.tournament_id = tournament.id
    where organization.id = p_organization_id
      and organization.status = 'active'
      and tournament.id = v_entry.tournament_id
      and tournament.status in ('registration', 'scheduled')
      and category.id = v_entry.category_id
      and category.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if p_decision = 'approved' then
    perform pg_advisory_xact_lock(hashtextextended(v_entry.tournament_id::text || ':' || v_entry.category_id::text, 0));
    v_validation := public.validate_tournament_roster(p_organization_id, p_team_entry_id, v_roster.id);
    if not (v_validation->>'valid')::boolean then
      raise exception using errcode = '23514', message = 'TORNEOS_ROSTER_INCOMPLETE', detail = v_validation::text;
    end if;
    update public.tournament_rosters set status = 'approved', approved_at = now()
    where id = v_roster.id returning * into v_roster;
    update public.tournament_roster_players set
      eligibility_status = case
        when eligibility_status = 'pending'
          and not (
            select settings.require_individual_player_approval
            from public.tournament_roster_settings settings
            where settings.organization_id = p_organization_id
              and settings.tournament_id = v_entry.tournament_id
          )
        then 'eligible'
        else eligibility_status
      end
    where roster_id = v_roster.id and status = 'active';
    update public.tournament_team_entries set
      status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
      approved_at = now(), rejected_at = null
    where id = v_entry.id returning * into v_entry;
  elsif p_decision = 'changes_requested' then
    update public.tournament_rosters set status = 'changes_requested'
    where id = v_roster.id returning * into v_roster;
    update public.tournament_team_entries set
      status = 'changes_requested', reviewed_by = auth.uid(), reviewed_at = now()
    where id = v_entry.id returning * into v_entry;
  else
    update public.tournament_team_entries set
      status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejected_at = now()
    where id = v_entry.id returning * into v_entry;
  end if;
  insert into public.tournament_team_reviews (
    organization_id, team_entry_id, roster_id, decision, reason, issues, created_by
  ) values (
    p_organization_id, v_entry.id, v_roster.id, p_decision, btrim(p_reason),
    coalesce(p_issues, '[]'::jsonb), auth.uid()
  );
  perform public.append_tournament_audit(
    p_organization_id, 'team_entry.' || p_decision, 'team_entry', v_entry.id,
    v_entry.id, v_entry.tournament_id,
    jsonb_build_object('rosterId', v_roster.id, 'issueCount', jsonb_array_length(coalesce(p_issues, '[]'::jsonb)))
  );
  return jsonb_build_object('entryId', v_entry.id, 'rosterId', v_roster.id, 'status', v_entry.status, 'validation', v_validation);
end;
$$;

create or replace function public.approve_tournament_team_entry(
  p_organization_id uuid, p_team_entry_id uuid, p_reason text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  return public.review_tournament_team_entry(
    p_organization_id,
    p_team_entry_id,
    'approved',
    p_reason,
    '[]'::jsonb
  );
end;
$$;

create or replace function public.reject_tournament_team_entry(
  p_organization_id uuid, p_team_entry_id uuid, p_reason text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  return public.review_tournament_team_entry(
    p_organization_id,
    p_team_entry_id,
    'rejected',
    p_reason,
    '[]'::jsonb
  );
end;
$$;

create or replace function public.withdraw_tournament_team_entry(
  p_organization_id uuid, p_team_entry_id uuid, p_reason text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_entry public.tournament_team_entries%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_entry from public.tournament_team_entries
  where id = p_team_entry_id and organization_id = p_organization_id for update;
  if v_entry.id is null or v_entry.status not in ('draft','invited','in_progress','changes_requested','approved')
    or not (
      public.has_tournament_organization_capability(p_organization_id, 'team_entries.withdraw')
      or public.is_tournament_team_manager(p_team_entry_id, false)
    )
    or not exists (
      select 1
      from public.tournaments tournament
      join public.tournament_categories category
        on category.organization_id = tournament.organization_id
        and category.tournament_id = tournament.id
      where tournament.id = v_entry.tournament_id
        and tournament.organization_id = p_organization_id
        and tournament.status <> 'archived'
        and category.id = v_entry.category_id
        and category.status = 'active'
    )
  then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'TORNEOS_REASON_REQUIRED';
  end if;
  update public.tournament_team_entries set status = 'withdrawn', withdrawn_at = now()
  where id = v_entry.id returning * into v_entry;
  perform public.append_tournament_audit(
    p_organization_id, 'team_entry.withdrawn', 'team_entry', v_entry.id,
    v_entry.id, v_entry.tournament_id, jsonb_build_object('reason', left(btrim(p_reason), 240))
  );
  return jsonb_build_object('entryId', v_entry.id, 'status', v_entry.status);
end;
$$;

create or replace function public.archive_tournament_team_entry(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_reason text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_entry public.tournament_team_entries%rowtype;
begin
  if auth.uid() is null or not public.has_tournament_organization_capability(
    p_organization_id,
    'team_entries.archive'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 1200 then
    raise exception using errcode = '22023', message = 'TORNEOS_REASON_REQUIRED';
  end if;
  select * into v_entry
  from public.tournament_team_entries
  where id = p_team_entry_id
    and organization_id = p_organization_id
    and status <> 'archived'
  for update;
  if v_entry.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  update public.tournament_team_invitations
  set status = 'revoked', revoked_at = now()
  where team_entry_id = v_entry.id and status = 'pending';
  update public.tournament_team_entries
  set status = 'archived', archived_at = now()
  where id = v_entry.id
  returning * into v_entry;
  perform public.append_tournament_audit(
    p_organization_id,
    'team_entry.archived',
    'team_entry',
    v_entry.id,
    v_entry.id,
    v_entry.tournament_id,
    jsonb_build_object('reason', left(btrim(p_reason), 240))
  );
  return jsonb_build_object('entryId', v_entry.id, 'status', v_entry.status);
end;
$$;

create or replace function public.lock_tournament_roster(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_roster_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_entry public.tournament_team_entries%rowtype;
  v_roster public.tournament_rosters%rowtype;
begin
  if auth.uid() is null or not public.has_tournament_organization_capability(
    p_organization_id,
    'rosters.lock'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select * into v_entry
  from public.tournament_team_entries
  where id = p_team_entry_id
    and organization_id = p_organization_id
    and status = 'approved'
  for update;
  select * into v_roster
  from public.tournament_rosters
  where id = p_roster_id
    and organization_id = p_organization_id
    and team_entry_id = p_team_entry_id
    and status = 'approved'
  for update;
  if v_entry.id is null or v_roster.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  update public.tournament_rosters
  set status = 'locked', locked_at = now()
  where id = v_roster.id
  returning * into v_roster;
  perform public.append_tournament_audit(
    p_organization_id,
    'roster.locked',
    'roster',
    v_roster.id,
    v_entry.id,
    v_entry.tournament_id,
    jsonb_build_object('version', v_roster.version)
  );
  return jsonb_build_object(
    'entryId', v_entry.id,
    'rosterId', v_roster.id,
    'status', v_roster.status
  );
end;
$$;

create or replace function public.invite_tournament_team_manager(
  p_organization_id uuid,
  p_team_entry_id uuid,
  p_email text,
  p_display_name text,
  p_role text default 'captain'
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_entry public.tournament_team_entries%rowtype;
  v_manager public.tournament_team_managers%rowtype;
  v_invitation public.tournament_team_invitations%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
begin
  select * into v_entry from public.tournament_team_entries
  where id = p_team_entry_id and organization_id = p_organization_id for update;
  if v_entry.id is null or not public.has_tournament_organization_capability(
    p_organization_id, 'team_managers.invite'
  ) or not public.can_edit_tournament_team_entry(
    p_organization_id,
    p_team_entry_id
  ) then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_role not in ('captain','delegate','assistant')
    or char_length(btrim(coalesce(p_display_name,''))) not between 2 and 100
  then raise exception using errcode = '22023', message = 'TORNEOS_INVALID_MANAGER'; end if;
  if (
    select count(*) from public.tournament_team_invitations
    where created_by = auth.uid() and created_at > now() - interval '10 minutes'
  ) >= 10 then raise exception using errcode = 'P0001', message = 'TORNEOS_INVITATION_RATE_LIMITED'; end if;
  if (
    select count(*) from public.tournament_team_managers
    where team_entry_id = p_team_entry_id and status <> 'revoked'
  ) >= 20 and not exists (
    select 1 from public.tournament_team_managers
    where team_entry_id = p_team_entry_id
      and email_normalized = v_email
      and status <> 'revoked'
  ) then
    raise exception using errcode = 'P0001', message = 'TORNEOS_INVITATION_RATE_LIMITED';
  end if;
  update public.tournament_team_invitations set status = 'revoked', revoked_at = now()
  where team_entry_id = p_team_entry_id and email_normalized = v_email and status = 'pending';
  select * into v_manager from public.tournament_team_managers
  where team_entry_id = p_team_entry_id and email_normalized = v_email and status <> 'revoked'
  order by created_at desc limit 1;
  if v_manager.id is null then
    insert into public.tournament_team_managers (
      organization_id, team_entry_id, email_normalized, display_name,
      role, status, invited_by
    ) values (
      p_organization_id, p_team_entry_id, v_email, btrim(p_display_name),
      p_role, 'pending', auth.uid()
    ) returning * into v_manager;
  else
    update public.tournament_team_managers set
      display_name = btrim(p_display_name),
      role = p_role,
      invited_by = auth.uid(),
      invited_at = now()
    where id = v_manager.id
    returning * into v_manager;
  end if;
  v_token := encode(public.gen_random_bytes(32), 'hex');
  insert into public.tournament_team_invitations (
    organization_id, tournament_id, team_entry_id, manager_id,
    email_normalized, role, token_hash, expires_at, created_by
  ) values (
    p_organization_id, v_entry.tournament_id, p_team_entry_id, v_manager.id,
    v_email, p_role, encode(public.digest(v_token, 'sha256'), 'hex'),
    now() + interval '7 days', auth.uid()
  ) returning * into v_invitation;
  update public.tournament_team_entries set status = case when status = 'draft' then 'invited' else status end
  where id = p_team_entry_id;
  perform public.append_tournament_audit(
    p_organization_id, 'team_manager.invited', 'team_manager', v_manager.id,
    p_team_entry_id, v_entry.tournament_id,
    jsonb_build_object('role', p_role, 'expiresAt', v_invitation.expires_at)
  );
  return jsonb_build_object(
    'invitationId', v_invitation.id, 'token', v_token,
    'expiresAt', v_invitation.expires_at, 'environment', 'test-only'
  );
end;
$$;

create or replace function public.accept_tournament_team_invitation(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_invitation public.tournament_team_invitations%rowtype;
  v_user_email text;
  v_email_verified_at timestamptz;
  v_email_has_edge_space boolean;
begin
  if auth.uid() is null or char_length(coalesce(p_token, '')) <> 64 then
    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_INVALID';
  end if;
  select * into v_invitation from public.tournament_team_invitations
  where token_hash = encode(public.digest(p_token, 'sha256'), 'hex') for update;
  if v_invitation.id is null or v_invitation.status <> 'pending' then
    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_INVALID';
  end if;
  if v_invitation.expires_at <= now() then
    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_EXPIRED';
  end if;
  if not exists (
    select 1
    from public.tournament_organizations organization
    join public.tournament_team_entries entry
      on entry.organization_id = organization.id
    join public.tournaments tournament
      on tournament.organization_id = entry.organization_id
      and tournament.id = entry.tournament_id
    join public.tournament_categories category
      on category.organization_id = entry.organization_id
      and category.tournament_id = entry.tournament_id
      and category.id = entry.category_id
    where organization.id = v_invitation.organization_id
      and organization.status = 'active'
      and entry.id = v_invitation.team_entry_id
      and entry.status in ('invited', 'in_progress', 'changes_requested')
      and tournament.id = v_invitation.tournament_id
      and tournament.status = 'registration'
      and (
        tournament.registration_opens_at is null
        or now() >= tournament.registration_opens_at
      )
      and (
        tournament.registration_closes_at is null
        or now() <= tournament.registration_closes_at
      )
      and category.status = 'active'
  ) or not exists (
    select 1
    from public.tournament_team_managers manager
    where manager.id = v_invitation.manager_id
      and manager.organization_id = v_invitation.organization_id
      and manager.team_entry_id = v_invitation.team_entry_id
      and manager.status = 'pending'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_INVALID';
  end if;
  select lower(email), email_confirmed_at, email is distinct from btrim(email)
  into v_user_email, v_email_verified_at, v_email_has_edge_space
  from auth.users
  where id = auth.uid();
  if v_email_verified_at is null
    or v_email_has_edge_space
    or v_user_email is distinct from v_invitation.email_normalized
  then
    raise exception using errcode = '42501', message = 'TORNEOS_INVITATION_INVALID';
  end if;
  update public.tournament_team_managers set
    user_id = auth.uid(), status = 'active', accepted_at = now()
  where id = v_invitation.manager_id
    and organization_id = v_invitation.organization_id
    and team_entry_id = v_invitation.team_entry_id
    and status = 'pending';
  update public.tournament_team_invitations set status = 'accepted', accepted_at = now()
  where id = v_invitation.id;
  update public.tournament_team_entries set status = case when status = 'invited' then 'in_progress' else status end
  where id = v_invitation.team_entry_id;
  perform public.append_tournament_audit(
    v_invitation.organization_id, 'team_manager.invitation_accepted',
    'team_manager', v_invitation.manager_id, v_invitation.team_entry_id,
    v_invitation.tournament_id, '{}'::jsonb
  );
  return jsonb_build_object(
    'teamEntryId', v_invitation.team_entry_id,
    'organizationId', v_invitation.organization_id,
    'status', 'accepted'
  );
end;
$$;

create or replace function public.revoke_tournament_team_invitation(
  p_organization_id uuid, p_invitation_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_invitation public.tournament_team_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_invitation from public.tournament_team_invitations
  where id = p_invitation_id and organization_id = p_organization_id for update;
  if v_invitation.id is null or v_invitation.status not in ('pending', 'accepted')
    or not public.has_tournament_organization_capability(p_organization_id, 'team_managers.revoke')
  then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  update public.tournament_team_invitations set status = 'revoked', revoked_at = now()
  where id = v_invitation.id;
  update public.tournament_team_managers set status = 'revoked', revoked_at = now()
  where id = v_invitation.manager_id
    and organization_id = v_invitation.organization_id
    and team_entry_id = v_invitation.team_entry_id
    and status in ('pending', 'active');
  perform public.append_tournament_audit(
    p_organization_id,
    case
      when v_invitation.status = 'accepted' then 'team_manager.revoked'
      else 'team_manager.invitation_revoked'
    end,
    'team_manager',
    v_invitation.manager_id, v_invitation.team_entry_id,
    v_invitation.tournament_id, '{}'::jsonb
  );
  return jsonb_build_object('invitationId', v_invitation.id, 'status', 'revoked');
end;
$$;

create or replace function public.search_tournament_players(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_query text,
  p_limit integer default 8,
  p_team_entry_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null
    or not (
      public.has_tournament_organization_capability(
        p_organization_id,
        'roster_players.read'
      )
      or (
        p_team_entry_id is not null
        and public.can_edit_tournament_team_entry(
          p_organization_id,
          p_team_entry_id
        )
        and exists (
          select 1
          from public.tournament_team_entries entry
          where entry.id = p_team_entry_id
            and entry.organization_id = p_organization_id
            and entry.tournament_id = p_tournament_id
        )
      )
    )
    or not exists (
      select 1 from public.tournaments
      where id = p_tournament_id and organization_id = p_organization_id and status <> 'archived'
    )
    or char_length(btrim(coalesce(p_query, ''))) < 2
  then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  if (
    select count(*)
    from public.tournament_audit_log audit
    where audit.actor_user_id = auth.uid()
      and audit.action = 'search.players'
      and audit.created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception using errcode = 'P0001', message = 'TORNEOS_SEARCH_RATE_LIMITED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', result.id,
    'displayName', result.nombre,
    'avatarUrl', result.avatar_url,
    'positions', result.posiciones,
    'linkedAccount', true,
    'teamName', result.team_name
  ) order by result.priority desc, result.nombre), '[]'::jsonb)
  into v_result
  from (
    select distinct on (user_profile.id)
      user_profile.id, user_profile.nombre, user_profile.avatar_url,
      coalesce(user_profile.posiciones, array[]::text[]) posiciones,
      team.name team_name,
      case when team.id is null then 0 else 1 end priority
    from public.usuarios user_profile
    left join public.team_members member on member.jugador_id in (
      select player.id from public.jugadores player
      where player.usuario_id = user_profile.id order by player.id desc limit 1
    )
    left join public.teams team on team.id = member.team_id and team.is_active
    where public.normalize_tournament_person_name(user_profile.nombre)
      like '%' || public.normalize_tournament_person_name(p_query) || '%'
      and coalesce(user_profile.is_active, true)
    order by user_profile.id, priority desc
    limit least(greatest(coalesce(p_limit, 8), 1), 12)
  ) result;
  perform public.append_tournament_audit(
    p_organization_id,
    'search.players',
    'tournament',
    p_tournament_id,
    p_team_entry_id,
    p_tournament_id,
    jsonb_build_object(
      'queryLength',
      char_length(btrim(p_query)),
      'resultCount',
      jsonb_array_length(v_result)
    )
  );
  return v_result;
end;
$$;

create or replace function public.search_tournament_arma2_teams(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_query text,
  p_limit integer default 8
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null
    or not public.has_tournament_organization_capability(p_organization_id, 'team_entries.create')
    or not exists (
      select 1 from public.tournaments
      where id = p_tournament_id and organization_id = p_organization_id
        and status = 'registration'
    )
    or char_length(btrim(coalesce(p_query, ''))) < 2
  then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  if (
    select count(*)
    from public.tournament_audit_log audit
    where audit.actor_user_id = auth.uid()
      and audit.action = 'search.teams'
      and audit.created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception using errcode = 'P0001', message = 'TORNEOS_SEARCH_RATE_LIMITED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', team.id,
    'name', team.name,
    'crestUrl', team.crest_url,
    'primaryColor', team.color_primary,
    'secondaryColor', team.color_secondary,
    'format', team.format
  ) order by team.name), '[]'::jsonb)
  into v_result
  from (
    select source.*
    from public.teams source
    where source.is_active
      and public.team_user_is_admin_or_owner(source.id, auth.uid())
      and public.normalize_tournament_person_name(source.name)
        like '%' || public.normalize_tournament_person_name(p_query) || '%'
    order by source.name
    limit least(greatest(coalesce(p_limit, 8), 1), 12)
  ) team;
  perform public.append_tournament_audit(
    p_organization_id,
    'search.teams',
    'tournament',
    p_tournament_id,
    null,
    p_tournament_id,
    jsonb_build_object(
      'queryLength',
      char_length(btrim(p_query)),
      'resultCount',
      jsonb_array_length(v_result)
    )
  );
  return v_result;
end;
$$;

create or replace function public.get_tournament_teams_context(
  p_organization_id uuid,
  p_tournament_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null
    or not public.has_tournament_organization_capability(p_organization_id, 'team_entries.read')
  then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  if not exists (
    select 1 from public.tournaments where id = p_tournament_id
      and organization_id = p_organization_id and status <> 'archived'
  ) then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  select jsonb_build_object(
    'tournamentId', p_tournament_id,
    'settings', coalesce((
      select jsonb_build_object(
        'minimumPlayers', minimum_players, 'maximumPlayers', maximum_players,
        'shirtNumberRequired', shirt_number_required,
        'uniqueShirtNumbers', unique_shirt_numbers,
        'positionRequired', position_required,
        'minimumGoalkeepers', minimum_goalkeepers,
        'allowProvisionalPlayers', allow_provisional_players,
        'allowPlayerMultipleTeams', allow_player_multiple_teams,
        'rosterOpensAt', roster_opens_at, 'rosterClosesAt', roster_closes_at
      ) from public.tournament_roster_settings
      where tournament_id = p_tournament_id
    ), '{}'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', entry.id, 'name', entry.name, 'shortName', entry.short_name,
        'categoryId', entry.category_id, 'categoryName', category.name,
        'arma2TeamId', entry.arma2_team_id, 'linked', entry.arma2_team_id is not null,
        'status', entry.status, 'registrationSource', entry.registration_source,
        'submittedAt', entry.submitted_at, 'updatedAt', entry.updated_at,
        'manager', (
          select jsonb_build_object('displayName', manager.display_name, 'role', manager.role, 'status', manager.status)
          from public.tournament_team_managers manager
          where manager.team_entry_id = entry.id and manager.status <> 'revoked'
          order by (manager.role = 'captain') desc, manager.created_at limit 1
        ),
        'roster', (
          select jsonb_build_object(
            'id', roster.id, 'version', roster.version, 'status', roster.status,
            'playerCount', (select count(*) from public.tournament_roster_players player where player.roster_id = roster.id and player.status = 'active'),
            'goalkeeperCount', (select count(*) from public.tournament_roster_players player where player.roster_id = roster.id and player.status = 'active' and player.is_goalkeeper)
          )
          from public.tournament_rosters roster
          where roster.team_entry_id = entry.id order by roster.version desc limit 1
        ),
        'hasObservations', exists (
          select 1 from public.tournament_team_reviews review
          where review.team_entry_id = entry.id and review.decision = 'changes_requested'
        )
      ) order by category.sort_order, entry.name)
      from public.tournament_team_entries entry
      join public.tournament_categories category on category.id = entry.category_id
      where entry.organization_id = p_organization_id
        and entry.tournament_id = p_tournament_id and entry.status <> 'archived'
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_team_registration_context(
  p_organization_id uuid,
  p_team_entry_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.can_read_tournament_team_entry(
    p_organization_id, p_team_entry_id
  ) then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  select jsonb_build_object(
    'entry', jsonb_build_object(
      'id', entry.id, 'organizationId', entry.organization_id,
      'seasonId', entry.season_id, 'tournamentId', entry.tournament_id,
      'categoryId', entry.category_id, 'name', entry.name, 'slug', entry.slug,
      'shortName', entry.short_name, 'shieldPath', entry.shield_path,
      'primaryColor', entry.primary_color, 'secondaryColor', entry.secondary_color,
      'status', entry.status, 'registrationSource', entry.registration_source,
      'linked', entry.arma2_team_id is not null, 'submittedAt', entry.submitted_at
    ),
    'tournament', jsonb_build_object(
      'id', tournament.id, 'name', tournament.name, 'status', tournament.status,
      'registrationClosesAt', tournament.registration_closes_at
    ),
    'category', jsonb_build_object('id', category.id, 'name', category.name),
    'settings', (
      select jsonb_build_object(
        'minimumPlayers', settings.minimum_players,
        'maximumPlayers', settings.maximum_players,
        'shirtNumberRequired', settings.shirt_number_required,
        'uniqueShirtNumbers', settings.unique_shirt_numbers,
        'positionRequired', settings.position_required,
        'minimumGoalkeepers', settings.minimum_goalkeepers,
        'allowProvisionalPlayers', settings.allow_provisional_players
      ) from public.tournament_roster_settings settings
      where settings.tournament_id = entry.tournament_id
    ),
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', manager.id, 'displayName', manager.display_name,
        'role', manager.role, 'status', manager.status,
        'isCurrentUser', manager.user_id = auth.uid()
      ) order by manager.created_at)
      from public.tournament_team_managers manager
      where manager.team_entry_id = entry.id and manager.status <> 'revoked'
    ), '[]'::jsonb),
    'roster', (
      select jsonb_build_object(
        'id', roster.id, 'version', roster.version, 'status', roster.status,
        'players', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', player.id, 'arma2UserId', player.arma2_user_id,
            'provisionalPlayerId', player.provisional_player_id,
            'displayName', player.display_name, 'avatarUrl', player.avatar_url,
            'shirtNumber', player.shirt_number,
            'primaryPosition', player.primary_position,
            'secondaryPosition', player.secondary_position,
            'isGoalkeeper', player.is_goalkeeper,
            'eligibilityStatus', player.eligibility_status
          ) order by player.shirt_number nulls last, player.display_name)
          from public.tournament_roster_players player
          where player.roster_id = roster.id and player.status = 'active'
        ), '[]'::jsonb)
      )
      from public.tournament_rosters roster
      where roster.team_entry_id = entry.id order by roster.version desc limit 1
    ),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', review.id, 'decision', review.decision, 'reason', review.reason,
        'issues', review.issues, 'createdAt', review.created_at
      ) order by review.created_at desc)
      from public.tournament_team_reviews review
      where review.team_entry_id = entry.id
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', audit.id, 'action', audit.action, 'resourceType', audit.resource_type,
        'metadata', audit.metadata, 'createdAt', audit.created_at
      ) order by audit.created_at desc)
      from (
        select * from public.tournament_audit_log
        where team_entry_id = entry.id order by created_at desc limit 50
      ) audit
    ), '[]'::jsonb)
  ) into v_result
  from public.tournament_team_entries entry
  join public.tournaments tournament on tournament.id = entry.tournament_id
  join public.tournament_categories category on category.id = entry.category_id
  where entry.id = p_team_entry_id and entry.organization_id = p_organization_id;
  if v_result is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  return v_result;
end;
$$;

create or replace function public.protect_tournament_registration_scope()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'tournament_team_entries' and (
    to_jsonb(new)->>'id' is distinct from to_jsonb(old)->>'id'
    or to_jsonb(new)->>'organization_id' is distinct from to_jsonb(old)->>'organization_id'
    or to_jsonb(new)->>'season_id' is distinct from to_jsonb(old)->>'season_id'
    or to_jsonb(new)->>'tournament_id' is distinct from to_jsonb(old)->>'tournament_id'
    or to_jsonb(new)->>'category_id' is distinct from to_jsonb(old)->>'category_id'
    or to_jsonb(new)->>'created_by' is distinct from to_jsonb(old)->>'created_by'
    or to_jsonb(new)->>'idempotency_key' is distinct from to_jsonb(old)->>'idempotency_key'
  ) then raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
  elsif tg_table_name in ('tournament_team_managers','tournament_rosters','tournament_roster_players')
    and (
      to_jsonb(new)->>'id' is distinct from to_jsonb(old)->>'id'
      or
      to_jsonb(new)->>'organization_id' is distinct from to_jsonb(old)->>'organization_id'
      or to_jsonb(new)->>'team_entry_id' is distinct from to_jsonb(old)->>'team_entry_id'
      or (
        tg_table_name = 'tournament_roster_players'
        and to_jsonb(new)->>'roster_id' is distinct from to_jsonb(old)->>'roster_id'
      )
      or (
        tg_table_name = 'tournament_rosters'
        and to_jsonb(new)->>'version' is distinct from to_jsonb(old)->>'version'
      )
    )
  then raise exception using errcode = '23514', message = 'TORNEOS_SCOPE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create or replace function public.reject_tournament_audit_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'TORNEOS_AUDIT_APPEND_ONLY';
end;
$$;

create trigger tournament_team_entries_touch before update on public.tournament_team_entries
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_team_managers_touch before update on public.tournament_team_managers
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_provisional_players_touch before update on public.tournament_provisional_players
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_rosters_touch before update on public.tournament_rosters
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_roster_players_touch before update on public.tournament_roster_players
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_roster_settings_touch before update on public.tournament_roster_settings
for each row execute function public.touch_tournament_workspace_updated_at();
create trigger tournament_team_entries_scope before update on public.tournament_team_entries
for each row execute function public.protect_tournament_registration_scope();
create trigger tournament_team_managers_scope before update on public.tournament_team_managers
for each row execute function public.protect_tournament_registration_scope();
create trigger tournament_rosters_scope before update on public.tournament_rosters
for each row execute function public.protect_tournament_registration_scope();
create trigger tournament_roster_players_scope before update on public.tournament_roster_players
for each row execute function public.protect_tournament_registration_scope();
create trigger tournament_audit_append_only before update or delete on public.tournament_audit_log
for each row execute function public.reject_tournament_audit_mutation();

alter table public.tournament_roster_settings enable row level security;
alter table public.tournament_team_entries enable row level security;
alter table public.tournament_team_managers enable row level security;
alter table public.tournament_team_invitations enable row level security;
alter table public.tournament_provisional_players enable row level security;
alter table public.tournament_rosters enable row level security;
alter table public.tournament_roster_players enable row level security;
alter table public.tournament_team_reviews enable row level security;
alter table public.tournament_audit_log enable row level security;

create policy tournament_roster_settings_select_scope on public.tournament_roster_settings
for select to authenticated using (
  public.has_tournament_organization_capability(organization_id, 'rosters.read')
  and exists (
    select 1
    from public.tournaments tournament
    where tournament.id = tournament_roster_settings.tournament_id
      and tournament.organization_id = tournament_roster_settings.organization_id
      and tournament.status <> 'archived'
  )
);
create policy tournament_team_entries_select_scope on public.tournament_team_entries
for select to authenticated using (
  public.can_read_tournament_team_entry(organization_id, id)
);
create policy tournament_team_managers_select_scope on public.tournament_team_managers
for select to authenticated using (
  public.can_read_tournament_team_entry(organization_id, team_entry_id)
);
create policy tournament_team_invitations_select_scope on public.tournament_team_invitations
for select to authenticated using (
  public.has_tournament_organization_capability(organization_id, 'team_managers.read')
  and public.can_read_tournament_team_entry(organization_id, team_entry_id)
);
create policy tournament_provisional_players_select_scope on public.tournament_provisional_players
for select to authenticated using (
  public.has_tournament_organization_capability(organization_id, 'roster_players.read')
  or exists (
    select 1 from public.tournament_roster_players player
    where player.provisional_player_id = tournament_provisional_players.id
      and public.is_tournament_team_manager(player.team_entry_id, false)
  )
);
create policy tournament_rosters_select_scope on public.tournament_rosters
for select to authenticated using (
  public.can_read_tournament_team_entry(organization_id, team_entry_id)
);
create policy tournament_roster_players_select_scope on public.tournament_roster_players
for select to authenticated using (
  public.can_read_tournament_team_entry(organization_id, team_entry_id)
);
create policy tournament_team_reviews_select_scope on public.tournament_team_reviews
for select to authenticated using (
  public.can_read_tournament_team_entry(organization_id, team_entry_id)
);
create policy tournament_audit_log_select_scope on public.tournament_audit_log
for select to authenticated using (
  public.has_tournament_organization_capability(organization_id, 'team_entries.review')
  or (team_entry_id is not null and public.is_tournament_team_manager(team_entry_id, false))
);

revoke all on table public.tournament_roster_settings from anon, authenticated;
revoke all on table public.tournament_team_entries from anon, authenticated;
revoke all on table public.tournament_team_managers from anon, authenticated;
revoke all on table public.tournament_team_invitations from anon, authenticated;
revoke all on table public.tournament_provisional_players from anon, authenticated;
revoke all on table public.tournament_rosters from anon, authenticated;
revoke all on table public.tournament_roster_players from anon, authenticated;
revoke all on table public.tournament_team_reviews from anon, authenticated;
revoke all on table public.tournament_audit_log from anon, authenticated;
grant select on public.tournament_roster_settings to authenticated;
grant select on public.tournament_team_entries to authenticated;
grant select (
  id, organization_id, team_entry_id, user_id, display_name, role, status,
  invited_by, invited_at, accepted_at, revoked_at, created_at, updated_at
) on public.tournament_team_managers to authenticated;
grant select (
  id, organization_id, tournament_id, team_entry_id, manager_id, role, status,
  expires_at, created_by, created_at, accepted_at, revoked_at
) on public.tournament_team_invitations to authenticated;
grant select (
  id, organization_id, display_name, normalized_name, claim_status,
  created_at, updated_at
) on public.tournament_provisional_players to authenticated;
grant select on public.tournament_rosters to authenticated;
grant select on public.tournament_roster_players to authenticated;
grant select on public.tournament_team_reviews to authenticated;
grant select on public.tournament_audit_log to authenticated;

revoke all on function public.normalize_tournament_person_name(text) from public;
revoke all on function public.is_tournament_team_manager(uuid, boolean) from public;
revoke all on function public.can_read_tournament_team_entry(uuid, uuid) from public;
revoke all on function public.can_edit_tournament_team_entry(uuid, uuid) from public;
revoke all on function public.append_tournament_audit(uuid, text, text, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.validate_tournament_roster(uuid, uuid, uuid) from public;
revoke all on function public.create_tournament_team_entry(uuid, uuid, uuid, uuid, text, text, text, text, text, uuid, text, text, uuid) from public;
revoke all on function public.update_tournament_team_entry(uuid, uuid, jsonb) from public;
revoke all on function public.create_tournament_provisional_player(uuid, uuid, text) from public;
revoke all on function public.add_tournament_roster_player(uuid, uuid, uuid, uuid, uuid, text, text, smallint, text, text, boolean) from public;
revoke all on function public.update_tournament_roster_player(uuid, uuid, uuid, smallint, text, text, boolean) from public;
revoke all on function public.remove_tournament_roster_player(uuid, uuid, uuid) from public;
revoke all on function public.submit_tournament_team_entry(uuid, uuid) from public;
revoke all on function public.review_tournament_team_entry(uuid, uuid, text, text, jsonb) from public;
revoke all on function public.approve_tournament_team_entry(uuid, uuid, text) from public;
revoke all on function public.reject_tournament_team_entry(uuid, uuid, text) from public;
revoke all on function public.withdraw_tournament_team_entry(uuid, uuid, text) from public;
revoke all on function public.archive_tournament_team_entry(uuid, uuid, text) from public;
revoke all on function public.lock_tournament_roster(uuid, uuid, uuid) from public;
revoke all on function public.invite_tournament_team_manager(uuid, uuid, text, text, text) from public;
revoke all on function public.accept_tournament_team_invitation(text) from public;
revoke all on function public.revoke_tournament_team_invitation(uuid, uuid) from public;
revoke all on function public.search_tournament_players(uuid, uuid, text, integer, uuid) from public;
revoke all on function public.search_tournament_arma2_teams(uuid, uuid, text, integer) from public;
revoke all on function public.get_tournament_teams_context(uuid, uuid) from public;
revoke all on function public.get_team_registration_context(uuid, uuid) from public;
revoke all on function public.protect_tournament_registration_scope() from public;
revoke all on function public.reject_tournament_audit_mutation() from public;

grant execute on function public.is_tournament_team_manager(uuid, boolean) to authenticated;
grant execute on function public.can_read_tournament_team_entry(uuid, uuid) to authenticated;
grant execute on function public.can_edit_tournament_team_entry(uuid, uuid) to authenticated;
grant execute on function public.validate_tournament_roster(uuid, uuid, uuid) to authenticated;
grant execute on function public.create_tournament_team_entry(uuid, uuid, uuid, uuid, text, text, text, text, text, uuid, text, text, uuid) to authenticated;
grant execute on function public.update_tournament_team_entry(uuid, uuid, jsonb) to authenticated;
grant execute on function public.create_tournament_provisional_player(uuid, uuid, text) to authenticated;
grant execute on function public.add_tournament_roster_player(uuid, uuid, uuid, uuid, uuid, text, text, smallint, text, text, boolean) to authenticated;
grant execute on function public.update_tournament_roster_player(uuid, uuid, uuid, smallint, text, text, boolean) to authenticated;
grant execute on function public.remove_tournament_roster_player(uuid, uuid, uuid) to authenticated;
grant execute on function public.submit_tournament_team_entry(uuid, uuid) to authenticated;
grant execute on function public.review_tournament_team_entry(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.approve_tournament_team_entry(uuid, uuid, text) to authenticated;
grant execute on function public.reject_tournament_team_entry(uuid, uuid, text) to authenticated;
grant execute on function public.withdraw_tournament_team_entry(uuid, uuid, text) to authenticated;
grant execute on function public.archive_tournament_team_entry(uuid, uuid, text) to authenticated;
grant execute on function public.lock_tournament_roster(uuid, uuid, uuid) to authenticated;
grant execute on function public.invite_tournament_team_manager(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.accept_tournament_team_invitation(text) to authenticated;
grant execute on function public.revoke_tournament_team_invitation(uuid, uuid) to authenticated;
grant execute on function public.search_tournament_players(uuid, uuid, text, integer, uuid) to authenticated;
grant execute on function public.search_tournament_arma2_teams(uuid, uuid, text, integer) to authenticated;
grant execute on function public.get_tournament_teams_context(uuid, uuid) to authenticated;
grant execute on function public.get_team_registration_context(uuid, uuid) to authenticated;

grant usage, select on sequence public.tournament_audit_log_id_seq to service_role;
