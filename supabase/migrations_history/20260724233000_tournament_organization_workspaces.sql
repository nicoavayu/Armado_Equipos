-- Arma2 Torneos: isolated organization workspaces.
-- This migration is intended for Supabase local and the dedicated Torneos staging project.
-- It must not be applied to the Arma2 production project during this phase.

create extension if not exists pgcrypto;

create table public.tournament_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  logo_path text,
  status text not null default 'active',
  created_by uuid not null references auth.users(id) on delete restrict,
  creation_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tournament_organizations_name_check
    check (
      name = btrim(name)
      and char_length(name) between 3 and 80
    ),
  constraint tournament_organizations_slug_check
    check (
      slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'
      and char_length(slug) between 3 and 48
    ),
  constraint tournament_organizations_status_check
    check (status in ('active', 'archived')),
  constraint tournament_organizations_archive_state_check
    check (
      (status = 'active' and archived_at is null)
      or (status = 'archived' and archived_at is not null)
    ),
  constraint tournament_organizations_logo_path_check
    check (
      logo_path is null
      or (
        char_length(logo_path) between 1 and 512
        and logo_path ~ '^[a-zA-Z0-9][a-zA-Z0-9._/-]*$'
        and logo_path !~ '(^|/)\.{1,2}(/|$)'
        and logo_path !~ '//'
      )
    ),
  constraint tournament_organizations_slug_unique unique (slug),
  constraint tournament_organizations_creation_unique unique (created_by, creation_key)
);

create table public.tournament_organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.tournament_organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null,
  constraint tournament_organization_members_role_check
    check (role in ('owner', 'admin', 'collaborator')),
  constraint tournament_organization_members_status_check
    check (status in ('active', 'suspended', 'removed')),
  constraint tournament_organization_members_unique
    unique (organization_id, user_id)
);

create unique index tournament_organization_one_active_owner_idx
  on public.tournament_organization_members (organization_id)
  where role = 'owner' and status = 'active';

create index tournament_organization_members_user_active_idx
  on public.tournament_organization_members (user_id, organization_id)
  where status = 'active';

create index tournament_organization_members_org_status_idx
  on public.tournament_organization_members (organization_id, status);

create table public.user_workspace_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_type text not null default 'personal',
  active_organization_id uuid
    references public.tournament_organizations(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint user_workspace_preferences_type_check
    check (workspace_type in ('personal', 'tournament_organization')),
  constraint user_workspace_preferences_context_check
    check (
      (workspace_type = 'personal' and active_organization_id is null)
      or (
        workspace_type = 'tournament_organization'
        and active_organization_id is not null
      )
    )
);

create index user_workspace_preferences_active_org_idx
  on public.user_workspace_preferences (active_organization_id)
  where active_organization_id is not null;

create or replace function public.normalize_tournament_organization_slug(p_value text)
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
      'workspace.manage'
    ]::text[]
    when 'admin' then array[
      'organization.read',
      'organization.update',
      'members.read',
      'members.invite',
      'members.update_role',
      'members.remove',
      'workspace.access',
      'workspace.manage'
    ]::text[]
    when 'collaborator' then array[
      'organization.read',
      'members.read',
      'workspace.access'
    ]::text[]
    else array[]::text[]
  end;
$$;

create or replace function public.is_tournament_organization_member(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournament_organization_members membership
    join public.tournament_organizations organization
      on organization.id = membership.organization_id
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and organization.status = 'active'
  );
$$;

create or replace function public.has_tournament_organization_capability(
  p_organization_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tournament_organization_members membership
    join public.tournament_organizations organization
      on organization.id = membership.organization_id
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and organization.status = 'active'
      and p_capability = any(public.tournament_role_capabilities(membership.role))
  );
$$;

create or replace function public.touch_tournament_workspace_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tournament_organizations_touch_updated_at
before update on public.tournament_organizations
for each row execute function public.touch_tournament_workspace_updated_at();

create trigger tournament_organization_members_touch_updated_at
before update on public.tournament_organization_members
for each row execute function public.touch_tournament_workspace_updated_at();

create trigger user_workspace_preferences_touch_updated_at
before update on public.user_workspace_preferences
for each row execute function public.touch_tournament_workspace_updated_at();

create or replace function public.protect_tournament_organization_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner' and old.status = 'active' then
    if tg_op = 'DELETE' then
      raise exception using
        errcode = '23514',
        message = 'TORNEOS_ACTIVE_OWNER_REQUIRED';
    end if;

    if new.organization_id is distinct from old.organization_id
      or new.user_id is distinct from old.user_id
      or new.role is distinct from old.role
      or new.status is distinct from old.status
    then
      raise exception using
        errcode = '23514',
        message = 'TORNEOS_ACTIVE_OWNER_REQUIRED';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger tournament_organization_members_protect_owner
