-- Arma2 Torneos — 0020 PREMIUM SPONSORS: an organization's sponsors (name + logo) and their authorization on a Social
-- Studio export. Spec: docs/superpowers/specs/2026-10-15-torneos-premium-sponsors-design.md (§2.1).
-- Applies after 00000000000017 (media store: private.tournament_branding_object_in_use), 00000000000018 and
-- 00000000000019 (both unchanged here). Independent of 0013 (payments): it reads the entitlement resolver only.
-- Rollback (documented, never automatic): backend/torneos/sponsors-v1/rollback/00000000000020_premium_sponsors.rollback.sql
-- Operator driver (prepared, never run without GO): backend/torneos/sponsors-v1/remote/db-0020.mjs
--
-- What it adds or changes, and nothing else:
--   * public.tournament_organization_sponsors: id, organization_id, name (trimmed, 1..60), logo_path (null, or a versioned
--     object of the EXISTING organizations kind of the same organization: <org>/organizations/<org>/<uuid>.<jpg|png|webp>,
--     so no path regex changes anywhere), sort_order (0..999), created_by, created_at, updated_at, archived_at.
--     RLS on and NO grant to any API role: reached only through the four SECURITY DEFINER RPCs below.
--   * private.tournament_sponsors_entitled(org, season, tournament): the server's single rule for the Premium capability
--     `sponsors` (tournament_entitlement_capabilities, baseline: premium only). With a season: the effective capability of
--     that season (resolve_effective_tournament_season_entitlements_at, with the tournament when given, like 0008). Without
--     one: the organization is entitled when ANY of its seasons has it — candidates are only seasons with an effective
--     plan grant (is_tournament_season_plan_grant_effective), unless the catalog ever enables `sponsors` for FREE; this is
--     exactly the resolver's own plan rule, evaluated on the few seasons that can pass. Revoked / suspended grants
--     (refund, chargeback) stop counting at once; the rows stay.
--   * Four RPCs, EXECUTE to authenticated only (never anon, PUBLIC or service_role), identity = private.current_identity_id():
--       get_tournament_organization_sponsors(org, season default null)          members of the organization (with a season:
--         that season's access); { schemaVersion, organizationId, seasonId, canManage, entitled, limits, sponsors[] }.
--         `entitled` is the organization's (no season) or that season's (with one).
--       upsert_tournament_organization_sponsor(org, sponsor|null, name, logo_path, sort_order default null)
--         organization.update + entitlement; ≤ 20 active per organization; { sponsor, previousLogoPath }.
--       archive_tournament_organization_sponsor(org, sponsor)                   organization.update only (always allowed);
--         logical (archived_at), clears logo_path; { sponsorId, archived, alreadyArchived, previousLogoPath }.
--       authorize_tournament_social_sponsors(season, tournament, theme, sponsor_ids[])   social.export on the season; theme
--         heritage|street|scoreboard|editorial (base never), ≤ 3 distinct active sponsors with a logo of the tournament's
--         organization, the season's effective `sponsors`; { authorized, …, sponsors[] } — the ONLY list an export may draw.
--     Errors (SQLSTATE → HTTP through PostgREST, body { code, message, details }): 42501 TORNEOS_AUTH_REQUIRED,
--     42501 TORNEOS_SPONSORS_FORBIDDEN, 42501 TORNEOS_SOCIAL_EXPORT_FORBIDDEN, 42501 TORNEOS_SPONSORS_PREMIUM_REQUIRED,
--     22023 TORNEOS_SPONSOR_INVALID (details: name | logo_path | sort_order | sponsor_id), 22023 TORNEOS_SOCIAL_THEME_UNKNOWN,
--     22023 TORNEOS_SPONSORS_THEME_UNSUPPORTED, 22023 TORNEOS_SPONSORS_SELECTION_INVALID, PT409 TORNEOS_SPONSOR_NOT_FOUND,
--     PT409 TORNEOS_SPONSORS_SELECTION_UNAVAILABLE, PT422 TORNEOS_SPONSOR_LIMIT_REACHED. Access is always checked first;
--     another organization's sponsor is indistinguishable from one that does not exist.
--   * private.tournament_branding_object_in_use: an active sponsor's logo_path also counts as in use (the media store
--     refuses to delete it). Same signature, ACL, owner and attributes (CREATE OR REPLACE); the 0017 body is pinned before.
-- authorize_tournament_social_export (0008) and every other function, relation and policy are untouched (proved below).
BEGIN;

