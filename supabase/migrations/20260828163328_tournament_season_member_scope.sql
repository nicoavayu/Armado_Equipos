-- Arma2 Torneos · organization membership with administrative season scope.
--
-- Owners keep organization-wide access and never consume a collaborator seat.
-- Active admin/collaborator memberships require one assignment per season.

set check_function_bodies = off;

begin;

-- -------------------------------------------------------------------------
-- 1. Assignment schema and lossless backfill for seasons that already exist.
-- New seasons deliberately receive no non-owner assignments.
-- -------------------------------------------------------------------------

create table public.tournament_season_member_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  season_id uuid not null,
  membership_id uuid not null
    references public.tournament_organization_members(id) on delete restrict,
  assigned_by uuid references auth.users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint tournament_season_member_assignments_season_fk
    foreign key (organization_id,season_id)
    references public.tournament_seasons(organization_id,id) on delete restrict,
  constraint tournament_season_member_assignments_unique
    unique (season_id,membership_id)
);

create index tournament_season_member_assignments_membership_idx
  on public.tournament_season_member_assignments(membership_id,season_id);
create index tournament_season_member_assignments_scope_idx
  on public.tournament_season_member_assignments(organization_id,season_id,membership_id);

alter table public.tournament_season_member_assignments enable row level security;
revoke all on table public.tournament_season_member_assignments from public,anon,authenticated;
grant select on table public.tournament_season_member_assignments to authenticated,service_role;

insert into public.tournament_season_member_assignments (
  organization_id,season_id,membership_id,assigned_by,assigned_at
)
select season.organization_id,season.id,membership.id,organization.created_by,
  greatest(membership.joined_at,season.created_at)
from public.tournament_seasons season
join public.tournament_organizations organization on organization.id = season.organization_id
join public.tournament_organization_members membership
  on membership.organization_id = season.organization_id
 and membership.status = 'active'
 and membership.role in ('admin','collaborator')
on conflict (season_id,membership_id) do nothing;

comment on table public.tournament_season_member_assignments is
  'Administrative scope for non-owner organization memberships. One person may have one assignment in each season and counts once in each.';

-- -------------------------------------------------------------------------
-- 2. Centralized authorization helpers. These never manufacture capabilities:
-- role capability AND owner/assignment are both required.
-- -------------------------------------------------------------------------

create or replace function public.has_tournament_season_access(
  p_organization_id uuid,
  p_season_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.tournament_organization_members membership
    join public.tournament_organizations organization
      on organization.id = membership.organization_id
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and organization.status = 'active'
      and (
        membership.role = 'owner'
        or exists (
          select 1 from public.tournament_season_member_assignments assignment
          where assignment.organization_id = p_organization_id
            and assignment.season_id = p_season_id
            and assignment.membership_id = membership.id
        )
      )
  );
$$;

create or replace function public.has_tournament_season_capability(
  p_organization_id uuid,
  p_season_id uuid,
  p_capability text
) returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.tournament_organization_members membership
    join public.tournament_organizations organization
      on organization.id = membership.organization_id
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and organization.status = 'active'
      and p_capability = any(public.tournament_role_capabilities(membership.role))
      and (
        membership.role = 'owner'
        or exists (
          select 1 from public.tournament_season_member_assignments assignment
          where assignment.organization_id = p_organization_id
            and assignment.season_id = p_season_id
            and assignment.membership_id = membership.id
        )
      )
  );
$$;

create or replace function public.has_tournament_capability(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_capability text
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tournaments tournament
    where tournament.organization_id = p_organization_id
      and tournament.id = p_tournament_id
      and public.has_tournament_season_capability(
        p_organization_id,tournament.season_id,p_capability
      )
  );
$$;

