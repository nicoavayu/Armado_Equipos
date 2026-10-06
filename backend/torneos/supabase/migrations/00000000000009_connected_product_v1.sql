-- Arma2 Torneos — CONNECTED-V1: Torneos profile, Torneos inbox, public catalog ("Explorar torneos") and registration
-- requests from authorized team representatives, for the isolated Torneos project (hybrid composition).
-- Applies after 00000000000000 … 00000000000008 (all unchanged: no existing function body or grant is modified).
-- Idempotent: the local hybrid lab re-applies it on every `up`. Rollback (documented, never automatic):
-- backend/torneos/connected-v1/rollback/00000000000009_connected_product_v1.rollback.sql
--
-- Same contract as the LOCAL composition (supabase/migrations/20261006120000_torneos_connected_product_v1.sql) with
-- the isolated project's identity model:
--   * identity = private.current_identity_id() (torneos_identity), never a Core user id;
--   * authority over a Core team is never read here: the gateway asks Core (team_snapshot / directory_teams) and
--     leaves a single-use attestation bound to this identity, session and exact request. The applicant requests are
--     pre-authorized by a NEW private.authorize_applicant_core_contract, so the certified
--     private.authorize_core_contract (pinned by 0005) stays byte-identical;
--   * nothing reaches the client unless the gateway serves it: TORNEOS_CONNECTED_MODE=on adds exactly the RPCs of
--     torneos-gateway/connected-v1-rpc-allowlist.json (14 authenticated + 3 public read-only).
--
-- Three separate, explicit concepts — none is enabled by creating a tournament: the public page
-- (tournament_public_pages, unchanged), the catalog listing (tournament_catalog_listings.status = 'listed', requires
-- the published page) and the reception of requests (applications_state = 'open' + tournament in registration and
-- inside its window). A request IS a tournament_team_entry created by its applicant (captain of that entry only,
-- never an organization member), completed with the existing roster rules, submitted with
-- submit_tournament_team_entry and decided with review_tournament_team_entry. Triggers guard every write path:
-- submitting a request outside an open call (TORNEOS_APPLICATIONS_CLOSED) and approving over a category capacity
-- (TORNEOS_CATEGORY_FULL, same advisory lock as the review). An approved entry consumes a place; a pending one never.
--
-- ACL: 14 functions EXECUTE to authenticated, 3 public read-only functions to anon + authenticated, the platform
-- removal lever to service_role only, the applicant authorizer to torneos_core_adapter only; new tables have RLS
-- and no API grant (SECURITY DEFINER RPCs only).
BEGIN;

DO $pre$
BEGIN
  IF to_regprocedure('public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)') IS NULL
    OR NOT has_function_privilege('authenticated', 'public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)'::regprocedure, 'EXECUTE')
    OR to_regprocedure('private.authorize_core_contract(text,jsonb)') IS NULL
    OR to_regprocedure('private.consume_core_attestation(text,jsonb)') IS NULL
    OR to_regprocedure('public.review_tournament_team_entry(uuid,uuid,text,text,jsonb)') IS NULL
    OR to_regprocedure('public.submit_tournament_team_entry(uuid,uuid)') IS NULL
    OR to_regclass('public.tournament_public_pages') IS NULL
    OR to_regclass('public.tournament_organization_invitations') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_CONNECTED_V1_PRECONDITION_FAILED: 00000000000008 is not in force';
  END IF;
END $pre$;


-- ============================================================================================ tables

create table if not exists public.tournament_user_profiles (
  user_id uuid primary key references public.torneos_identity(id) on delete cascade,
  display_name text,
  notify_registration_requests boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_user_profiles_display_name_check check (
    display_name is null
    or (display_name = btrim(display_name) and char_length(display_name) between 2 and 60)
  )
);
comment on table public.tournament_user_profiles is
  'Torneos-only presentation of a user. Never written to Core; official roster and match-report names are separate.';

create table if not exists public.tournament_catalog_listings (
  tournament_id uuid primary key,
  organization_id uuid not null,
  status text not null default 'draft',
  applications_state text not null default 'closed',
  summary text,
  locality text,
  venue_id uuid references public.tournament_venues(id) on delete set null,
  entry_fee_cents integer,
  entry_fee_currency text not null default 'ARS',
  entry_fee_includes text,
  payment_note text,
  requirements text,
  rules_summary text,
  listed_at timestamptz,
  listed_by uuid references public.torneos_identity(id) on delete restrict,
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.torneos_identity(id) on delete restrict,
  platform_removed_at timestamptz,
  platform_removed_reason text,
  updated_by uuid not null references public.torneos_identity(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_catalog_listings_tournament_fk
    foreign key (organization_id, tournament_id) references public.tournaments(organization_id, id) on delete cascade,
  constraint tournament_catalog_listings_status_check check (status in ('draft', 'listed', 'withdrawn')),
  constraint tournament_catalog_listings_applications_check check (applications_state in ('open', 'paused', 'closed')),
  constraint tournament_catalog_listings_listed_check check (status <> 'listed' or (listed_at is not null and listed_by is not null)),
  constraint tournament_catalog_listings_removed_check check (
    (platform_removed_at is null and platform_removed_reason is null)
    or (platform_removed_at is not null and status <> 'listed' and char_length(platform_removed_reason) between 3 and 300)
  ),
  constraint tournament_catalog_listings_summary_check check (summary is null or (summary = btrim(summary) and char_length(summary) between 10 and 280)),
  constraint tournament_catalog_listings_locality_check check (locality is null or (locality = btrim(locality) and char_length(locality) between 2 and 80)),
  constraint tournament_catalog_listings_fee_check check (entry_fee_cents is null or entry_fee_cents between 0 and 100000000),
  constraint tournament_catalog_listings_currency_check check (entry_fee_currency = 'ARS'),
  constraint tournament_catalog_listings_fee_includes_check check (entry_fee_includes is null or char_length(entry_fee_includes) between 2 and 300),
  constraint tournament_catalog_listings_payment_note_check check (payment_note is null or char_length(payment_note) between 2 and 300),
  constraint tournament_catalog_listings_requirements_check check (requirements is null or char_length(requirements) between 2 and 600),
  constraint tournament_catalog_listings_rules_check check (rules_summary is null or char_length(rules_summary) between 2 and 1200)
);
comment on table public.tournament_catalog_listings is
  'Explicit call for teams of a tournament in the public catalog. Only a safe projection is ever public; Arma2 does not collect the entry fee.';
create index if not exists tournament_catalog_listings_listed_idx on public.tournament_catalog_listings (status, applications_state);
create index if not exists tournament_catalog_listings_organization_idx on public.tournament_catalog_listings (organization_id);

create table if not exists public.tournament_category_capacities (
  category_id uuid primary key,
  organization_id uuid not null,
  tournament_id uuid not null,
  max_teams smallint not null,
  updated_by uuid not null references public.torneos_identity(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint tournament_category_capacities_category_fk
    foreign key (organization_id, tournament_id, category_id)
    references public.tournament_categories(organization_id, tournament_id, id) on delete cascade,
  constraint tournament_category_capacities_range_check check (max_teams between 2 and 256)
);
comment on table public.tournament_category_capacities is
  'Optional maximum of approved team entries per category. Approved entries consume a place; pending requests do not.';

create table if not exists public.tournament_team_applications (
  team_entry_id uuid primary key,
  organization_id uuid not null,
  tournament_id uuid not null,
  category_id uuid not null,
  applicant_user_id uuid not null references public.torneos_identity(id) on delete restrict,
  core_team_id uuid,
  message text,
  accepted_conditions_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint tournament_team_applications_entry_fk
    foreign key (organization_id, tournament_id, team_entry_id)
    references public.tournament_team_entries(organization_id, tournament_id, id) on delete cascade,
  constraint tournament_team_applications_message_check check (message is null or (message = btrim(message) and char_length(message) between 2 and 500))
);
comment on table public.tournament_team_applications is
  'Marks a team entry that an authorized representative requested from the catalog. The entry, roster and review stay the existing domain.';
create index if not exists tournament_team_applications_tournament_idx on public.tournament_team_applications (tournament_id, category_id);
create index if not exists tournament_team_applications_applicant_idx on public.tournament_team_applications (applicant_user_id, tournament_id);

create table if not exists public.tournament_user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.torneos_identity(id) on delete cascade,
  organization_id uuid not null,
  tournament_id uuid not null,
  team_entry_id uuid,
  category_id uuid,
  audience text not null,
  kind text not null,
  title text not null,
  body text not null,
  message text,
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint tournament_user_notifications_tournament_fk
    foreign key (organization_id, tournament_id) references public.tournaments(organization_id, id) on delete cascade,
  constraint tournament_user_notifications_audience_check check (audience in ('team', 'organization')),
  constraint tournament_user_notifications_kind_check check (kind in (
    'registration.submitted', 'registration.received', 'registration.approved',
    'registration.changes_requested', 'registration.rejected'
  )),
  constraint tournament_user_notifications_title_check check (char_length(title) between 3 and 140),
  constraint tournament_user_notifications_body_check check (char_length(body) between 3 and 500),
  constraint tournament_user_notifications_message_check check (message is null or char_length(message) <= 1200)
);
comment on table public.tournament_user_notifications is
  'Torneos inbox activity (registration events). Internal inbox only: no push, email or external side effect. Organization-audience rows are re-authorized on every read.';
create index if not exists tournament_user_notifications_recipient_idx on public.tournament_user_notifications (recipient_user_id, created_at desc, id desc);
create index if not exists tournament_user_notifications_unread_idx on public.tournament_user_notifications (recipient_user_id) where read_at is null;

alter table public.tournament_user_profiles enable row level security;
alter table public.tournament_catalog_listings enable row level security;
alter table public.tournament_category_capacities enable row level security;
alter table public.tournament_team_applications enable row level security;
alter table public.tournament_user_notifications enable row level security;
revoke all on table public.tournament_user_profiles, public.tournament_catalog_listings,
  public.tournament_category_capacities, public.tournament_team_applications,
  public.tournament_user_notifications from public, anon, authenticated, service_role;

-- ============================================================================================ internal helpers

create or replace function public.tournament_catalog_normalize(p_value text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(p_value, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
    '\s+', ' ', 'g'
  ));
$$;

-- Why a tournament (optionally a category) does not accept requests right now; NULL when it does.
create or replace function public.tournament_catalog_block_reason(p_tournament_id uuid, p_category_id uuid default null)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_listing public.tournament_catalog_listings%rowtype;
  v_tournament public.tournaments%rowtype;
  v_capacity integer;
  v_approved integer;
begin
  select * into v_listing from public.tournament_catalog_listings where tournament_id = p_tournament_id;
  if v_listing.tournament_id is null or v_listing.status <> 'listed' or v_listing.platform_removed_at is not null then
    return 'not_listed';
  end if;
  select tournament.* into v_tournament
  from public.tournaments tournament
  join public.tournament_organizations organization
    on organization.id = tournament.organization_id and organization.status = 'active'
  join public.tournament_seasons season
    on season.id = tournament.season_id and season.organization_id = tournament.organization_id
   and season.status <> 'archived'
  join public.tournament_public_pages page
    on page.tournament_id = tournament.id and page.organization_id = tournament.organization_id
   and page.status = 'published'
  where tournament.id = p_tournament_id and tournament.archived_at is null;
  if v_tournament.id is null then return 'not_listed'; end if;
  if v_listing.applications_state = 'paused' then return 'paused'; end if;
  if v_listing.applications_state <> 'open' or v_tournament.status <> 'registration' then return 'closed'; end if;
  if v_tournament.registration_opens_at is not null and now() < v_tournament.registration_opens_at then
    return 'not_open_yet';
  end if;
  if v_tournament.registration_closes_at is not null and now() > v_tournament.registration_closes_at then
    return 'closed';
  end if;
  if p_category_id is not null then
    if not exists (
      select 1 from public.tournament_categories category
      where category.id = p_category_id and category.tournament_id = p_tournament_id and category.status = 'active'
    ) then
      return 'category_unavailable';
    end if;
    select capacity.max_teams into v_capacity
    from public.tournament_category_capacities capacity
    where capacity.category_id = p_category_id and capacity.tournament_id = p_tournament_id;
    if v_capacity is not null then
      select count(*) into v_approved
      from public.tournament_team_entries entry
      where entry.tournament_id = p_tournament_id and entry.category_id = p_category_id and entry.status = 'approved';
      if v_approved >= v_capacity then return 'category_full'; end if;
    end if;
  end if;
  return null;
end;
$$;

-- A listed call that the public may see (accepting requests or not). Never drafts, withdrawn or removed listings,
-- unpublished pages, inactive organizations, archived seasons, or finished/archived tournaments.
create or replace function public.tournament_catalog_is_visible(p_tournament_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.tournament_catalog_listings listing
    join public.tournaments tournament
      on tournament.id = listing.tournament_id and tournament.organization_id = listing.organization_id
    join public.tournament_organizations organization
      on organization.id = tournament.organization_id and organization.status = 'active'
    join public.tournament_seasons season
      on season.id = tournament.season_id and season.organization_id = tournament.organization_id
     and season.status <> 'archived'
    join public.tournament_public_pages page
      on page.tournament_id = tournament.id and page.organization_id = tournament.organization_id
     and page.status = 'published'
    where listing.tournament_id = p_tournament_id
      and listing.status = 'listed'
      and listing.platform_removed_at is null
      and tournament.archived_at is null
      and tournament.status in ('registration', 'scheduled', 'active')
  );
$$;

create or replace function public.tournament_catalog_state(p_tournament_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_reason text;
begin
  v_reason := public.tournament_catalog_block_reason(p_tournament_id, null);
  if v_reason is null then
    if exists (
      select 1 from public.tournament_categories category
      where category.tournament_id = p_tournament_id and category.status = 'active'
        and public.tournament_catalog_block_reason(p_tournament_id, category.id) is null
    ) then
      return 'open';
    end if;
    return 'full';
  end if;
  return case v_reason when 'paused' then 'paused' when 'not_open_yet' then 'upcoming' else 'closed' end;
end;
$$;

create or replace function public.tournament_catalog_categories(p_tournament_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', category.name,
    'slug', category.slug,
    'description', category.description,
    'minAge', category.min_age,
    'maxAge', category.max_age,
    'gender', coalesce(category.gender_category, tournament.gender_category),
    'sportModality', coalesce(category.sport_modality, tournament.sport_modality),
    'teamSize', coalesce(category.team_size, tournament.team_size),
    'capacity', capacity.max_teams,
    'approvedTeams', case when capacity.max_teams is null then null else (
      select count(*) from public.tournament_team_entries entry
      where entry.tournament_id = tournament.id and entry.category_id = category.id and entry.status = 'approved'
    ) end,
    'accepting', public.tournament_catalog_block_reason(tournament.id, category.id) is null,
    'blockReason', public.tournament_catalog_block_reason(tournament.id, category.id)
  ) order by category.sort_order, category.name), '[]'::jsonb)
  from public.tournaments tournament
  join public.tournament_categories category
    on category.tournament_id = tournament.id and category.organization_id = tournament.organization_id
   and category.status = 'active'
  left join public.tournament_category_capacities capacity
    on capacity.category_id = category.id and capacity.tournament_id = tournament.id
  where tournament.id = p_tournament_id;