CREATE TEMPORARY TABLE torneos_0020_functions (sig text PRIMARY KEY, state text NOT NULL) ON COMMIT DROP;
CREATE TEMPORARY TABLE torneos_0020_relations (rel text PRIMARY KEY, state text NOT NULL) ON COMMIT DROP;
CREATE TEMPORARY TABLE torneos_0020_counts (authenticated integer NOT NULL, anon integer NOT NULL, policies text NOT NULL) ON COMMIT DROP;

-- ============================================================================================ 1. preconditions
DO $pre$
DECLARE
  -- md5(prosrc) of what 0020 replaces (the 0017 body) and of every function the new RPCs rely on.
  v_pins constant jsonb := jsonb_build_object(
    'private.tournament_branding_object_in_use(text)', 'fd7eb865713c713c96e595f9a35ce230',
    'public.authorize_tournament_storage_objects(text,text,text[])', '27c94843c2e3a7d9f05df448f464f069',
    'public.authorize_tournament_social_export(uuid,uuid,text,text,boolean)', '85bb485891d9a2c046798f9eaa0cb649',
    'public.resolve_effective_tournament_season_entitlements_at(uuid,uuid,timestamp with time zone,boolean,uuid)', 'e0ba5e6275cfaa2642de7c5d3a355fc1',
    'public.is_tournament_season_plan_grant_effective(uuid)', 'b401f53013e850cba1a833817bc34852',
    'public.is_tournament_branding_path(text,text)', '0899fa3c013a84c2f2aaf0e06fa3a408',
    'public.can_write_tournament_branding_object(text)', '4bbd00a7740446c8ee3bb468a58ceba1',
    'public.can_read_tournament_branding_object(text)', '0f00e5b80b275819823de91227e36c05',
    'public.has_tournament_social_capability(uuid,text)', 'f7558d609734718f7131b9f9dc027a13',
    'public.has_tournament_organization_capability(uuid,text)', '2faa4bbaf76f0eb48f62d12e2f476e59',
    'public.is_tournament_organization_member(uuid)', 'c49854fa07fe2d288011cd868bb777bf',
    'public.has_tournament_season_access(uuid,uuid)', 'a24e268717406e5bb28fd8c303d94e9c',
    'private.current_identity_id()', '4fc320dde15823ae4e7f31c6e670f08e'
  );
  v_key text;
  v_md5 text;
BEGIN
  IF to_regclass('public.tournament_organization_sponsors') IS NOT NULL
    OR to_regprocedure('public.get_tournament_organization_sponsors(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.upsert_tournament_organization_sponsor(uuid,uuid,text,text,integer)') IS NOT NULL
    OR to_regprocedure('public.archive_tournament_organization_sponsor(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.authorize_tournament_social_sponsors(uuid,uuid,text,uuid[])') IS NOT NULL
    OR to_regprocedure('private.tournament_sponsors_entitled(uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'TORNEOS_0020_PRECONDITION_FAILED: already applied';
  END IF;
  IF to_regprocedure('private.tournament_season_media_open(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_0020_PRECONDITION_FAILED: 00000000000018 is not in force';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_pins) LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_key);
    IF v_md5 IS DISTINCT FROM v_pins->>v_key THEN
      RAISE EXCEPTION 'TORNEOS_0020_PRECONDITION_FAILED: % is not the expected body (%)', v_key, v_md5;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'private.tournament_branding_object_in_use(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.tournament_branding_object_in_use(text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'private.tournament_branding_object_in_use(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TORNEOS_0020_PRECONDITION_FAILED: tournament_branding_object_in_use is reachable by an API role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_entitlement_capabilities
                 WHERE capability = 'sponsors' AND premium_enabled AND NOT free_enabled) THEN
    RAISE EXCEPTION 'TORNEOS_0020_PRECONDITION_FAILED: the sponsors capability is not PREMIUM-only';
  END IF;
  IF (SELECT public FROM storage.buckets WHERE id = 'tournament-branding') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TORNEOS_0020_PRECONDITION_FAILED: the tournament-branding bucket must exist and be private';
  END IF;
  -- "Nothing else moved": every function (but the one replaced) and relation of public/private, and every policy.
  INSERT INTO torneos_0020_functions
  SELECT p.oid::regprocedure::text, concat_ws('|', md5(p.prosrc), coalesce(p.proacl::text, '-'), pg_get_userbyid(p.proowner),
         p.prosecdef, p.provolatile, coalesce(p.proconfig::text, '-'), pg_get_function_result(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'private') AND p.oid <> 'private.tournament_branding_object_in_use(text)'::regprocedure;
  INSERT INTO torneos_0020_relations
  SELECT n.nspname || '.' || c.relname, concat_ws('|', c.relkind, c.relrowsecurity, coalesce(c.relacl::text, '-'), pg_get_userbyid(c.relowner))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'private', 'storage') AND c.relkind IN ('r', 'v', 'm', 'p', 'f', 'S');
  INSERT INTO torneos_0020_counts
  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')),
         (SELECT md5(coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '-')
            || ':' || coalesce(with_check, '-') || ':' || roles::text, ',' ORDER BY schemaname, tablename, policyname), ''))
          FROM pg_policies WHERE schemaname IN ('public', 'private', 'storage'))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