before update or delete on public.tournament_organization_members
for each row execute function public.protect_tournament_organization_owner();

alter table public.tournament_organizations enable row level security;
alter table public.tournament_organization_members enable row level security;
alter table public.user_workspace_preferences enable row level security;

create policy tournament_organizations_select_member
on public.tournament_organizations
for select
to authenticated
using (public.is_tournament_organization_member(id));

create policy tournament_organization_members_select_member
on public.tournament_organization_members
for select
to authenticated
using (
  public.has_tournament_organization_capability(
    organization_id,
    'members.read'
  )
);

create policy user_workspace_preferences_select_own
on public.user_workspace_preferences
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.create_tournament_organization(
  p_name text,
  p_slug text,
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
  v_slug text := public.normalize_tournament_organization_slug(p_slug);
  v_organization public.tournament_organizations%rowtype;
  v_membership public.tournament_organization_members%rowtype;
  v_created_recently integer;
  v_constraint_name text;
  v_reserved_slugs constant text[] := array[
    'admin', 'api', 'app', 'auth', 'login', 'logout', 'profile',
    'torneos', 'tournaments', 'settings', 'support', 'www'
  ];
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'TORNEOS_AUTH_REQUIRED';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'TORNEOS_IDEMPOTENCY_REQUIRED';
  end if;

  if char_length(v_name) not between 3 and 80 then
    raise exception using
      errcode = '22023',
      message = 'TORNEOS_INVALID_NAME';
  end if;

  if char_length(v_slug) not between 3 and 48
    or v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'
    or v_slug = any(v_reserved_slugs)
  then
    raise exception using
      errcode = '22023',
      message = 'TORNEOS_INVALID_SLUG';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text, 0)
  );

  select organization.*
  into v_organization
  from public.tournament_organizations organization
  where organization.created_by = v_user_id
    and organization.creation_key = p_idempotency_key;

  if v_organization.id is null then
    select count(*)
    into v_created_recently
    from public.tournament_organizations organization
    where organization.created_by = v_user_id
      and organization.created_at > now() - interval '10 minutes';

    if v_created_recently >= 5 then
      raise exception using
        errcode = 'P0001',
        message = 'TORNEOS_CREATION_RATE_LIMITED';
    end if;

    begin
      insert into public.tournament_organizations (
        name,
        slug,
        status,
        created_by,
        creation_key
      )
      values (
        v_name,
        v_slug,
        'active',
        v_user_id,
        p_idempotency_key
      )
      returning * into v_organization;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        if v_constraint_name = 'tournament_organizations_slug_unique' then
          raise exception using
            errcode = '23505',
            message = 'TORNEOS_SLUG_TAKEN';
        elsif v_constraint_name = 'tournament_organizations_creation_unique' then
          select organization.*
          into v_organization
          from public.tournament_organizations organization
          where organization.created_by = v_user_id
            and organization.creation_key = p_idempotency_key;
          if v_organization.id is null then
            raise;
          end if;
        else
          raise;
        end if;
    end;

    if not exists (
      select 1
      from public.tournament_organization_members membership
      where membership.organization_id = v_organization.id
        and membership.user_id = v_user_id
    ) then
      insert into public.tournament_organization_members (
        organization_id,
        user_id,
        role,
        status,
        joined_at
      )
      values (
        v_organization.id,
        v_user_id,
        'owner',
        'active',
        now()
      )
      returning * into v_membership;
    end if;
  end if;

  if v_membership.id is null then
    select membership.*
    into v_membership
    from public.tournament_organization_members membership
    where membership.organization_id = v_organization.id
      and membership.user_id = v_user_id
      and membership.status = 'active';
  end if;

  if v_membership.id is null
    or v_membership.role <> 'owner'
    or v_membership.status <> 'active'
  then
    raise exception using
      errcode = '23514',
      message = 'TORNEOS_ACTIVE_OWNER_REQUIRED';
  end if;

  insert into public.user_workspace_preferences (
    user_id,
    workspace_type,
    active_organization_id
  )
  values (
    v_user_id,
    'tournament_organization',
    v_organization.id
  )
  on conflict (user_id) do update
  set workspace_type = excluded.workspace_type,
      active_organization_id = excluded.active_organization_id;

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_organization.id,
      'name', v_organization.name,
      'slug', v_organization.slug,
      'logoPath', v_organization.logo_path,
      'status', v_organization.status,
      'createdAt', v_organization.created_at
    ),
    'membership', jsonb_build_object(
      'role', v_membership.role,
      'status', v_membership.status,
      'joinedAt', v_membership.joined_at,
      'capabilities', to_jsonb(
        public.tournament_role_capabilities(v_membership.role)
      )
    ),
    'preference', jsonb_build_object(
      'workspaceType', 'tournament_organization',
      'activeOrganizationId', v_organization.id
    )
  );