$$;

-- Active members that may be told about a new submission: the role grants team_entries.review and the member
-- reaches the season (owner, or seat assignment). Re-validated again when the inbox is read.
create or replace function public.tournament_registration_reviewer_ids(p_organization_id uuid, p_season_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select membership.user_id
  from public.tournament_organization_members membership
  join public.tournament_organizations organization
    on organization.id = membership.organization_id and organization.status = 'active'
  left join public.tournament_user_profiles profile on profile.user_id = membership.user_id
  where membership.organization_id = p_organization_id
    and membership.status = 'active'
    and membership.user_id is not null
    and 'team_entries.review' = any(public.tournament_role_capabilities(membership.role))
    and coalesce(profile.notify_registration_requests, true)
    and (
      membership.role = 'owner'
      or exists (
        select 1 from public.tournament_season_member_assignments assignment
        where assignment.organization_id = p_organization_id
          and assignment.season_id = p_season_id
          and assignment.membership_id = membership.id
      )
    );
$$;

create or replace function public.tournament_notification_visible(
  p_audience text, p_organization_id uuid, p_tournament_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_audience = 'team' or (
    p_audience = 'organization'
    and public.has_tournament_organization_capability(p_organization_id, 'team_entries.review')
    and exists (
      select 1 from public.tournaments tournament
      where tournament.id = p_tournament_id and tournament.organization_id = p_organization_id
        and public.has_tournament_season_access(p_organization_id, tournament.season_id)
    )
  );
$$;

-- ============================================================================================ guards

create or replace function public.guard_tournament_team_entry_connected_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_capacity integer;
  v_approved integer;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'submitted' and exists (
    select 1 from public.tournament_team_applications application where application.team_entry_id = new.id
  ) then
    v_reason := public.tournament_catalog_block_reason(new.tournament_id, new.category_id);
    if v_reason = 'category_full' then
      raise exception using errcode = 'PT409', message = 'TORNEOS_CATEGORY_FULL';
    elsif v_reason is not null then
      raise exception using errcode = 'PT409', message = 'TORNEOS_APPLICATIONS_CLOSED';
    end if;
  end if;
  if new.status = 'approved' then
    select capacity.max_teams into v_capacity
    from public.tournament_category_capacities capacity
    where capacity.category_id = new.category_id and capacity.tournament_id = new.tournament_id;
    if v_capacity is not null then
      -- Same key as review_tournament_team_entry: re-entrant inside that transaction, serializing the last place.
      perform pg_advisory_xact_lock(hashtextextended(new.tournament_id::text || ':' || new.category_id::text, 0));
      select count(*) into v_approved
      from public.tournament_team_entries entry
      where entry.tournament_id = new.tournament_id and entry.category_id = new.category_id
        and entry.status = 'approved' and entry.id <> new.id;
      if v_approved >= v_capacity then
        raise exception using errcode = 'PT409', message = 'TORNEOS_CATEGORY_FULL';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tournament_team_entries_connected_guard on public.tournament_team_entries;
create trigger tournament_team_entries_connected_guard
  before update of status on public.tournament_team_entries
  for each row execute function public.guard_tournament_team_entry_connected_transition();

-- ============================================================================================ inbox activity

create or replace function public.notify_tournament_team_entry_submitted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tournament public.tournaments%rowtype;
  v_category_name text;
  v_is_application boolean;
  v_context text;
begin
  if new.status is not distinct from old.status or new.status <> 'submitted' then return null; end if;
  select * into v_tournament from public.tournaments where id = new.tournament_id;
  select name into v_category_name from public.tournament_categories where id = new.category_id;
  v_is_application := exists (
    select 1 from public.tournament_team_applications application where application.team_entry_id = new.id
  );
  v_context := left(new.name || ' · ' || coalesce(v_category_name, 'Categoría') || ' · ' || v_tournament.name, 480);

  insert into public.tournament_user_notifications (
    recipient_user_id, organization_id, tournament_id, team_entry_id, category_id,
    audience, kind, title, body, actor_user_id
  )
  select reviewer, new.organization_id, new.tournament_id, new.id, new.category_id,
    'organization', 'registration.submitted',
    case when v_is_application then 'Nueva solicitud de inscripción' else 'Equipo presentado para revisión' end,
    v_context, new.submitted_by
  from public.tournament_registration_reviewer_ids(new.organization_id, new.season_id) reviewer
  where reviewer is distinct from new.submitted_by;

  insert into public.tournament_user_notifications (
    recipient_user_id, organization_id, tournament_id, team_entry_id, category_id,
    audience, kind, title, body, actor_user_id
  )
  select distinct manager.user_id, new.organization_id, new.tournament_id, new.id, new.category_id,
    'team', 'registration.received',
    case when v_is_application then 'Solicitud enviada' else 'Inscripción presentada' end,
    left(v_context || '. La organización la va a revisar; enviarla no confirma un cupo.', 500),
    new.submitted_by
  from public.tournament_team_managers manager
  where manager.team_entry_id = new.id and manager.organization_id = new.organization_id
    and manager.status = 'active' and manager.role in ('captain', 'delegate') and manager.user_id is not null;
  return null;
end;
$$;

drop trigger if exists tournament_team_entries_notify_submitted on public.tournament_team_entries;
create trigger tournament_team_entries_notify_submitted
  after update of status on public.tournament_team_entries
  for each row execute function public.notify_tournament_team_entry_submitted();

create or replace function public.notify_tournament_team_entry_reviewed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.tournament_team_entries%rowtype;
  v_tournament_name text;
  v_category_name text;
  v_is_application boolean;
  v_kind text;
  v_title text;
  v_body text;
begin
  select * into v_entry from public.tournament_team_entries where id = new.team_entry_id;
  select name into v_tournament_name from public.tournaments where id = v_entry.tournament_id;
  select name into v_category_name from public.tournament_categories where id = v_entry.category_id;
  v_is_application := exists (
    select 1 from public.tournament_team_applications application where application.team_entry_id = v_entry.id
  );
  v_kind := 'registration.' || new.decision;
  if new.decision = 'approved' then
    v_title := case when v_is_application then 'Solicitud aprobada' else 'Inscripción aprobada' end;
    v_body := v_entry.name || ' quedó inscripto en ' || v_tournament_name || ' · ' || coalesce(v_category_name, 'Categoría')
      || '. El acceso al torneo es para responsables y jugadores del plantel aprobado.';
  elsif new.decision = 'changes_requested' then
    v_title := 'La organización pidió cambios';
    v_body := v_entry.name || ' · ' || v_tournament_name || ': revisá el pedido y volvé a enviar.';
  else
    v_title := case when v_is_application then 'Solicitud rechazada' else 'Inscripción rechazada' end;
    v_body := v_entry.name || ' · ' || v_tournament_name || ': la organización no aprobó la inscripción.';
  end if;

  insert into public.tournament_user_notifications (
    recipient_user_id, organization_id, tournament_id, team_entry_id, category_id,
    audience, kind, title, body, message, actor_user_id
  )
  select distinct manager.user_id, v_entry.organization_id, v_entry.tournament_id, v_entry.id, v_entry.category_id,
    'team', v_kind, v_title, left(v_body, 500), left(new.reason, 1200), new.created_by
  from public.tournament_team_managers manager
  where manager.team_entry_id = v_entry.id and manager.organization_id = v_entry.organization_id
    and manager.status = 'active' and manager.role in ('captain', 'delegate') and manager.user_id is not null;
  return null;
end;
$$;

drop trigger if exists tournament_team_reviews_notify on public.tournament_team_reviews;
create trigger tournament_team_reviews_notify
  after insert on public.tournament_team_reviews
  for each row execute function public.notify_tournament_team_entry_reviewed();

-- ============================================================================================ profile

create or replace function public.get_my_torneos_profile()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.current_identity_id();
  v_profile public.tournament_user_profiles%rowtype;
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  select * into v_profile from public.tournament_user_profiles where user_id = v_uid;
  return jsonb_build_object(
    'hasProfile', v_profile.user_id is not null,
    'displayName', v_profile.display_name,
    'notifyRegistrationRequests', coalesce(v_profile.notify_registration_requests, true),
    'updatedAt', v_profile.updated_at,
    'reviewsRegistrations', exists (
      select 1 from public.tournament_organization_members membership
      join public.tournament_organizations organization
        on organization.id = membership.organization_id and organization.status = 'active'
      where membership.user_id = v_uid and membership.status = 'active'
        and 'team_entries.review' = any(public.tournament_role_capabilities(membership.role))
    ),
    'channels', jsonb_build_object('inbox', true, 'push', false, 'email', false)
  );
end;
$$;

create or replace function public.update_my_torneos_profile(p_display_name text, p_notify_registration_requests boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.current_identity_id();
  v_name text := nullif(btrim(regexp_replace(coalesce(p_display_name, ''), '\s+', ' ', 'g')), '');
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  if p_notify_registration_requests is null
    or (v_name is not null and char_length(v_name) not between 2 and 60) then
    raise exception using errcode = '22023', message = 'TORNEOS_PROFILE_INVALID';
  end if;
  insert into public.tournament_user_profiles (user_id, display_name, notify_registration_requests)
  values (v_uid, v_name, p_notify_registration_requests)
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    notify_registration_requests = excluded.notify_registration_requests,
    updated_at = now();
  return public.get_my_torneos_profile();
end;
$$;

-- ============================================================================================ inbox

create or replace function public.get_my_torneos_notifications(
  p_unread_only boolean default false, p_limit integer default 20, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.current_identity_id();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 5000);
  v_result jsonb;
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  with visible as (
    select notification.*, tournament.name tournament_name, organization.name organization_name
    from public.tournament_user_notifications notification
    join public.tournaments tournament
      on tournament.id = notification.tournament_id and tournament.organization_id = notification.organization_id
    join public.tournament_organizations organization on organization.id = notification.organization_id
    where notification.recipient_user_id = v_uid
      and public.tournament_notification_visible(notification.audience, notification.organization_id, notification.tournament_id)
  ),
  page as (
    select * from visible
    where not coalesce(p_unread_only, false) or read_at is null
    order by created_at desc, id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', page.id,
      'kind', page.kind,
      'audience', page.audience,
      'title', page.title,
      'body', page.body,
      'message', page.message,
      'createdAt', page.created_at,
      'readAt', page.read_at,
      'organizationId', page.organization_id,
      'organizationName', page.organization_name,
      'tournamentId', page.tournament_id,
      'tournamentName', page.tournament_name,
      'teamEntryId', page.team_entry_id,
      'categoryId', page.category_id
    ) order by page.created_at desc, page.id desc) from page), '[]'::jsonb),
    'pagination', jsonb_build_object(
      'limit', v_limit, 'offset', v_offset,
      'total', (select count(*) from visible where not coalesce(p_unread_only, false) or read_at is null),
      'hasMore', (select count(*) from visible where not coalesce(p_unread_only, false) or read_at is null) > v_offset + v_limit
    ),
    'unreadCount', (select count(*) from visible where read_at is null)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.mark_my_torneos_notifications_read(p_notification_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.current_identity_id();
  v_updated integer;
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  if p_notification_ids is not null and cardinality(p_notification_ids) > 100 then
    raise exception using errcode = '22023', message = 'TORNEOS_NOTIFICATIONS_INVALID';
  end if;
  update public.tournament_user_notifications notification
  set read_at = now()
  where notification.recipient_user_id = v_uid
    and notification.read_at is null
    and (p_notification_ids is null or notification.id = any(p_notification_ids))
    and public.tournament_notification_visible(notification.audience, notification.organization_id, notification.tournament_id);
  get diagnostics v_updated = row_count;
  return jsonb_build_object('updated', v_updated, 'summary', public.get_my_torneos_inbox_summary());
end;
$$;

create or replace function public.get_my_torneos_inbox_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.current_identity_id();
  v_notifications integer;
  v_communications integer;
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  select count(*) into v_notifications
  from public.tournament_user_notifications notification
  where notification.recipient_user_id = v_uid and notification.read_at is null
    and public.tournament_notification_visible(notification.audience, notification.organization_id, notification.tournament_id);
  -- Same predicate as get_tournament_communications_inbox.unreadCount (audiences and access re-validated).
  select count(*) into v_communications
  from public.tournament_announcement_deliveries unread
  join public.tournament_announcements unread_announcement on unread_announcement.id = unread.announcement_id
  where unread.recipient_user_id = v_uid
    and unread.read_at is null
    and unread.status = 'available'
    and public.can_access_tournament_communications(unread_announcement.tournament_id)
    and public.can_current_user_access_tournament_announcement(unread_announcement.id);
  return jsonb_build_object(
    'notificationsUnread', v_notifications,
    'communicationsUnread', v_communications,
    'total', v_notifications + v_communications
  );
end;
$$;

-- ============================================================================================ public catalog

create or replace function public.search_tournament_catalog(
  p_query text default null,
  p_locality text default null,
  p_sport text default null,
  p_gender text default null,
  p_scope text default null,
  p_from text default null,
  p_to text default null,
  p_sort text default null,
  p_page text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_query text := nullif(public.tournament_catalog_normalize(p_query), '');
  v_locality text := nullif(public.tournament_catalog_normalize(p_locality), '');
  v_sport text := nullif(btrim(coalesce(p_sport, '')), '');
  v_gender text := nullif(btrim(coalesce(p_gender, '')), '');
  v_scope text := coalesce(nullif(btrim(coalesce(p_scope, '')), ''), 'open');
  v_sort text := coalesce(nullif(btrim(coalesce(p_sort, '')), ''), 'closing');
  v_page integer;
  v_from date;
  v_to date;
  v_size constant integer := 12;
  v_total integer;
  v_items jsonb;
begin
  if char_length(coalesce(p_query, '')) > 80 or char_length(coalesce(p_locality, '')) > 80
    or (v_sport is not null and v_sport !~ '^[a-z0-9_]{2,32}$')
    or (v_gender is not null and v_gender not in ('male', 'female', 'mixed', 'open'))
    or v_scope not in ('open', 'all')
    or v_sort not in ('closing', 'starting', 'recent')
    or (p_page is not null and p_page !~ '^[1-9][0-9]{0,2}$')
    or (p_from is not null and p_from !~ '^\d{4}-\d{2}-\d{2}$')
    or (p_to is not null and p_to !~ '^\d{4}-\d{2}-\d{2}$')
  then
    raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_INVALID_FILTER';
  end if;
  v_page := coalesce(p_page::integer, 1);
  if v_page > 50 then raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_INVALID_FILTER'; end if;
  begin
    v_from := p_from::date;
    v_to := p_to::date;
  exception when others then
    raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_INVALID_FILTER';
  end;
  if v_from is not null and v_to is not null and v_to < v_from then
    raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_INVALID_FILTER';
  end if;

  with visible as (
    select
      listing.*, tournament.name tournament_name, tournament.sport_modality, tournament.competition_format,
      tournament.gender_category, tournament.team_size, tournament.start_date, tournament.end_date,
      tournament.registration_closes_at, tournament.registration_opens_at,
      organization.name organization_name, page.public_slug, venue.name venue_name,
      public.tournament_catalog_state(tournament.id) catalog_state
    from public.tournament_catalog_listings listing
    join public.tournaments tournament
      on tournament.id = listing.tournament_id and tournament.organization_id = listing.organization_id
    join public.tournament_organizations organization on organization.id = tournament.organization_id
    join public.tournament_public_pages page on page.tournament_id = tournament.id and page.status = 'published'
    left join public.tournament_venues venue
      on venue.id = listing.venue_id and venue.organization_id = listing.organization_id and venue.status = 'active'
    where public.tournament_catalog_is_visible(tournament.id)
  ),
  filtered as (
    select * from visible
    where (v_scope = 'all' or catalog_state = 'open')
      and (v_query is null or public.tournament_catalog_normalize(tournament_name || ' ' || organization_name || ' ' || coalesce(locality, ''))
        like '%' || v_query || '%')
      and (v_locality is null or public.tournament_catalog_normalize(locality) = v_locality)
      and (v_sport is null or sport_modality = v_sport or exists (
        select 1 from public.tournament_categories category
        where category.tournament_id = visible.tournament_id and category.status = 'active' and category.sport_modality = v_sport
      ))
      and (v_gender is null or gender_category = v_gender or exists (
        select 1 from public.tournament_categories category
        where category.tournament_id = visible.tournament_id and category.status = 'active' and category.gender_category = v_gender
      ))
      and (v_from is null or start_date >= v_from)
      and (v_to is null or start_date <= v_to)
  ),
  ordered as (
    select filtered.*,
      row_number() over (order by
        case when v_sort = 'closing' then (catalog_state = 'open')::int end desc nulls last,
        case when v_sort = 'closing' then registration_closes_at end asc nulls last,
        case when v_sort in ('closing', 'starting') then start_date end asc nulls last,
        case when v_sort = 'recent' then listed_at end desc nulls last,
        tournament_name asc, tournament_id asc
      ) position
    from filtered
  )
  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'publicSlug', ordered.public_slug,
      'tournamentName', ordered.tournament_name,
      'organizationName', ordered.organization_name,
      'summary', ordered.summary,
      'locality', ordered.locality,
      'venueName', ordered.venue_name,
      'sportModality', ordered.sport_modality,
      'competitionFormat', ordered.competition_format,
      'genderCategory', ordered.gender_category,
      'teamSize', ordered.team_size,
      'startDate', ordered.start_date,
      'endDate', ordered.end_date,
      'registrationOpensAt', ordered.registration_opens_at,
      'registrationClosesAt', ordered.registration_closes_at,
      'state', ordered.catalog_state,
      'entryFee', case when ordered.entry_fee_cents is null then null else jsonb_build_object(
        'amountCents', ordered.entry_fee_cents, 'currency', ordered.entry_fee_currency) end,
      'categories', (
        select coalesce(jsonb_agg(jsonb_build_object('name', category.name, 'slug', category.slug)
          order by category.sort_order, category.name), '[]'::jsonb)
        from public.tournament_categories category
        where category.tournament_id = ordered.tournament_id and category.status = 'active'
      ),
      'listedAt', ordered.listed_at
    ) order by ordered.position) filter (
      where ordered.position > (v_page - 1) * v_size and ordered.position <= v_page * v_size
    ), '[]'::jsonb)
  into v_total, v_items
  from ordered;

  return jsonb_build_object(
    'items', v_items,
    'page', v_page,
    'pageSize', v_size,
    'total', v_total,
    'hasMore', v_total > v_page * v_size,
    'sort', v_sort,
    'scope', v_scope
  );