END $pre$;

-- ============================================================================================ 2. table
create table public.tournament_organization_sponsors (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.tournament_organizations(id) on delete cascade,
  name text not null,
  logo_path text,
  sort_order integer not null default 0,
  created_by uuid references public.torneos_identity(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tournament_organization_sponsors_name_check check (
    name = btrim(name) and char_length(name) between 1 and 60 and name !~ '[[:cntrl:]]'
  ),
  constraint tournament_organization_sponsors_logo_path_check check (
    logo_path is null or (
      public.is_tournament_branding_path(logo_path, 'organizations')
      and split_part(logo_path, '/', 1) = organization_id::text
      and split_part(logo_path, '/', 3) = organization_id::text
    )
  ),
  constraint tournament_organization_sponsors_sort_order_check check (sort_order between 0 and 999)
);
create index tournament_organization_sponsors_active_idx
  on public.tournament_organization_sponsors (organization_id, sort_order) where archived_at is null;
create index tournament_organization_sponsors_logo_idx
  on public.tournament_organization_sponsors (logo_path) where archived_at is null and logo_path is not null;
comment on table public.tournament_organization_sponsors is
  'Premium sponsors of an organization (0020). Reached only through SECURITY DEFINER RPCs; logos are objects of the tournament-branding bucket (organizations kind).';
alter table public.tournament_organization_sponsors enable row level security;
-- Applied as postgres (the hosted installer), whose default privileges grant every new table to the API roles.
revoke all on table public.tournament_organization_sponsors from public, anon, authenticated, service_role;

-- ============================================================================================ 3. entitlement rule
create function private.tournament_sponsors_entitled(p_organization_id uuid, p_season_id uuid, p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_organization_id is null then false
    when p_season_id is not null then coalesce((public.resolve_effective_tournament_season_entitlements_at(
      p_organization_id, p_season_id, now(), false, p_tournament_id)->'capabilities'->>'sponsors')::boolean, false)
    else exists (
      select 1
      from public.tournament_seasons season
      where season.organization_id = p_organization_id
        and (
          coalesce((select catalog.free_enabled from public.tournament_entitlement_capabilities catalog
                    where catalog.capability = 'sponsors'), false)
          or exists (
            select 1 from public.tournament_season_plan_grants grant_row
            where grant_row.organization_id = p_organization_id and grant_row.season_id = season.id
              and public.is_tournament_season_plan_grant_effective(grant_row.id)
          )
        )
        and coalesce((public.resolve_effective_tournament_season_entitlements_at(
          p_organization_id, season.id, now(), false, null)->'capabilities'->>'sponsors')::boolean, false)
    )
  end;
$$;
revoke all on function private.tournament_sponsors_entitled(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- ============================================================================================ 4. RPCs
create function public.get_tournament_organization_sponsors(p_organization_id uuid, p_season_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
begin
  if private.current_identity_id() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_organization_id is null or not public.is_tournament_organization_member(p_organization_id)
    or (p_season_id is not null and (
      not exists (
        select 1 from public.tournament_seasons season
        where season.organization_id = p_organization_id and season.id = p_season_id
      )
      or not public.has_tournament_season_access(p_organization_id, p_season_id))) then
    raise exception using errcode = '42501', message = 'TORNEOS_SPONSORS_FORBIDDEN';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', sponsor.id, 'name', sponsor.name, 'logoPath', sponsor.logo_path, 'sortOrder', sponsor.sort_order
    ) order by sponsor.sort_order, sponsor.created_at, sponsor.id), '[]'::jsonb)
  into v_items
  from public.tournament_organization_sponsors sponsor
  where sponsor.organization_id = p_organization_id and sponsor.archived_at is null;
  return jsonb_build_object(
    'schemaVersion', 1,
    'organizationId', p_organization_id,
    'seasonId', p_season_id,
    'canManage', public.has_tournament_organization_capability(p_organization_id, 'organization.update'),
    'entitled', private.tournament_sponsors_entitled(p_organization_id, p_season_id, null),
    'limits', jsonb_build_object('maxActive', 20, 'maxPerExport', 3, 'nameMaxLength', 60),
    'sponsors', v_items
  );
end;
$$;

create function public.upsert_tournament_organization_sponsor(p_organization_id uuid, p_sponsor_id uuid, p_name text,
  p_logo_path text, p_sort_order integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_identity_id();
  v_name text := btrim(p_name);
  v_row public.tournament_organization_sponsors%rowtype;
  v_previous text;
  v_active integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_organization_id is null
    or not public.has_tournament_organization_capability(p_organization_id, 'organization.update') then
    raise exception using errcode = '42501', message = 'TORNEOS_SPONSORS_FORBIDDEN';
  end if;
  if not private.tournament_sponsors_entitled(p_organization_id, null, null) then
    raise exception using errcode = '42501', message = 'TORNEOS_SPONSORS_PREMIUM_REQUIRED';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 60 or v_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'TORNEOS_SPONSOR_INVALID', detail = 'name';
  end if;
  if p_logo_path is not null and not (
    public.is_tournament_branding_path(p_logo_path, 'organizations')
    and split_part(p_logo_path, '/', 1) = p_organization_id::text
    and split_part(p_logo_path, '/', 3) = p_organization_id::text
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_SPONSOR_INVALID', detail = 'logo_path';
  end if;
  if p_sort_order is not null and p_sort_order not between 0 and 999 then
    raise exception using errcode = '22023', message = 'TORNEOS_SPONSOR_INVALID', detail = 'sort_order';
  end if;
  -- One writer per organization at a time: the 20-active limit cannot be raced.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tournament_organization_sponsors:' || p_organization_id::text, 20)
  );
  if p_sponsor_id is null then
    select count(*)::integer into v_active
    from public.tournament_organization_sponsors sponsor
    where sponsor.organization_id = p_organization_id and sponsor.archived_at is null;
    if v_active >= 20 then
      raise exception using errcode = 'PT422', message = 'TORNEOS_SPONSOR_LIMIT_REACHED';
    end if;
    insert into public.tournament_organization_sponsors (organization_id, name, logo_path, sort_order, created_by)
    values (p_organization_id, v_name, p_logo_path, coalesce(p_sort_order, (
      select least(coalesce(max(sponsor.sort_order) + 1, 0), 999)
      from public.tournament_organization_sponsors sponsor
      where sponsor.organization_id = p_organization_id and sponsor.archived_at is null
    )), v_uid)
    returning * into v_row;
  else
    select * into v_row
    from public.tournament_organization_sponsors sponsor
    where sponsor.id = p_sponsor_id and sponsor.organization_id = p_organization_id and sponsor.archived_at is null
    for update;
    if not found then
      raise exception using errcode = 'PT409', message = 'TORNEOS_SPONSOR_NOT_FOUND';
    end if;
    -- The replaced object, for the client to remove once it is referenced nowhere (the media store checks).
    v_previous := case when v_row.logo_path is distinct from p_logo_path then v_row.logo_path end;
    update public.tournament_organization_sponsors
    set name = v_name, logo_path = p_logo_path, sort_order = coalesce(p_sort_order, v_row.sort_order), updated_at = now()
    where id = v_row.id
    returning * into v_row;
  end if;
  return jsonb_build_object(
    'sponsor', jsonb_build_object('id', v_row.id, 'name', v_row.name, 'logoPath', v_row.logo_path, 'sortOrder', v_row.sort_order),
    'previousLogoPath', v_previous
  );
end;
$$;

create function public.archive_tournament_organization_sponsor(p_organization_id uuid, p_sponsor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.tournament_organization_sponsors%rowtype;
begin
  if private.current_identity_id() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_organization_id is null
    or not public.has_tournament_organization_capability(p_organization_id, 'organization.update') then
    raise exception using errcode = '42501', message = 'TORNEOS_SPONSORS_FORBIDDEN';
  end if;
  if p_sponsor_id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_SPONSOR_INVALID', detail = 'sponsor_id';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tournament_organization_sponsors:' || p_organization_id::text, 20)
  );
  select * into v_row
  from public.tournament_organization_sponsors sponsor
  where sponsor.id = p_sponsor_id and sponsor.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'PT409', message = 'TORNEOS_SPONSOR_NOT_FOUND';
  end if;
  if v_row.archived_at is not null then
    return jsonb_build_object('sponsorId', v_row.id, 'archived', true, 'alreadyArchived', true, 'previousLogoPath', null);
  end if;
  -- Archiving never needs Premium. The logo stops being referenced, so the client can remove the object.
  update public.tournament_organization_sponsors
  set archived_at = now(), updated_at = now(), logo_path = null
  where id = v_row.id;
  return jsonb_build_object('sponsorId', v_row.id, 'archived', true, 'alreadyArchived', false,
    'previousLogoPath', v_row.logo_path);
end;
$$;

create function public.authorize_tournament_social_sponsors(p_season_id uuid, p_tournament_id uuid, p_theme text,
  p_sponsor_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_count integer;
  v_items jsonb;
begin
  if private.current_identity_id() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select tournament.organization_id into v_organization_id
  from public.tournaments tournament
  where tournament.id = p_tournament_id and tournament.season_id = p_season_id;
  -- Same access as the export itself (0008): social.export, on a season the identity can see. Checked first.
  if v_organization_id is null
    or not public.has_tournament_season_access(v_organization_id, p_season_id)
    or not public.has_tournament_social_capability(v_organization_id, 'social.export') then
    raise exception using errcode = '42501', message = 'TORNEOS_SOCIAL_EXPORT_FORBIDDEN';
  end if;
  if p_theme is null or p_theme not in ('base', 'heritage', 'street', 'scoreboard', 'editorial') then
    raise exception using errcode = '22023', message = 'TORNEOS_SOCIAL_THEME_UNKNOWN';
  end if;
  if p_sponsor_ids is null or cardinality(p_sponsor_ids) > 3 or array_position(p_sponsor_ids, null) is not null
    or cardinality(p_sponsor_ids) <> (select count(distinct selected.id) from unnest(p_sponsor_ids) selected(id)) then
    raise exception using errcode = '22023', message = 'TORNEOS_SPONSORS_SELECTION_INVALID';
  end if;
  -- No sponsors selected: nothing to authorize (the export itself is authorize_tournament_social_export's decision).
  if cardinality(p_sponsor_ids) > 0 then
    if p_theme = 'base' then
      raise exception using errcode = '22023', message = 'TORNEOS_SPONSORS_THEME_UNSUPPORTED';
    end if;
    if not private.tournament_sponsors_entitled(v_organization_id, p_season_id, p_tournament_id) then
      raise exception using errcode = '42501', message = 'TORNEOS_SPONSORS_PREMIUM_REQUIRED';
    end if;
  end if;
  select count(sponsor.id)::integer,
    coalesce(jsonb_agg(jsonb_build_object('id', sponsor.id, 'name', sponsor.name, 'logoPath', sponsor.logo_path)
      order by selected.position) filter (where sponsor.id is not null), '[]'::jsonb)
  into v_count, v_items
  from unnest(p_sponsor_ids) with ordinality selected(id, position)
  left join public.tournament_organization_sponsors sponsor
    on sponsor.id = selected.id and sponsor.organization_id = v_organization_id
   and sponsor.archived_at is null and sponsor.logo_path is not null;
  if coalesce(v_count, 0) <> cardinality(p_sponsor_ids) then
    raise exception using errcode = 'PT409', message = 'TORNEOS_SPONSORS_SELECTION_UNAVAILABLE';
  end if;
  return jsonb_build_object(
    'authorized', true,
    'organizationId', v_organization_id,
    'seasonId', p_season_id,
    'tournamentId', p_tournament_id,
    'theme', p_theme,
    'capability', 'sponsors',
    'sponsors', v_items
  );
end;
$$;

-- Applied as postgres (the hosted installer), whose default privileges grant EXECUTE on new public functions to anon and
-- service_role: revoked explicitly; only an authenticated identity may call them.
revoke all on function public.get_tournament_organization_sponsors(uuid, uuid) from public, anon, service_role;
revoke all on function public.upsert_tournament_organization_sponsor(uuid, uuid, text, text, integer) from public, anon, service_role;
revoke all on function public.archive_tournament_organization_sponsor(uuid, uuid) from public, anon, service_role;
revoke all on function public.authorize_tournament_social_sponsors(uuid, uuid, text, uuid[]) from public, anon, service_role;
grant execute on function public.get_tournament_organization_sponsors(uuid, uuid) to authenticated;
grant execute on function public.upsert_tournament_organization_sponsor(uuid, uuid, text, text, integer) to authenticated;
grant execute on function public.archive_tournament_organization_sponsor(uuid, uuid) to authenticated;
grant execute on function public.authorize_tournament_social_sponsors(uuid, uuid, text, uuid[]) to authenticated;

-- ============================================================================================ 5. in use
-- The 0017 body plus active sponsors' logos. Same signature, attributes, owner and ACL (CREATE OR REPLACE).
create or replace function private.tournament_branding_object_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.tournament_organizations organization where organization.logo_path = p_name)
    or exists (select 1 from public.tournaments tournament where tournament.logo_path = p_name)
    or exists (select 1 from public.tournament_team_entries entry where entry.shield_path = p_name)
    or exists (select 1 from public.tournament_competition_participants participant
               where participant.snapshot_shield_path = p_name)
    or exists (select 1 from public.tournament_organization_sponsors sponsor
               where sponsor.logo_path = p_name and sponsor.archived_at is null);
$$;

-- ============================================================================================ 6. postconditions
DO $post$
DECLARE
  v_bodies constant jsonb := jsonb_build_object(
    'private.tournament_branding_object_in_use(text)', '8189dc2bebca6c29ca15eb6840d95c91',
    'private.tournament_sponsors_entitled(uuid,uuid,uuid)', 'b2290185d145ca7f611d32ae4ad61c72',
    'public.get_tournament_organization_sponsors(uuid,uuid)', '1da369a35b85046f46b39bd58345b760',
    'public.upsert_tournament_organization_sponsor(uuid,uuid,text,text,integer)', '3aba4c646ace22abdb7c2b5879506dcd',
    'public.archive_tournament_organization_sponsor(uuid,uuid)', '23ba6885cb807d91d669536166e9e655',
    'public.authorize_tournament_social_sponsors(uuid,uuid,text,uuid[])', 'd15f11f46d6ae896f5ecf6f3b470e5a5'
  );
  v_rpcs constant text[] := array[
    'public.get_tournament_organization_sponsors(uuid,uuid)',
    'public.upsert_tournament_organization_sponsor(uuid,uuid,text,text,integer)',
    'public.archive_tournament_organization_sponsor(uuid,uuid)',
    'public.authorize_tournament_social_sponsors(uuid,uuid,text,uuid[])'
  ];
  v_private constant text[] := array[
    'private.tournament_branding_object_in_use(text)', 'private.tournament_sponsors_entitled(uuid,uuid,uuid)'
  ];
  v_problems text[] := array[]::text[];
  v_key text;
  v_md5 text;
  v_before torneos_0020_counts%ROWTYPE;
  v_auth integer;
  v_anon integer;
  v_policies text;
  v_row record;
BEGIN
  FOR v_key IN SELECT jsonb_object_keys(v_bodies) LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_key);
    IF v_md5 IS DISTINCT FROM v_bodies->>v_key THEN
      v_problems := v_problems || format('%s body %s', v_key, v_md5);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_key) AND p.prosecdef
                   AND p.proconfig = array['search_path=""']) THEN
      v_problems := v_problems || format('%s is not SECURITY DEFINER search_path=""', v_key);
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_rpcs LOOP
    IF NOT has_function_privilege('authenticated', v_key, 'EXECUTE') OR has_function_privilege('anon', v_key, 'EXECUTE')
      OR has_function_privilege('service_role', v_key, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = to_regprocedure(v_key) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      v_problems := v_problems || format('%s must be EXECUTE for authenticated only', v_key);
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_private LOOP
    IF has_function_privilege('anon', v_key, 'EXECUTE') OR has_function_privilege('authenticated', v_key, 'EXECUTE')
      OR has_function_privilege('service_role', v_key, 'EXECUTE') THEN
      v_problems := v_problems || format('%s is reachable by an API role', v_key);
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tournament_organization_sponsors'::regclass)
    OR has_table_privilege('anon', 'public.tournament_organization_sponsors', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_table_privilege('authenticated', 'public.tournament_organization_sponsors', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_table_privilege('service_role', 'public.tournament_organization_sponsors', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tournament_organization_sponsors') THEN
    v_problems := v_problems || 'tournament_organization_sponsors must have RLS on, no policy and no API grant'::text;
  END IF;
  -- Nothing else moved: the same functions (body, ACL, owner, attributes), relations and policies, plus exactly ours.
  FOR v_row IN
    SELECT s.sig, s.state, concat_ws('|', md5(p.prosrc), coalesce(p.proacl::text, '-'), pg_get_userbyid(p.proowner),
           p.prosecdef, p.provolatile, coalesce(p.proconfig::text, '-'), pg_get_function_result(p.oid)) AS now_state
    FROM torneos_0020_functions s LEFT JOIN pg_proc p ON p.oid = to_regprocedure(s.sig)
  LOOP
    IF v_row.now_state IS DISTINCT FROM v_row.state THEN
      v_problems := v_problems || format('%s changed', v_row.sig);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'private'))
     <> (SELECT count(*) FROM torneos_0020_functions) + 6 THEN
    v_problems := v_problems || 'the set of functions changed beyond the five added'::text;
  END IF;
  FOR v_row IN
    SELECT n.nspname || '.' || c.relname AS rel,
           concat_ws('|', c.relkind, c.relrowsecurity, coalesce(c.relacl::text, '-'), pg_get_userbyid(c.relowner)) AS now_state,
           r.state
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    FULL JOIN torneos_0020_relations r ON r.rel = n.nspname || '.' || c.relname
    WHERE (n.nspname IN ('public', 'private', 'storage') AND c.relkind IN ('r', 'v', 'm', 'p', 'f', 'S')) OR c.oid IS NULL
  LOOP
    IF v_row.rel IS DISTINCT FROM 'public.tournament_organization_sponsors' AND v_row.now_state IS DISTINCT FROM v_row.state THEN
      v_problems := v_problems || format('relation %s changed', coalesce(v_row.rel, '?'));
    END IF;
  END LOOP;
  SELECT * INTO v_before FROM torneos_0020_counts;
  SELECT count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))
    INTO v_auth, v_anon
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
  IF v_auth <> v_before.authenticated + 4 OR v_anon <> v_before.anon THEN
    v_problems := v_problems || format('public ACL counts authenticated %s→%s anon %s→%s (expected +4 / +0)',
      v_before.authenticated, v_auth, v_before.anon, v_anon);
  END IF;
  SELECT md5(coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '-')
           || ':' || coalesce(with_check, '-') || ':' || roles::text, ',' ORDER BY schemaname, tablename, policyname), ''))
    INTO v_policies FROM pg_policies WHERE schemaname IN ('public', 'private', 'storage');
  IF v_policies IS DISTINCT FROM v_before.policies THEN
    v_problems := v_problems || 'policies changed'::text;
  END IF;
  IF (SELECT public FROM storage.buckets WHERE id = 'tournament-branding') IS DISTINCT FROM false THEN
    v_problems := v_problems || 'the tournament-branding bucket must stay private'::text;
  END IF;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'TORNEOS_0020_POSTCONDITION_FAILED: %', array_to_string(v_problems, '; ');
  END IF;
END $post$;

COMMIT;