create or replace function public.tournament_season_member_assignment_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_membership public.tournament_organization_members%rowtype;
  v_limit integer;
  v_usage integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.organization_id::text || ':' || new.season_id::text,87)
  );
  select * into v_membership from public.tournament_organization_members
  where id = new.membership_id for share;
  if v_membership.id is null
    or v_membership.organization_id <> new.organization_id
    or v_membership.status <> 'active'
    or v_membership.role not in ('admin','collaborator') then
    raise exception using errcode = '22023', message = 'TORNEOS_SEASON_ASSIGNMENT_INVALID';
  end if;
  select catalog.administrative_collaborator_limit into v_limit
  from public.tournament_plan_catalog catalog
  where catalog.plan_code = case when exists (
    select 1 from public.tournament_season_plan_grants grant_row
    where grant_row.organization_id = new.organization_id
      and grant_row.season_id = new.season_id
      and public.is_tournament_season_plan_grant_effective(grant_row.id)
  ) then 'PREMIUM' else 'FREE' end;
  select count(*)::integer into v_usage
  from public.tournament_season_member_assignments assignment
  where assignment.organization_id = new.organization_id
    and assignment.season_id = new.season_id
    and (tg_op = 'INSERT' or assignment.id <> new.id);
  if v_usage >= v_limit then
    raise exception using errcode = '23514',
      message = 'TORNEOS_SEASON_COLLABORATOR_LIMIT_REACHED',
      detail = jsonb_build_object('limit',v_limit,'usage',v_usage,'seasonId',new.season_id)::text;
  end if;
  return new;
end;
$$;

create trigger tournament_season_member_assignment_limit
before insert or update on public.tournament_season_member_assignments
for each row execute function public.tournament_season_member_assignment_limit();