end;
$$;

create or replace function public.get_tournament_catalog_facets()
returns jsonb language sql stable security definer set search_path = '' as $$
  with visible as (
    select listing.tournament_id, listing.locality, tournament.sport_modality, tournament.gender_category
    from public.tournament_catalog_listings listing
    join public.tournaments tournament on tournament.id = listing.tournament_id
    where public.tournament_catalog_is_visible(listing.tournament_id)
  )
  select jsonb_build_object(
    'localities', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'count', total) order by label)
      from (
        select min(locality) label, count(*) total
        from visible where locality is not null
        group by public.tournament_catalog_normalize(locality)
        order by 1 limit 60
      ) grouped
    ), '[]'::jsonb),
    'sports', coalesce((
      select jsonb_agg(jsonb_build_object('value', sport_modality, 'count', total) order by sport_modality)
      from (select sport_modality, count(*) total from visible group by sport_modality) grouped
    ), '[]'::jsonb),
    'genders', coalesce((
      select jsonb_agg(jsonb_build_object('value', gender_category, 'count', total) order by gender_category)
      from (select gender_category, count(*) total from visible group by gender_category) grouped
    ), '[]'::jsonb),
    'total', (select count(*) from visible)
  );
$$;

create or replace function public.get_tournament_catalog_entry(p_public_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_page public.tournament_public_pages%rowtype;
  v_listing public.tournament_catalog_listings%rowtype;
  v_tournament public.tournaments%rowtype;
  v_venue public.tournament_venues%rowtype;
  v_reason text;
begin
  if p_public_slug is null or char_length(p_public_slug) not between 3 and 96
    or p_public_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$' then
    return null;
  end if;
  select * into v_page from public.tournament_public_pages where public_slug = p_public_slug and status = 'published';
  if v_page.tournament_id is null or not public.tournament_catalog_is_visible(v_page.tournament_id) then
    return null;
  end if;
  select * into v_listing from public.tournament_catalog_listings where tournament_id = v_page.tournament_id;
  select * into v_tournament from public.tournaments where id = v_page.tournament_id;
  select * into v_venue from public.tournament_venues
  where id = v_listing.venue_id and organization_id = v_listing.organization_id and status = 'active';
  v_reason := public.tournament_catalog_block_reason(v_tournament.id, null);
  return jsonb_build_object(
    'publicSlug', v_page.public_slug,
    'tournamentName', v_tournament.name,
    'organizationName', (select name from public.tournament_organizations where id = v_tournament.organization_id),
    'summary', v_listing.summary,
    'locality', v_listing.locality,
    'venue', case when v_venue.id is null then null else jsonb_build_object(
      'name', v_venue.name, 'address', v_venue.address, 'locality', v_venue.locality) end,
    'sportModality', v_tournament.sport_modality,
    'competitionFormat', v_tournament.competition_format,
    'genderCategory', v_tournament.gender_category,
    'teamSize', v_tournament.team_size,
    'startDate', v_tournament.start_date,
    'endDate', v_tournament.end_date,
    'registrationOpensAt', v_tournament.registration_opens_at,
    'registrationClosesAt', v_tournament.registration_closes_at,
    'entryFee', case when v_listing.entry_fee_cents is null then null else jsonb_build_object(
      'amountCents', v_listing.entry_fee_cents, 'currency', v_listing.entry_fee_currency,
      'includes', v_listing.entry_fee_includes, 'paymentNote', v_listing.payment_note) end,
    'requirements', v_listing.requirements,
    'rulesSummary', v_listing.rules_summary,
    'state', public.tournament_catalog_state(v_tournament.id),
    'blockReason', v_reason,
    'categories', public.tournament_catalog_categories(v_tournament.id),
    'listedAt', v_listing.listed_at
  );
end;
$$;

-- ============================================================================================ organizer

create or replace function public.get_tournament_catalog_listing_settings(p_organization_id uuid, p_tournament_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.current_identity_id();
  v_tournament public.tournaments%rowtype;
  v_listing public.tournament_catalog_listings%rowtype;
  v_page public.tournament_public_pages%rowtype;
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  select * into v_tournament from public.tournaments
  where id = p_tournament_id and organization_id = p_organization_id;
  if v_tournament.id is null
    or not public.has_tournament_organization_capability(p_organization_id, 'tournaments.read')
    or not public.has_tournament_season_access(p_organization_id, v_tournament.season_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select * into v_listing from public.tournament_catalog_listings where tournament_id = p_tournament_id;
  select * into v_page from public.tournament_public_pages where tournament_id = p_tournament_id;
  return jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', v_tournament.id, 'name', v_tournament.name, 'status', v_tournament.status,
      'registrationOpensAt', v_tournament.registration_opens_at,
      'registrationClosesAt', v_tournament.registration_closes_at,
      'startDate', v_tournament.start_date, 'endDate', v_tournament.end_date),
    'publicPage', jsonb_build_object(
      'published', coalesce(v_page.status = 'published', false), 'publicSlug', v_page.public_slug),
    'listing', jsonb_build_object(
      'exists', v_listing.tournament_id is not null,
      'status', coalesce(v_listing.status, 'draft'),
      'applicationsState', coalesce(v_listing.applications_state, 'closed'),
      'summary', v_listing.summary, 'locality', v_listing.locality, 'venueId', v_listing.venue_id,
      'entryFeeCents', v_listing.entry_fee_cents, 'entryFeeCurrency', coalesce(v_listing.entry_fee_currency, 'ARS'),
      'entryFeeIncludes', v_listing.entry_fee_includes, 'paymentNote', v_listing.payment_note,
      'requirements', v_listing.requirements, 'rulesSummary', v_listing.rules_summary,
      'listedAt', v_listing.listed_at, 'withdrawnAt', v_listing.withdrawn_at,
      'platformRemoved', v_listing.platform_removed_at is not null,
      'platformRemovedReason', v_listing.platform_removed_reason,
      'updatedAt', v_listing.updated_at),
    'visibleInCatalog', public.tournament_catalog_is_visible(p_tournament_id),
    'catalogState', case when public.tournament_catalog_is_visible(p_tournament_id)
      then public.tournament_catalog_state(p_tournament_id) else null end,
    'blockReason', public.tournament_catalog_block_reason(p_tournament_id, null),
    'canManage', public.has_tournament_organization_capability(p_organization_id, 'tournaments.update'),
    'canReview', public.has_tournament_organization_capability(p_organization_id, 'team_entries.review'),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', category.id, 'name', category.name, 'slug', category.slug,
        'capacity', capacity.max_teams,
        'approved', (select count(*) from public.tournament_team_entries entry
          where entry.category_id = category.id and entry.tournament_id = p_tournament_id and entry.status = 'approved'),
        'pending', (select count(*) from public.tournament_team_entries entry
          join public.tournament_team_applications application on application.team_entry_id = entry.id
          where entry.category_id = category.id and entry.tournament_id = p_tournament_id and entry.status = 'submitted')
      ) order by category.sort_order, category.name)
      from public.tournament_categories category
      left join public.tournament_category_capacities capacity on capacity.category_id = category.id
      where category.tournament_id = p_tournament_id and category.status = 'active'
    ), '[]'::jsonb),
    'venues', coalesce((
      select jsonb_agg(jsonb_build_object('id', venue.id, 'name', venue.name, 'locality', venue.locality)
        order by venue.name)
      from public.tournament_venues venue
      where venue.organization_id = p_organization_id and venue.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.assert_tournament_catalog_manager(p_organization_id uuid, p_tournament_id uuid)
returns public.tournaments language plpgsql stable security definer set search_path = '' as $$
declare v_tournament public.tournaments%rowtype;
begin
  if private.current_identity_id() is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  select * into v_tournament from public.tournaments
  where id = p_tournament_id and organization_id = p_organization_id;
  if v_tournament.id is null
    or not public.has_tournament_organization_capability(p_organization_id, 'tournaments.update')
    or not public.has_tournament_season_access(p_organization_id, v_tournament.season_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  return v_tournament;
end;
$$;

create or replace function public.save_tournament_catalog_listing(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_summary text,
  p_locality text,
  p_venue_id uuid,
  p_entry_fee_cents integer,
  p_entry_fee_includes text,
  p_payment_note text,
  p_requirements text,
  p_rules_summary text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tournament public.tournaments%rowtype;
  v_summary text := nullif(btrim(coalesce(p_summary, '')), '');
  v_locality text := nullif(btrim(regexp_replace(coalesce(p_locality, ''), '\s+', ' ', 'g')), '');
begin
  v_tournament := public.assert_tournament_catalog_manager(p_organization_id, p_tournament_id);
  if v_tournament.status = 'archived' then
    raise exception using errcode = 'PT409', message = 'TORNEOS_CATALOG_LISTING_NOT_READY';
  end if;
  if p_venue_id is not null and not exists (
    select 1 from public.tournament_venues venue
    where venue.id = p_venue_id and venue.organization_id = p_organization_id and venue.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_LISTING_INVALID';
  end if;
  if exists (
    select 1 from public.tournament_catalog_listings listing
    where listing.tournament_id = p_tournament_id and listing.platform_removed_at is not null
  ) then
    raise exception using errcode = 'PT409', message = 'TORNEOS_CATALOG_LISTING_REMOVED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tournament_id::text, 20261006));
  begin
    insert into public.tournament_catalog_listings (
      tournament_id, organization_id, summary, locality, venue_id, entry_fee_cents,
      entry_fee_includes, payment_note, requirements, rules_summary, updated_by
    ) values (
      p_tournament_id, p_organization_id, v_summary, v_locality, p_venue_id, p_entry_fee_cents,
      nullif(btrim(coalesce(p_entry_fee_includes, '')), ''), nullif(btrim(coalesce(p_payment_note, '')), ''),
      nullif(btrim(coalesce(p_requirements, '')), ''), nullif(btrim(coalesce(p_rules_summary, '')), ''), private.current_identity_id()
    )
    on conflict (tournament_id) do update set
      summary = excluded.summary, locality = excluded.locality, venue_id = excluded.venue_id,
      entry_fee_cents = excluded.entry_fee_cents, entry_fee_includes = excluded.entry_fee_includes,
      payment_note = excluded.payment_note, requirements = excluded.requirements,
      rules_summary = excluded.rules_summary, updated_by = excluded.updated_by, updated_at = now();
  exception when check_violation then
    raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_LISTING_INVALID';
  end;
  -- A listed call must keep the minimum a team needs to decide.
  if exists (
    select 1 from public.tournament_catalog_listings listing
    where listing.tournament_id = p_tournament_id and listing.status = 'listed'
      and (listing.summary is null or listing.locality is null)
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_LISTING_INCOMPLETE';
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'catalog.listing_saved', 'tournament', p_tournament_id, null, p_tournament_id, '{}'::jsonb
  );
  return public.get_tournament_catalog_listing_settings(p_organization_id, p_tournament_id);
end;
$$;

create or replace function public.set_tournament_catalog_listing_status(
  p_organization_id uuid, p_tournament_id uuid, p_listed boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tournament public.tournaments%rowtype;
  v_listing public.tournament_catalog_listings%rowtype;
begin
  v_tournament := public.assert_tournament_catalog_manager(p_organization_id, p_tournament_id);
  if p_listed is null then raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_LISTING_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tournament_id::text, 20261006));
  select * into v_listing from public.tournament_catalog_listings where tournament_id = p_tournament_id for update;
  if v_listing.tournament_id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_LISTING_INCOMPLETE';
  end if;
  if v_listing.platform_removed_at is not null then
    raise exception using errcode = 'PT409', message = 'TORNEOS_CATALOG_LISTING_REMOVED';
  end if;
  if p_listed then
    if v_listing.summary is null or v_listing.locality is null then
      raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_LISTING_INCOMPLETE';
    end if;
    if v_tournament.status not in ('registration', 'scheduled', 'active')
      or not exists (
        select 1 from public.tournament_public_pages page
        where page.tournament_id = p_tournament_id and page.status = 'published'
      )
      or not exists (
        select 1 from public.tournament_categories category
        where category.tournament_id = p_tournament_id and category.status = 'active'
      ) then
      raise exception using errcode = 'PT409', message = 'TORNEOS_CATALOG_LISTING_NOT_READY';
    end if;
    if v_listing.status <> 'listed' then
      update public.tournament_catalog_listings set
        status = 'listed', listed_at = now(), listed_by = private.current_identity_id(), withdrawn_at = null, withdrawn_by = null,
        updated_by = private.current_identity_id(), updated_at = now()
      where tournament_id = p_tournament_id;
    end if;
  elsif v_listing.status = 'listed' then
    -- Withdrawing also pauses requests: listing again never reopens them by itself.
    update public.tournament_catalog_listings set
      status = 'withdrawn', withdrawn_at = now(), withdrawn_by = private.current_identity_id(),
      applications_state = case when applications_state = 'open' then 'paused' else applications_state end,
      updated_by = private.current_identity_id(), updated_at = now()
    where tournament_id = p_tournament_id;
  end if;
  perform public.append_tournament_audit(
    p_organization_id, case when p_listed then 'catalog.listed' else 'catalog.withdrawn' end,
    'tournament', p_tournament_id, null, p_tournament_id, '{}'::jsonb
  );
  return public.get_tournament_catalog_listing_settings(p_organization_id, p_tournament_id);
end;
$$;

create or replace function public.set_tournament_applications_state(
  p_organization_id uuid, p_tournament_id uuid, p_state text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tournament public.tournaments%rowtype;
  v_listing public.tournament_catalog_listings%rowtype;
begin
  v_tournament := public.assert_tournament_catalog_manager(p_organization_id, p_tournament_id);
  if p_state is null or p_state not in ('open', 'paused', 'closed') then
    raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_LISTING_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tournament_id::text, 20261006));
  select * into v_listing from public.tournament_catalog_listings where tournament_id = p_tournament_id for update;
  if v_listing.tournament_id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_LISTING_INCOMPLETE';
  end if;
  if p_state = 'open' and (
    v_listing.status <> 'listed' or v_listing.platform_removed_at is not null
    or v_tournament.status <> 'registration'
    or (v_tournament.registration_closes_at is not null and now() > v_tournament.registration_closes_at)
  ) then
    raise exception using errcode = 'PT409', message = 'TORNEOS_CATALOG_LISTING_NOT_READY';
  end if;
  update public.tournament_catalog_listings set applications_state = p_state, updated_by = private.current_identity_id(), updated_at = now()
  where tournament_id = p_tournament_id;
  perform public.append_tournament_audit(
    p_organization_id, 'catalog.applications_' || p_state, 'tournament', p_tournament_id, null, p_tournament_id, '{}'::jsonb
  );
  return public.get_tournament_catalog_listing_settings(p_organization_id, p_tournament_id);
end;
$$;

create or replace function public.save_tournament_category_capacity(
  p_organization_id uuid, p_tournament_id uuid, p_category_id uuid, p_max_teams integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_approved integer;
begin
  perform public.assert_tournament_catalog_manager(p_organization_id, p_tournament_id);
  if not exists (
    select 1 from public.tournament_categories category
    where category.id = p_category_id and category.tournament_id = p_tournament_id
      and category.organization_id = p_organization_id and category.status = 'active'
  ) or (p_max_teams is not null and p_max_teams not between 2 and 256) then
    raise exception using errcode = '22023', message = 'TORNEOS_CATALOG_LISTING_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tournament_id::text || ':' || p_category_id::text, 0));
  if p_max_teams is null then
    delete from public.tournament_category_capacities where category_id = p_category_id;
  else
    select count(*) into v_approved from public.tournament_team_entries entry
    where entry.tournament_id = p_tournament_id and entry.category_id = p_category_id and entry.status = 'approved';
    if p_max_teams < v_approved then
      raise exception using errcode = 'PT409', message = 'TORNEOS_CAPACITY_BELOW_APPROVED';
    end if;
    insert into public.tournament_category_capacities (category_id, organization_id, tournament_id, max_teams, updated_by)
    values (p_category_id, p_organization_id, p_tournament_id, p_max_teams, private.current_identity_id())
    on conflict (category_id) do update set max_teams = excluded.max_teams, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'catalog.capacity_saved', 'tournament', p_tournament_id, null, p_tournament_id,
    jsonb_build_object('categoryId', p_category_id, 'maxTeams', p_max_teams)
  );
  return public.get_tournament_catalog_listing_settings(p_organization_id, p_tournament_id);
end;
$$;

create or replace function public.get_tournament_application_inbox(
  p_organization_id uuid, p_tournament_id uuid, p_status text default 'submitted',
  p_limit integer default 20, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tournament public.tournaments%rowtype;
  v_status text := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'submitted');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 30);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 2000);
  v_items jsonb := '[]'::jsonb;
  v_row record;
  v_validation jsonb;
  v_total integer;
begin
  if private.current_identity_id() is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  select * into v_tournament from public.tournaments where id = p_tournament_id and organization_id = p_organization_id;
  if v_tournament.id is null
    or not public.has_tournament_organization_capability(p_organization_id, 'team_entries.read')
    or not public.has_tournament_season_access(p_organization_id, v_tournament.season_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if v_status not in ('submitted', 'changes_requested', 'in_progress', 'approved', 'rejected', 'withdrawn', 'all') then
    raise exception using errcode = '22023', message = 'TORNEOS_APPLICATIONS_INVALID_FILTER';
  end if;

  select count(*) into v_total
  from public.tournament_team_applications application
  join public.tournament_team_entries entry on entry.id = application.team_entry_id
  where application.tournament_id = p_tournament_id and application.organization_id = p_organization_id
    and entry.status <> 'archived' and (v_status = 'all' or entry.status = v_status);

  for v_row in
    select entry.*, application.message application_message, application.core_team_id application_core_team_id,
      application.created_at application_created_at, category.name category_name,
      coalesce(profile.display_name, manager.display_name) manager_name, manager.role manager_role,
      roster.id roster_id, roster.status roster_status,
      review.decision review_decision, review.reason review_reason, review.created_at review_created_at
    from public.tournament_team_applications application
    join public.tournament_team_entries entry on entry.id = application.team_entry_id
    join public.tournament_categories category on category.id = entry.category_id
    left join lateral (
      select candidate.* from public.tournament_team_managers candidate
      where candidate.team_entry_id = entry.id and candidate.status = 'active'
      order by (candidate.user_id = application.applicant_user_id) desc, candidate.created_at
      limit 1
    ) manager on true
    -- The organization sees the responsible's current Torneos name; the roster snapshot is the fallback.
    left join public.tournament_user_profiles profile on profile.user_id = manager.user_id
    left join lateral (
      select candidate.* from public.tournament_rosters candidate
      where candidate.team_entry_id = entry.id order by candidate.version desc limit 1
    ) roster on true
    left join lateral (
      select candidate.* from public.tournament_team_reviews candidate
      where candidate.team_entry_id = entry.id order by candidate.created_at desc limit 1
    ) review on true
    where application.tournament_id = p_tournament_id and application.organization_id = p_organization_id
      and entry.status <> 'archived' and (v_status = 'all' or entry.status = v_status)
    order by case entry.status when 'submitted' then 0 when 'changes_requested' then 1 when 'in_progress' then 2 else 3 end,
      coalesce(entry.submitted_at, application.created_at) asc, entry.id
    limit v_limit offset v_offset
  loop
    v_validation := null;
    if v_row.roster_id is not null then
      begin
        v_validation := public.validate_tournament_roster(p_organization_id, v_row.id, v_row.roster_id);
      exception when others then
        v_validation := null;
      end;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'teamEntryId', v_row.id,
      'teamName', v_row.name,
      'categoryId', v_row.category_id,
      'categoryName', v_row.category_name,
      'status', v_row.status,
      'coreTeamLinked', v_row.application_core_team_id is not null,
      'responsible', jsonb_build_object('displayName', v_row.manager_name, 'role', v_row.manager_role),
      'message', v_row.application_message,
      'requestedAt', v_row.application_created_at,
      'submittedAt', v_row.submitted_at,
      'rosterStatus', v_row.roster_status,
      'roster', v_validation,
      'lastReview', case when v_row.review_decision is null then null else jsonb_build_object(
        'decision', v_row.review_decision, 'reason', v_row.review_reason, 'createdAt', v_row.review_created_at) end
    ));
  end loop;

  return jsonb_build_object(
    'items', v_items,
    'pagination', jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', v_total,
      'hasMore', v_total > v_offset + v_limit),
    'counts', (
      select jsonb_object_agg(status_key, (
        select count(*) from public.tournament_team_applications application
        join public.tournament_team_entries entry on entry.id = application.team_entry_id
        where application.tournament_id = p_tournament_id and entry.status = status_key
      ))
      from unnest(array['submitted', 'changes_requested', 'in_progress', 'approved', 'rejected', 'withdrawn']) status_key
    ),
    'canReview', public.has_tournament_organization_capability(p_organization_id, 'team_entries.review'),
    'canApprove', public.has_tournament_organization_capability(p_organization_id, 'team_entries.approve'),
    'canReject', public.has_tournament_organization_capability(p_organization_id, 'team_entries.reject'),
    'tournament', jsonb_build_object('id', v_tournament.id, 'name', v_tournament.name, 'status', v_tournament.status)
  );