end;
$$;

create or replace function public.is_tournament_organization_slug_available(
  p_slug text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_slug text := public.normalize_tournament_organization_slug(p_slug);
  v_reserved_slugs constant text[] := array[
    'admin', 'api', 'app', 'auth', 'login', 'logout', 'profile',
    'torneos', 'tournaments', 'settings', 'support', 'www'
  ];
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'TORNEOS_AUTH_REQUIRED';
  end if;

  if char_length(v_slug) not between 3 and 48
    or v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'
    or v_slug = any(v_reserved_slugs)
  then
    return false;
  end if;

  return not exists (
    select 1
    from public.tournament_organizations organization
    where organization.slug = v_slug
  );
end;
$$;

create or replace function public.set_tournament_workspace_preference(
  p_workspace_type text,
  p_organization_id uuid default null
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
    raise exception using
      errcode = '42501',
      message = 'TORNEOS_AUTH_REQUIRED';
  end if;

  if p_workspace_type = 'personal' then
    if p_organization_id is not null then
      raise exception using
        errcode = '22023',
        message = 'TORNEOS_INVALID_WORKSPACE';
    end if;
  elsif p_workspace_type = 'tournament_organization' then
    if p_organization_id is null
      or not public.has_tournament_organization_capability(
        p_organization_id,
        'workspace.access'
      )
    then
      raise exception using
        errcode = '42501',
        message = 'TORNEOS_WORKSPACE_FORBIDDEN';
    end if;
  else
    raise exception using
      errcode = '22023',
      message = 'TORNEOS_INVALID_WORKSPACE';
  end if;

  insert into public.user_workspace_preferences (
    user_id,
    workspace_type,
    active_organization_id
  )
  values (
    v_user_id,
    p_workspace_type,
    p_organization_id
  )
  on conflict (user_id) do update
  set workspace_type = excluded.workspace_type,
      active_organization_id = excluded.active_organization_id;

  return jsonb_build_object(
    'workspaceType', p_workspace_type,
    'activeOrganizationId', p_organization_id
  );
end;
$$;

create or replace function public.get_tournament_workspace_context()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_preference public.user_workspace_preferences%rowtype;
  v_organizations jsonb;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'TORNEOS_AUTH_REQUIRED';
  end if;

  select preference.*
  into v_preference
  from public.user_workspace_preferences preference
  where preference.user_id = v_user_id;

  if v_preference.user_id is null then
    insert into public.user_workspace_preferences (
      user_id,
      workspace_type,
      active_organization_id
    )
    values (v_user_id, 'personal', null)
    on conflict (user_id) do nothing
    returning * into v_preference;

    if v_preference.user_id is null then
      select preference.*
      into v_preference
      from public.user_workspace_preferences preference
      where preference.user_id = v_user_id;
    end if;
  elsif v_preference.workspace_type = 'tournament_organization'
    and not public.has_tournament_organization_capability(
      v_preference.active_organization_id,
      'workspace.access'
    )
  then
    update public.user_workspace_preferences
    set workspace_type = 'personal',
        active_organization_id = null
    where user_id = v_user_id
    returning * into v_preference;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', organization.id,
        'name', organization.name,
        'slug', organization.slug,
        'logoPath', organization.logo_path,
        'status', organization.status,
        'createdAt', organization.created_at,
        'role', membership.role,
        'membershipStatus', membership.status,
        'joinedAt', membership.joined_at,
        'capabilities', to_jsonb(
          public.tournament_role_capabilities(membership.role)
        )
      )
      order by lower(organization.name), organization.id
    ),
    '[]'::jsonb
  )
  into v_organizations
  from public.tournament_organization_members membership
  join public.tournament_organizations organization
    on organization.id = membership.organization_id
  where membership.user_id = v_user_id
    and membership.status = 'active'
    and organization.status = 'active';

  return jsonb_build_object(
    'preference', jsonb_build_object(
      'workspaceType', v_preference.workspace_type,
      'activeOrganizationId', v_preference.active_organization_id,
      'updatedAt', v_preference.updated_at
    ),
    'organizations', v_organizations
  );
end;
$$;