create or replace function public.assign_tournament_season_member(
  p_organization_id uuid,
  p_season_id uuid,
  p_membership_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_assignment public.tournament_season_member_assignments%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_season_capability(
    p_organization_id,p_season_id,'members.invite'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_SEASON_ASSIGNMENT_FORBIDDEN';
  end if;
  insert into public.tournament_season_member_assignments (
    organization_id,season_id,membership_id,assigned_by
  ) values (p_organization_id,p_season_id,p_membership_id,auth.uid())
  on conflict (season_id,membership_id) do update
    set assigned_by = public.tournament_season_member_assignments.assigned_by
  returning * into v_assignment;
  return jsonb_build_object('id',v_assignment.id,'organizationId',v_assignment.organization_id,
    'seasonId',v_assignment.season_id,'membershipId',v_assignment.membership_id,
    'assignedAt',v_assignment.assigned_at);
end;
$$;

create or replace function public.remove_tournament_season_member_assignment(
  p_organization_id uuid,
  p_season_id uuid,
  p_membership_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_season_capability(
    p_organization_id,p_season_id,'members.remove'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_SEASON_ASSIGNMENT_FORBIDDEN';
  end if;
  delete from public.tournament_season_member_assignments
  where organization_id = p_organization_id and season_id = p_season_id
    and membership_id = p_membership_id;
  return found;
end;
$$;

create or replace function public.list_tournament_season_member_assignments(
  p_organization_id uuid,
  p_season_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.has_tournament_season_capability(
    p_organization_id,p_season_id,'members.read'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_SEASON_ASSIGNMENT_FORBIDDEN';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',assignment.id,'membershipId',membership.id,'userId',membership.user_id,
    'role',membership.role,'status',membership.status,'assignedAt',assignment.assigned_at
  ) order by membership.role,membership.joined_at),'[]'::jsonb) into v_result
  from public.tournament_season_member_assignments assignment
  join public.tournament_organization_members membership on membership.id = assignment.membership_id
  where assignment.organization_id = p_organization_id and assignment.season_id = p_season_id;
  return v_result;
end;
$$;

create policy tournament_season_member_assignments_select_scope
on public.tournament_season_member_assignments for select to authenticated
using (
  (select public.has_tournament_season_capability(organization_id,season_id,'members.read'))
  or exists (
    select 1 from public.tournament_organization_members membership
    where membership.id = membership_id and membership.user_id = (select auth.uid())
  )
);

-- -------------------------------------------------------------------------
-- 3. RLS roots and write guards. Existing organization-only helper remains
-- unchanged; season resources use the explicit helper.
-- -------------------------------------------------------------------------

drop policy if exists tournament_seasons_select_capability on public.tournament_seasons;
create policy tournament_seasons_select_season_scope
on public.tournament_seasons for select to authenticated
using ((select public.has_tournament_season_access(organization_id,id)));

drop policy if exists tournaments_select_capability on public.tournaments;
create policy tournaments_select_season_scope
on public.tournaments for select to authenticated
using ((select public.has_tournament_season_access(organization_id,season_id)));

drop policy if exists tournament_categories_select_capability on public.tournament_categories;
create policy tournament_categories_select_season_scope
on public.tournament_categories for select to authenticated
using ((select public.has_tournament_capability(organization_id,tournament_id,'categories.read')));

create or replace function public.enforce_tournament_season_root_write_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
declare v_organization_id uuid := (v_row->>'organization_id')::uuid;
declare v_season_id uuid;
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_table_name = 'tournament_seasons' then
    v_season_id := (v_row->>'id')::uuid;
  elsif v_row ? 'season_id' then
    v_season_id := (v_row->>'season_id')::uuid;
  elsif v_row ? 'tournament_id' then
    select season_id into v_season_id from public.tournaments
    where organization_id = v_organization_id and id = (v_row->>'tournament_id')::uuid;
  end if;
  if v_season_id is null or not public.has_tournament_season_access(v_organization_id,v_season_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_SEASON_SCOPE_FORBIDDEN';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger tournament_seasons_write_scope
before update or delete on public.tournament_seasons
for each row execute function public.enforce_tournament_season_root_write_scope();
create trigger tournaments_write_scope
before insert or update or delete on public.tournaments
for each row execute function public.enforce_tournament_season_root_write_scope();
create trigger tournament_categories_write_scope
before insert or update or delete on public.tournament_categories
for each row execute function public.enforce_tournament_season_root_write_scope();
create trigger tournament_scoring_rules_write_scope
before insert or update or delete on public.tournament_scoring_rules
for each row execute function public.enforce_tournament_season_root_write_scope();
create trigger tournament_tiebreak_rules_write_scope
before insert or update or delete on public.tournament_tiebreak_rules
for each row execute function public.enforce_tournament_season_root_write_scope();
create trigger tournament_discipline_rules_write_scope
before insert or update or delete on public.tournament_discipline_rules
for each row execute function public.enforce_tournament_season_root_write_scope();

-- The update RPC has an explicit season boundary before locking/mutating.
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
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_season public.tournament_seasons%rowtype;
  v_name text; v_slug text; v_start_date date; v_end_date date;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  if not public.has_tournament_season_capability(
    p_organization_id,p_season_id,
    case when p_status = 'archived' then 'seasons.archive' else 'seasons.update' end
  ) then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  select * into v_season from public.tournament_seasons
  where id = p_season_id and organization_id = p_organization_id for update;
  if v_season.id is null or v_season.status = 'archived' then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if p_status is not null and not (
    (v_season.status = 'draft' and p_status in ('active','archived'))
    or (v_season.status = 'active' and p_status = 'completed')
    or (v_season.status = 'completed' and p_status = 'archived')
  ) then raise exception using errcode = '22023', message = 'TORNEOS_INVALID_SEASON_TRANSITION'; end if;
  if p_status = 'archived' and exists (
    select 1 from public.tournaments where organization_id = p_organization_id
      and season_id = p_season_id and status <> 'archived'
  ) then raise exception using errcode = '23514', message = 'TORNEOS_SEASON_HAS_TOURNAMENTS'; end if;
  v_name := case when p_name is null then v_season.name else btrim(p_name) end;
  v_slug := case when p_slug is null then v_season.slug else public.normalize_tournament_competition_slug(p_slug) end;
  v_start_date := case when p_clear_start_date then null else coalesce(p_start_date,v_season.start_date) end;
  v_end_date := case when p_clear_end_date then null else coalesce(p_end_date,v_season.end_date) end;
  if char_length(v_name) not between 3 and 80 or char_length(v_slug) not between 3 and 48
    or (v_start_date is not null and v_end_date is not null and v_end_date < v_start_date) then
    raise exception using errcode = '22023', message = 'TORNEOS_INVALID_SEASON';
  end if;
  begin
    update public.tournament_seasons set name=v_name,slug=v_slug,start_date=v_start_date,
      end_date=v_end_date,status=coalesce(p_status,status),
      archived_at=case when p_status='archived' then now() else archived_at end
    where id=p_season_id returning * into v_season;
  exception when unique_violation then
    raise exception using errcode='23505',message='TORNEOS_SEASON_SLUG_TAKEN';
  end;
  if v_season.status='archived' then
    update public.user_tournament_context_preferences set active_season_id=null,active_tournament_id=null
    where organization_id=p_organization_id and active_season_id=p_season_id;
  end if;
  return jsonb_build_object('id',v_season.id,'organizationId',v_season.organization_id,
    'name',v_season.name,'slug',v_season.slug,'status',v_season.status,
    'startDate',v_season.start_date,'endDate',v_season.end_date,
    'createdAt',v_season.created_at,'updatedAt',v_season.updated_at);
end;
$$;

-- Filter the already-certified competition projection rather than duplicating
-- its sporting joins. The legacy implementation is no longer client-callable.
alter function public.get_tournament_competition_context(uuid)
  rename to get_tournament_competition_context_organization_legacy;

create or replace function public.get_tournament_competition_context(
  p_organization_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_payload jsonb;
  v_seasons jsonb;
  v_tournaments jsonb;
  v_preference jsonb;
  v_active_season_id uuid;
  v_active_tournament_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='TORNEOS_AUTH_REQUIRED'; end if;
  if not public.is_tournament_organization_member(p_organization_id) then
    raise exception using errcode='42501',message='TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  v_payload := public.get_tournament_competition_context_organization_legacy(p_organization_id);
  select coalesce(jsonb_agg(item order by item->>'updatedAt' desc),'[]'::jsonb) into v_seasons
  from jsonb_array_elements(v_payload->'seasons') item
  where public.has_tournament_season_access(p_organization_id,(item->>'id')::uuid);
  select coalesce(jsonb_agg(item order by item->>'updatedAt' desc),'[]'::jsonb) into v_tournaments
  from jsonb_array_elements(v_payload->'tournaments') item
  where public.has_tournament_season_access(p_organization_id,(item->>'seasonId')::uuid);
  v_preference := v_payload->'preference';
  v_active_season_id := nullif(v_preference->>'activeSeasonId','')::uuid;
  v_active_tournament_id := nullif(v_preference->>'activeTournamentId','')::uuid;
  if v_active_season_id is null or not public.has_tournament_season_access(p_organization_id,v_active_season_id) then
    select (item->>'id')::uuid into v_active_season_id from jsonb_array_elements(v_seasons) item limit 1;
    v_active_tournament_id := null;
  end if;
  if v_active_tournament_id is not null and not exists (
    select 1 from jsonb_array_elements(v_tournaments) item
    where (item->>'id')::uuid = v_active_tournament_id
  ) then v_active_tournament_id := null; end if;
  return v_payload || jsonb_build_object('seasons',v_seasons,'tournaments',v_tournaments,
    'preference',jsonb_build_object('organizationId',p_organization_id,
      'activeSeasonId',v_active_season_id,'activeTournamentId',v_active_tournament_id,
      'updatedAt',v_preference->'updatedAt'));
end;
$$;

revoke all on function public.get_tournament_competition_context_organization_legacy(uuid)
  from public,anon,authenticated;
grant execute on function public.get_tournament_competition_context(uuid) to authenticated,service_role;

-- Reproject plan administration usage from assignments, not organization-wide
-- unique users, and require assignment/owner access to see a season plan.
create or replace function public.get_effective_tournament_season_entitlements(
  p_organization_id uuid,
  p_season_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_usage integer;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='TORNEOS_AUTH_REQUIRED'; end if;
  if not public.has_tournament_season_access(p_organization_id,p_season_id) then
    raise exception using errcode='42501',message='TORNEOS_ENTITLEMENTS_FORBIDDEN';
  end if;
  v_result := public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,p_season_id,now(),false,null
  );
  select count(*)::integer into v_usage
  from public.tournament_season_member_assignments
  where organization_id=p_organization_id and season_id=p_season_id;
  return jsonb_set(v_result,'{administration,currentAdministrativeSeatUsage}',to_jsonb(v_usage),true);
end;
$$;

create or replace function public.get_effective_tournament_entitlements(
  p_organization_id uuid,
  p_tournament_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_season_id uuid; v_result jsonb; v_usage integer;
begin
  if auth.uid() is null or p_tournament_id is null then
    raise exception using errcode='42501',message='TORNEOS_ENTITLEMENTS_FORBIDDEN';
  end if;
  select season_id into v_season_id from public.tournaments
  where organization_id=p_organization_id and id=p_tournament_id;
  if v_season_id is null or not public.has_tournament_season_access(p_organization_id,v_season_id) then
    raise exception using errcode='42501',message='TORNEOS_ENTITLEMENTS_FORBIDDEN';
  end if;
  v_result := public.resolve_effective_tournament_season_entitlements_at(
    p_organization_id,v_season_id,now(),false,p_tournament_id
  );
  select count(*)::integer into v_usage from public.tournament_season_member_assignments
  where organization_id=p_organization_id and season_id=v_season_id;
  return jsonb_set(v_result,'{administration,currentAdministrativeSeatUsage}',to_jsonb(v_usage),true);
end;
$$;

-- Purchase insert defense in depth: an unassigned admin cannot buy Premium for
-- a season merely because billing.manage exists at organization role level.
create or replace function public.enforce_tournament_season_purchase_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.has_tournament_season_capability(
    new.organization_id,new.season_id,'billing.manage'
  ) then raise exception using errcode='42501',message='TORNEOS_BILLING_FORBIDDEN'; end if;
  return new;
end;
$$;
create trigger tournament_purchases_season_scope
before insert on public.tournament_purchases
for each row execute function public.enforce_tournament_season_purchase_scope();

revoke all on function public.has_tournament_season_access(uuid,uuid)
  from public,anon;
revoke all on function public.has_tournament_season_capability(uuid,uuid,text)
  from public,anon;
revoke all on function public.has_tournament_capability(uuid,uuid,text)
  from public,anon;
revoke all on function public.assign_tournament_season_member(uuid,uuid,uuid)
  from public,anon;
revoke all on function public.remove_tournament_season_member_assignment(uuid,uuid,uuid)
  from public,anon;
revoke all on function public.list_tournament_season_member_assignments(uuid,uuid)
  from public,anon;
revoke all on function public.tournament_season_member_assignment_limit()
  from public,anon,authenticated,service_role;
revoke all on function public.enforce_tournament_season_root_write_scope()
  from public,anon,authenticated,service_role;
revoke all on function public.enforce_tournament_season_purchase_scope()
  from public,anon,authenticated,service_role;

grant execute on function public.has_tournament_season_access(uuid,uuid)
  to authenticated,service_role;
grant execute on function public.has_tournament_season_capability(uuid,uuid,text)
  to authenticated,service_role;
grant execute on function public.has_tournament_capability(uuid,uuid,text)
  to authenticated,service_role;
grant execute on function public.assign_tournament_season_member(uuid,uuid,uuid)
  to authenticated,service_role;
grant execute on function public.remove_tournament_season_member_assignment(uuid,uuid,uuid)
  to authenticated,service_role;
grant execute on function public.list_tournament_season_member_assignments(uuid,uuid)
  to authenticated,service_role;

commit;