end;
$$;

-- ============================================================================================ applicant

create or replace function public.search_my_applicable_core_teams(p_public_slug text, p_query text, p_limit integer default 8)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_page public.tournament_public_pages%rowtype;
  v_query text := btrim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 12);
  v_directory jsonb;
begin
  if private.current_identity_id() is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  select * into v_page from public.tournament_public_pages where public_slug = p_public_slug and status = 'published';
  if v_page.tournament_id is null or public.tournament_catalog_block_reason(v_page.tournament_id, null) is not null then
    raise exception using errcode = 'PT409', message = 'TORNEOS_APPLICATIONS_CLOSED';
  end if;
  if char_length(v_query) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'TORNEOS_SEARCH_QUERY_INVALID';
  end if;
  -- Core directory contract, attested by the gateway for THIS identity and request: only Core teams the caller
  -- owns or administers (Core: team_user_is_admin_or_owner). The request shape is the applicant branch of
  -- private.authorize_core_contract, distinct from the organizer import.
  v_directory := private.consume_core_attestation(
    'directory_teams',
    jsonb_build_object('applicantTournamentId', v_page.tournament_id, 'query', v_query, 'limit', v_limit)
  );
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('id', item->>'core_team_id', 'name', item->>'name', 'crestUrl', item->'crest_url')
      order by item->>'name', item->>'core_team_id')
    from jsonb_array_elements(coalesce(v_directory->'items', '[]'::jsonb)) item
  ), '[]'::jsonb));