create or replace function public.update_tournament_organization(
  p_organization_id uuid,
  p_name text default null,
  p_slug text default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_slug text;
  v_role text;
  v_organization public.tournament_organizations%rowtype;
  v_reserved_slugs constant text[] := array[
    'admin', 'api', 'app', 'auth', 'login', 'logout', 'profile',
    'torneos', 'tournaments', 'settings', 'support', 'www'
  ];
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'TORNEOS_AUTH_REQUIRED';
  end if;

  if not public.has_tournament_organization_capability(
    p_organization_id,
    'organization.update'
  ) then
    raise exception using
      errcode = '42501',
      message = 'TORNEOS_ORGANIZATION_FORBIDDEN';
  end if;

  select membership.role
  into v_role
  from public.tournament_organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_user_id
    and membership.status = 'active';

  select organization.*
  into v_organization
  from public.tournament_organizations organization
  where organization.id = p_organization_id
  for update;

  if v_organization.id is null then
    raise exception using
      errcode = '42501',
      message = 'TORNEOS_ORGANIZATION_FORBIDDEN';
  end if;

  v_name := case
    when p_name is null then v_organization.name
    else btrim(p_name)
  end;
  v_slug := case
    when p_slug is null then v_organization.slug
    else public.normalize_tournament_organization_slug(p_slug)
  end;

  if char_length(v_name) not between 3 and 80 then
    raise exception using
      errcode = '22023',
      message = 'TORNEOS_INVALID_NAME';
  end if;

  if char_length(v_slug) not between 3 and 48
    or v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'
    or v_slug = any(v_reserved_slugs)
  then
    raise exception using
      errcode = '22023',
      message = 'TORNEOS_INVALID_SLUG';
  end if;

  if p_status is not null and p_status not in ('active', 'archived') then
    raise exception using
      errcode = '22023',
      message = 'TORNEOS_INVALID_STATUS';
  end if;

  if p_status is not null
    and p_status is distinct from v_organization.status
    and not public.has_tournament_organization_capability(
      p_organization_id,
      'organization.archive'
    )
  then
    raise exception using
      errcode = '42501',
      message = 'TORNEOS_ARCHIVE_FORBIDDEN';
  end if;

  begin
    update public.tournament_organizations
    set name = v_name,
        slug = v_slug,
        status = coalesce(p_status, status),
        archived_at = case
          when coalesce(p_status, status) = 'archived'
            then coalesce(archived_at, now())
          else null
        end
    where id = p_organization_id
    returning * into v_organization;
  exception
    when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'TORNEOS_SLUG_TAKEN';
  end;

  if v_organization.status = 'archived' then
    update public.user_workspace_preferences
    set workspace_type = 'personal',
        active_organization_id = null
    where active_organization_id = v_organization.id;
  end if;

  return jsonb_build_object(
    'id', v_organization.id,
    'name', v_organization.name,
    'slug', v_organization.slug,
    'logoPath', v_organization.logo_path,
    'status', v_organization.status,
    'createdAt', v_organization.created_at,
    'role', v_role,
    'capabilities', to_jsonb(public.tournament_role_capabilities(v_role))
  );
end;
$$;

revoke all on table public.tournament_organizations from anon, authenticated;
revoke all on table public.tournament_organization_members from anon, authenticated;
revoke all on table public.user_workspace_preferences from anon, authenticated;

grant select on table public.tournament_organizations to authenticated;
grant select on table public.tournament_organization_members to authenticated;
grant select on table public.user_workspace_preferences to authenticated;

revoke all on function public.normalize_tournament_organization_slug(text) from public;
revoke all on function public.tournament_role_capabilities(text) from public;
revoke all on function public.is_tournament_organization_member(uuid) from public;
revoke all on function public.has_tournament_organization_capability(uuid, text) from public;
revoke all on function public.touch_tournament_workspace_updated_at() from public;
revoke all on function public.protect_tournament_organization_owner() from public;
revoke all on function public.create_tournament_organization(text, text, uuid) from public;
revoke all on function public.is_tournament_organization_slug_available(text) from public;
revoke all on function public.set_tournament_workspace_preference(text, uuid) from public;
revoke all on function public.get_tournament_workspace_context() from public;
revoke all on function public.update_tournament_organization(uuid, text, text, text) from public;

grant execute on function public.normalize_tournament_organization_slug(text)
  to authenticated;
grant execute on function public.tournament_role_capabilities(text)
  to authenticated;
grant execute on function public.is_tournament_organization_member(uuid)
  to authenticated;
grant execute on function public.has_tournament_organization_capability(uuid, text)
  to authenticated;
grant execute on function public.create_tournament_organization(text, text, uuid)
  to authenticated;
grant execute on function public.is_tournament_organization_slug_available(text)
  to authenticated;
grant execute on function public.set_tournament_workspace_preference(text, uuid)
  to authenticated;
grant execute on function public.get_tournament_workspace_context()
  to authenticated;
grant execute on function public.update_tournament_organization(uuid, text, text, text)
  to authenticated;

comment on table public.tournament_organizations is
  'Private Arma2 Torneos organizations. Phase 2: local/staging only.';
comment on table public.tournament_organization_members is
  'Organization-scoped Torneos memberships and role presets.';
comment on table public.user_workspace_preferences is
  'Server-authoritative personal or tournament organization workspace preference.';
comment on function public.create_tournament_organization(text, text, uuid) is
  'Atomically creates an organization, its owner membership, and the active preference.';