end;
$$;

create or replace function public.start_tournament_application(
  p_public_slug text,
  p_category_slug text,
  p_core_team_id uuid,
  p_team_name text,
  p_message text,
  p_accept_conditions boolean,
  p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.current_identity_id();
  v_page public.tournament_public_pages%rowtype;
  v_tournament public.tournaments%rowtype;
  v_category public.tournament_categories%rowtype;
  v_profile public.tournament_user_profiles%rowtype;
  v_snapshot jsonb;
  v_entry public.tournament_team_entries%rowtype;
  v_roster public.tournament_rosters%rowtype;
  v_reason text;
  v_name text;
  v_slug text;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_REQUIRED'; end if;
  if p_accept_conditions is not true then
    raise exception using errcode = '22023', message = 'TORNEOS_APPLICATION_CONDITIONS_REQUIRED';
  end if;
  if v_message is not null and char_length(v_message) not between 2 and 500 then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_TEAM_ENTRY';
  end if;

  select * into v_page from public.tournament_public_pages where public_slug = p_public_slug and status = 'published';
  if v_page.tournament_id is null then
    raise exception using errcode = 'PT409', message = 'TORNEOS_APPLICATIONS_CLOSED';
  end if;
  select * into v_tournament from public.tournaments
  where id = v_page.tournament_id and organization_id = v_page.organization_id;
  select * into v_category from public.tournament_categories
  where tournament_id = v_tournament.id and organization_id = v_tournament.organization_id
    and slug = p_category_slug and status = 'active';
  if v_category.id is null then
    raise exception using errcode = 'PT409', message = 'TORNEOS_APPLICATIONS_CLOSED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tournament.organization_id::text || ':' || v_tournament.id::text, 0));

  -- Replay of the same request: the same entry, whatever happened since.
  select * into v_entry from public.tournament_team_entries
  where organization_id = v_tournament.organization_id and created_by = v_uid and idempotency_key = p_idempotency_key;
  if v_entry.id is not null then
    return jsonb_build_object('teamEntryId', v_entry.id, 'organizationId', v_entry.organization_id,
      'status', v_entry.status, 'replayed', true);
  end if;

  v_reason := public.tournament_catalog_block_reason(v_tournament.id, v_category.id);
  if v_reason = 'category_full' then
    raise exception using errcode = 'PT409', message = 'TORNEOS_CATEGORY_FULL';
  elsif v_reason is not null then
    raise exception using errcode = 'PT409', message = 'TORNEOS_APPLICATIONS_CLOSED';
  end if;

  select * into v_profile from public.tournament_user_profiles where user_id = v_uid;
  if v_profile.display_name is null then
    raise exception using errcode = '22023', message = 'TORNEOS_PROFILE_NAME_REQUIRED';
  end if;

  if (
    select count(*) from public.tournament_team_applications application
    join public.tournament_team_entries entry on entry.id = application.team_entry_id
    where application.applicant_user_id = v_uid and application.tournament_id = v_tournament.id
      and entry.status in ('draft', 'invited', 'in_progress', 'submitted', 'changes_requested')
  ) >= 3 then
    raise exception using errcode = 'PT422', message = 'TORNEOS_APPLICATION_LIMIT_REACHED';
  end if;

  if p_core_team_id is not null then
    -- Authority comes from Core, never from the client: the gateway attested (team_snapshot, applicant branch) that
    -- this identity owns or administers this active Core team, for this tournament and category, moments ago.
    v_snapshot := private.consume_core_attestation(
      'team_snapshot',
      jsonb_build_object('applicationTournamentId', v_tournament.id, 'categoryId', v_category.id, 'coreTeamId', p_core_team_id)
    );
    if (v_snapshot->>'core_team_id')::uuid is distinct from p_core_team_id then
      raise exception using errcode = '42501', message = 'TORNEOS_TEAM_NOT_AUTHORIZED';
    end if;
    if exists (
      select 1 from public.tournament_team_entries entry
      where entry.tournament_id = v_tournament.id and entry.category_id = v_category.id
        and entry.arma2_team_id = p_core_team_id and entry.status not in ('withdrawn', 'archived', 'rejected')
    ) then
      raise exception using errcode = '23505', message = 'TORNEOS_TEAM_ALREADY_REGISTERED';
    end if;
    v_name := btrim(v_snapshot->>'name');
  else
    v_name := btrim(regexp_replace(coalesce(p_team_name, ''), '\s+', ' ', 'g'));
  end if;
  if char_length(v_name) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_TEAM_ENTRY';
  end if;
  if exists (
    select 1 from public.tournament_team_entries entry
    where entry.tournament_id = v_tournament.id and entry.category_id = v_category.id
      and public.tournament_catalog_normalize(entry.name) = public.tournament_catalog_normalize(v_name)
      and entry.status not in ('withdrawn', 'archived', 'rejected')
  ) then
    raise exception using errcode = 'PT409', message = 'TORNEOS_TEAM_NAME_TAKEN';
  end if;

  v_slug := public.normalize_tournament_competition_slug(v_name);
  if char_length(v_slug) < 2 then v_slug := 'equipo-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8); end if;
  if exists (
    select 1 from public.tournament_team_entries
    where tournament_id = v_tournament.id and category_id = v_category.id and slug = v_slug
  ) then v_slug := left(v_slug, 54) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8); end if;

  insert into public.tournament_team_entries (
    organization_id, season_id, tournament_id, category_id, arma2_team_id,
    name, slug, primary_color, secondary_color, status, registration_source, created_by, idempotency_key
  ) values (
    v_tournament.organization_id, v_tournament.season_id, v_tournament.id, v_category.id, p_core_team_id,
    v_name, v_slug, null, null, 'in_progress',
    case when p_core_team_id is null then 'provisional' else 'arma2_team' end, v_uid, p_idempotency_key
  ) returning * into v_entry;

  if p_core_team_id is not null then
    insert into private.tournament_team_entry_core_snapshots (
      team_entry_id, organization_id, tournament_id, core_team_id, name, crest_url,
      players, source_revision, captured_at, imported_by
    ) values (
      v_entry.id, v_tournament.organization_id, v_tournament.id, p_core_team_id,
      v_snapshot->>'name', v_snapshot->>'crest_url', coalesce(v_snapshot->'players', '[]'::jsonb),
      (v_snapshot->>'source_revision')::integer, to_timestamp((v_snapshot->>'captured_at')::bigint), v_uid
    );
  end if;

  insert into public.tournament_rosters (organization_id, team_entry_id, version, status, created_by)
  values (v_tournament.organization_id, v_entry.id, 1, 'draft', v_uid)
  returning * into v_roster;

  insert into public.tournament_roster_settings (
    tournament_id, organization_id, minimum_players, maximum_players,
    minimum_goalkeepers, roster_opens_at, roster_closes_at
  ) values (
    v_tournament.id, v_tournament.organization_id, v_tournament.team_size,
    least(80, v_tournament.team_size + coalesce(v_tournament.substitutes_limit, v_tournament.team_size)),
    1, v_tournament.registration_opens_at, v_tournament.registration_closes_at
  ) on conflict (tournament_id) do nothing;

  -- The applicant represents this entry only: captain of the entry, never a member of the organization.
  insert into public.tournament_team_managers (
    organization_id, team_entry_id, user_id, email_normalized, display_name,
    role, status, invited_by, accepted_at
  ) values (
    v_tournament.organization_id, v_entry.id, v_uid, null, v_profile.display_name,
    'captain', 'active', v_uid, now()
  );

  insert into public.tournament_team_applications (
    team_entry_id, organization_id, tournament_id, category_id, applicant_user_id, core_team_id,
    message, accepted_conditions_at
  ) values (
    v_entry.id, v_tournament.organization_id, v_tournament.id, v_category.id, v_uid, p_core_team_id,
    v_message, now()
  );

  perform public.append_tournament_audit(
    v_tournament.organization_id, 'team_entry.application_started', 'team_entry', v_entry.id,
    v_entry.id, v_tournament.id,
    jsonb_build_object('categoryId', v_category.id, 'linked', p_core_team_id is not null)
  );
  return jsonb_build_object('teamEntryId', v_entry.id, 'organizationId', v_entry.organization_id,
    'status', v_entry.status, 'replayed', false);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'TORNEOS_TEAM_ALREADY_REGISTERED';
end;
$$;

create or replace function public.get_my_tournament_registrations(p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.current_identity_id();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 2000);
  v_result jsonb;
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  with mine as (
    select distinct on (entry.id)
      entry.*, manager.role manager_role
    from public.tournament_team_entries entry
    join public.tournament_team_managers manager
      on manager.team_entry_id = entry.id and manager.organization_id = entry.organization_id
     and manager.user_id = v_uid and manager.status = 'active' and manager.role in ('captain', 'delegate')
    join public.tournament_organizations organization
      on organization.id = entry.organization_id and organization.status = 'active'
    where entry.status <> 'archived'
    order by entry.id, manager.role
  ),
  page as (
    select row_number() over (order by case mine.status when 'changes_requested' then 0 when 'in_progress' then 1
        when 'invited' then 1 when 'draft' then 1 when 'submitted' then 2 when 'approved' then 3 else 4 end,
        mine.updated_at desc, mine.id) position,
      mine.*, tournament.name tournament_name, tournament.status tournament_status,
      organization.name organization_name, category.name category_name, category.slug category_slug,
      public_page.public_slug,
      application.team_entry_id is not null is_application,
      roster.status roster_status,
      review.decision review_decision, review.reason review_reason, review.created_at review_created_at
    from mine
    join public.tournaments tournament on tournament.id = mine.tournament_id
    join public.tournament_organizations organization on organization.id = mine.organization_id
    join public.tournament_categories category on category.id = mine.category_id
    left join public.tournament_public_pages public_page
      on public_page.tournament_id = mine.tournament_id and public_page.status = 'published'
    left join public.tournament_team_applications application on application.team_entry_id = mine.id
    left join lateral (
      select candidate.status from public.tournament_rosters candidate
      where candidate.team_entry_id = mine.id order by candidate.version desc limit 1
    ) roster on true
    left join lateral (
      select candidate.decision, candidate.reason, candidate.created_at from public.tournament_team_reviews candidate
      where candidate.team_entry_id = mine.id order by candidate.created_at desc limit 1
    ) review on true
    order by case mine.status when 'changes_requested' then 0 when 'in_progress' then 1 when 'invited' then 1
      when 'draft' then 1 when 'submitted' then 2 when 'approved' then 3 else 4 end,
      mine.updated_at desc, mine.id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'teamEntryId', page.id,
      'organizationId', page.organization_id,
      'organizationName', page.organization_name,
      'tournamentId', page.tournament_id,
      'tournamentName', page.tournament_name,
      'tournamentStatus', page.tournament_status,
      'categoryId', page.category_id,
      'categoryName', page.category_name,
      'categorySlug', page.category_slug,
      'teamName', page.name,
      'status', page.status,
      'source', case when page.is_application then 'application' else 'organization' end,
      'managerRole', page.manager_role,
      'createdAt', page.created_at,
      'submittedAt', page.submitted_at,
      'approvedAt', page.approved_at,
      'updatedAt', page.updated_at,
      'publicSlug', page.public_slug,
      'rosterStatus', page.roster_status,
      'lastReview', case when page.review_decision is null then null else jsonb_build_object(
        'decision', page.review_decision, 'reason', page.review_reason, 'createdAt', page.review_created_at) end,
      'canEdit', public.can_edit_tournament_team_entry(page.organization_id, page.id),
      'blockReason', case when page.is_application and page.status in ('in_progress', 'changes_requested')
        then public.tournament_catalog_block_reason(page.tournament_id, page.category_id) else null end
    ) order by page.position) from page), '[]'::jsonb),
    'pagination', jsonb_build_object('limit', v_limit, 'offset', v_offset,
      'total', (select count(*) from mine),
      'hasMore', (select count(*) from mine) > v_offset + v_limit)
  ) into v_result;
  return v_result;
end;
$$;

-- ============================================================================================ platform lever

-- Operational removal of an abusive call. service_role only; not exposed by any client or gateway allowlist.
create or replace function public.platform_remove_tournament_catalog_listing(p_tournament_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_listing public.tournament_catalog_listings%rowtype;
begin
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'TORNEOS_REASON_REQUIRED';
  end if;
  update public.tournament_catalog_listings set
    status = case when status = 'listed' then 'withdrawn' else status end,
    applications_state = 'closed',
    withdrawn_at = case when status = 'listed' then now() else withdrawn_at end,
    platform_removed_at = now(), platform_removed_reason = btrim(p_reason), updated_at = now()
  where tournament_id = p_tournament_id
  returning * into v_listing;
  if v_listing.tournament_id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  insert into public.tournament_audit_log (organization_id, actor_user_id, actor_type, action, resource_type,
    resource_id, tournament_id, metadata)
  values (v_listing.organization_id, null, 'system', 'catalog.platform_removed', 'tournament', p_tournament_id,
    p_tournament_id, '{}'::jsonb);
  return jsonb_build_object('tournamentId', p_tournament_id, 'removed', true);
end;
$$;

-- ============================================================================================ ACL

revoke all on function
  public.tournament_catalog_normalize(text),
  public.tournament_catalog_block_reason(uuid, uuid),
  public.tournament_catalog_is_visible(uuid),
  public.tournament_catalog_state(uuid),
  public.tournament_catalog_categories(uuid),
  public.tournament_registration_reviewer_ids(uuid, uuid),
  public.tournament_notification_visible(text, uuid, uuid),
  public.guard_tournament_team_entry_connected_transition(),
  public.notify_tournament_team_entry_submitted(),
  public.notify_tournament_team_entry_reviewed(),
  public.assert_tournament_catalog_manager(uuid, uuid),
  public.get_my_torneos_profile(),
  public.update_my_torneos_profile(text, boolean),
  public.get_my_torneos_notifications(boolean, integer, integer),
  public.mark_my_torneos_notifications_read(uuid[]),
  public.get_my_torneos_inbox_summary(),
  public.search_tournament_catalog(text, text, text, text, text, text, text, text, text),
  public.get_tournament_catalog_facets(),
  public.get_tournament_catalog_entry(text),
  public.get_tournament_catalog_listing_settings(uuid, uuid),
  public.save_tournament_catalog_listing(uuid, uuid, text, text, uuid, integer, text, text, text, text),
  public.set_tournament_catalog_listing_status(uuid, uuid, boolean),
  public.set_tournament_applications_state(uuid, uuid, text),
  public.save_tournament_category_capacity(uuid, uuid, uuid, integer),
  public.get_tournament_application_inbox(uuid, uuid, text, integer, integer),
  public.search_my_applicable_core_teams(text, text, integer),
  public.start_tournament_application(text, text, uuid, text, text, boolean, uuid),
  public.get_my_tournament_registrations(integer, integer),
  public.platform_remove_tournament_catalog_listing(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.search_tournament_catalog(text, text, text, text, text, text, text, text, text),
  public.get_tournament_catalog_facets(),
  public.get_tournament_catalog_entry(text)
to anon, authenticated;

grant execute on function
  public.get_my_torneos_profile(),
  public.update_my_torneos_profile(text, boolean),
  public.get_my_torneos_notifications(boolean, integer, integer),
  public.mark_my_torneos_notifications_read(uuid[]),
  public.get_my_torneos_inbox_summary(),
  public.get_tournament_catalog_listing_settings(uuid, uuid),
  public.save_tournament_catalog_listing(uuid, uuid, text, text, uuid, integer, text, text, text, text),
  public.set_tournament_catalog_listing_status(uuid, uuid, boolean),
  public.set_tournament_applications_state(uuid, uuid, text),
  public.save_tournament_category_capacity(uuid, uuid, uuid, integer),
  public.get_tournament_application_inbox(uuid, uuid, text, integer, integer),
  public.search_my_applicable_core_teams(text, text, integer),
  public.start_tournament_application(text, text, uuid, text, text, boolean, uuid),
  public.get_my_tournament_registrations(integer, integer)
to authenticated;

grant execute on function public.platform_remove_tournament_catalog_listing(uuid, text) to service_role;

-- ============================================================================================ applicant authorizer

-- Server-side pre-authorization of the two applicant Core contracts, called by the gateway adapter (as
-- torneos_core_adapter) before Core is asked. Same return shape as private.authorize_core_contract; the request hash
-- binds exactly what start_tournament_application / search_my_applicable_core_teams will consume.
create or replace function private.authorize_applicant_core_contract(p_contract text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_identity uuid := private.current_identity_id();
  v_page public.tournament_public_pages%rowtype;
  v_category public.tournament_categories%rowtype;
  v_reason text;
  v_query text;
  v_limit integer;
  v_core_team_id uuid;
  v_request jsonb;
  v_core_request jsonb;
begin
  if v_identity is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_CORE_CONTRACT_REQUEST';
  end if;
  if p_contract = 'directory_teams' then
    if (select array_agg(key order by key) from jsonb_object_keys(p_request) key)
      is distinct from array['applicant_public_slug', 'limit', 'query'] then
      raise exception using errcode = '22023', message = 'TORNEOS_INVALID_CORE_CONTRACT_REQUEST';
    end if;
    select * into v_page from public.tournament_public_pages
    where public_slug = p_request->>'applicant_public_slug' and status = 'published';
    if v_page.tournament_id is null or public.tournament_catalog_block_reason(v_page.tournament_id, null) is not null then
      raise exception using errcode = 'PT409', message = 'TORNEOS_APPLICATIONS_CLOSED';
    end if;
    v_query := btrim(coalesce(p_request->>'query', ''));
    v_limit := least(greatest(coalesce((p_request->>'limit')::integer, 8), 1), 12);
    if char_length(v_query) not between 2 and 100 then
      raise exception using errcode = '22023', message = 'TORNEOS_SEARCH_QUERY_INVALID';
    end if;
    v_request := jsonb_build_object('applicantTournamentId', v_page.tournament_id, 'query', v_query, 'limit', v_limit);
    v_core_request := jsonb_build_object('kind', 'teams', 'query', v_query, 'limit', v_limit, 'cursor', null);
  elsif p_contract = 'team_snapshot' then
    if (select array_agg(key order by key) from jsonb_object_keys(p_request) key)
      is distinct from array['application_public_slug', 'category_slug', 'core_team_id'] then
      raise exception using errcode = '22023', message = 'TORNEOS_INVALID_CORE_CONTRACT_REQUEST';
    end if;
    v_core_team_id := (p_request->>'core_team_id')::uuid;
    if v_core_team_id is null then
      raise exception using errcode = '22023', message = 'TORNEOS_INVALID_TEAM_ENTRY';
    end if;
    select * into v_page from public.tournament_public_pages
    where public_slug = p_request->>'application_public_slug' and status = 'published';
    select category.* into v_category from public.tournament_categories category
    where category.tournament_id = v_page.tournament_id and category.slug = p_request->>'category_slug'
      and category.status = 'active';
    if v_page.tournament_id is null or v_category.id is null then
      raise exception using errcode = 'PT409', message = 'TORNEOS_APPLICATIONS_CLOSED';
    end if;
    v_reason := public.tournament_catalog_block_reason(v_page.tournament_id, v_category.id);
    if v_reason = 'category_full' then
      raise exception using errcode = 'PT409', message = 'TORNEOS_CATEGORY_FULL';
    elsif v_reason is not null then
      raise exception using errcode = 'PT409', message = 'TORNEOS_APPLICATIONS_CLOSED';
    end if;
    v_request := jsonb_build_object(
      'applicationTournamentId', v_page.tournament_id, 'categoryId', v_category.id, 'coreTeamId', v_core_team_id);
    v_core_request := jsonb_build_object('core_team_id', v_core_team_id);
  else
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_CORE_CONTRACT';
  end if;
  return jsonb_build_object(
    'contract', p_contract,
    'identity_id', v_identity,
    'core_request', v_core_request,
    'request_hash', private.core_contract_request_hash(p_contract, v_request)
  );
exception when invalid_text_representation then
  raise exception using errcode = '22023', message = 'TORNEOS_INVALID_CORE_CONTRACT_REQUEST';
end;
$$;

revoke all on function private.authorize_applicant_core_contract(text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.authorize_applicant_core_contract(text, jsonb) to torneos_core_adapter;

DO $post$
DECLARE
  v_authenticated text[] := array[
    'public.get_my_torneos_profile()', 'public.update_my_torneos_profile(text,boolean)',
    'public.get_my_torneos_notifications(boolean,integer,integer)', 'public.mark_my_torneos_notifications_read(uuid[])',
    'public.get_my_torneos_inbox_summary()', 'public.get_tournament_catalog_listing_settings(uuid,uuid)',
    'public.save_tournament_catalog_listing(uuid,uuid,text,text,uuid,integer,text,text,text,text)',
    'public.set_tournament_catalog_listing_status(uuid,uuid,boolean)', 'public.set_tournament_applications_state(uuid,uuid,text)',
    'public.save_tournament_category_capacity(uuid,uuid,uuid,integer)',
    'public.get_tournament_application_inbox(uuid,uuid,text,integer,integer)',
    'public.search_my_applicable_core_teams(text,text,integer)',
    'public.start_tournament_application(text,text,uuid,text,text,boolean,uuid)',
    'public.get_my_tournament_registrations(integer,integer)'];
  v_public text[] := array[
    'public.search_tournament_catalog(text,text,text,text,text,text,text,text,text)',
    'public.get_tournament_catalog_facets()', 'public.get_tournament_catalog_entry(text)'];
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY v_authenticated LOOP
    IF NOT has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE')
      OR has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'TORNEOS_CONNECTED_V1_POSTCONDITION_FAILED: %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY v_public LOOP
    IF NOT has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'TORNEOS_CONNECTED_V1_POSTCONDITION_FAILED: %', v_fn;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.platform_remove_tournament_catalog_listing(uuid,text)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('anon', 'public.platform_remove_tournament_catalog_listing(uuid,text)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.authorize_applicant_core_contract(text,jsonb)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege('torneos_core_adapter', 'private.authorize_applicant_core_contract(text,jsonb)'::regprocedure, 'EXECUTE')
    OR EXISTS (
      SELECT 1 FROM unnest(array['tournament_user_profiles', 'tournament_catalog_listings', 'tournament_category_capacities',
        'tournament_team_applications', 'tournament_user_notifications']) relation
      WHERE has_table_privilege('authenticated', ('public.' || relation)::regclass, 'SELECT')
         OR has_table_privilege('anon', ('public.' || relation)::regclass, 'SELECT')
    ) THEN
    RAISE EXCEPTION 'TORNEOS_CONNECTED_V1_POSTCONDITION_FAILED: unexpected grant';
  END IF;
END $post$;

COMMIT;
