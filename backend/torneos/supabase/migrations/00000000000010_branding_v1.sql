-- Arma2 Torneos — BRANDING-V1: logos and shields of the hybrid composition, stored in the isolated Torneos project.
-- Applies after 00000000000000 … 00000000000009 (no existing function body or grant is modified). Rollback (documented,
-- never automatic): backend/torneos/branding-v1/rollback/00000000000010_branding_v1.rollback.sql
--
-- Same branding contract as Core's (supabase/migrations/20260817062612_tournament_branding_assets.sql), reused as is:
-- versioned object paths `<organization>/<organizations|tournaments|teams>/<entity>/<uuid>.<jpg|png|webp>` (never a
-- URL), set_tournament_branding_reference to switch the durable reference, immutable objects, and the baseline's own
-- writer rule public.can_write_tournament_branding_object (identity-aware: private.current_identity_id()).
--
-- The one deliberate difference: the bucket is PRIVATE. Nothing is readable by URL; the gateway hands out short-lived
-- signed URLs, signing in one batch per response only the paths that a publication-gated projection returned, and
-- storage RLS checks publication again for every signature:
--   * anon may read (and so sign) exactly the CURRENT logo of a tournament or organization with a published public
--     page (same gates as get_public_tournament_page) and the shields the published fixture shows (participant
--     snapshots, active or withdrawn) — an old version, a draft, an unlisted entity or another file never;
--   * an authenticated identity may also read what it may write (so the upload field shows the current asset) and,
--     as an active responsible of a live entry, the current shield of its team and the logos of its tournament.
-- Storage verifies the bridge tokens like PostgREST does (hosted: Third-Party Auth with the bridge JWKS), and runs
-- these policies with the token's claims, so private.current_identity_id() is the same identity the RPCs see.
BEGIN;

DO $pre$
BEGIN
  IF to_regprocedure('public.can_write_tournament_branding_object(text)') IS NULL
    OR to_regprocedure('public.is_tournament_branding_path(text,text)') IS NULL
    OR to_regprocedure('public.set_tournament_branding_reference(uuid,text,uuid,text)') IS NULL
    OR to_regprocedure('public.get_tournament_branding_context(uuid,uuid)') IS NULL
    OR to_regclass('public.tournament_public_pages') IS NULL
    OR to_regclass('public.tournament_competition_participants') IS NULL
    OR to_regclass('public.tournament_catalog_listings') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_BRANDING_V1_PRECONDITION_FAILED: 00000000000009 is not in force';
  END IF;
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_BRANDING_V1_PRECONDITION_FAILED: the project has no Storage schema';
  END IF;
END $pre$;

-- ============================================================================================ read rules

-- The current branding of a published public page, with the same gates as get_public_tournament_page: published page,
-- tournament in registration/scheduled/active/completed, active organization, non-archived season.
create or replace function public.is_public_tournament_branding_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_tournament_branding_path(p_name) and (
    exists (
      select 1
      from public.tournament_public_pages page
      join public.tournaments tournament
        on tournament.id = page.tournament_id
       and tournament.organization_id = page.organization_id
       and tournament.status in ('registration', 'scheduled', 'active', 'completed')
      join public.tournament_organizations organization
        on organization.id = page.organization_id
       and organization.status = 'active'
      join public.tournament_seasons season
        on season.id = tournament.season_id
       and season.organization_id = tournament.organization_id
       and season.status <> 'archived'
      where page.status = 'published'
        and (
          (split_part(p_name, '/', 2) = 'tournaments'
            and tournament.id = split_part(p_name, '/', 3)::uuid
            and tournament.logo_path = p_name)
          or (split_part(p_name, '/', 2) = 'organizations'
            and organization.id = split_part(p_name, '/', 3)::uuid
            and organization.logo_path = p_name)
          or (split_part(p_name, '/', 2) = 'teams'
            and exists (
              select 1
              from public.tournament_fixture_versions fixture
              join public.tournament_competition_participants participant
                on participant.participant_set_id = fixture.participant_set_id
              where fixture.tournament_id = tournament.id
                and fixture.status = 'published'
                and participant.team_entry_id = split_part(p_name, '/', 3)::uuid
                and participant.status in ('active', 'withdrawn')
                and participant.snapshot_shield_path = p_name))
        )
    )
  );
$$;

-- What an identity may read: anything public; what it may write (its organization's assets as a manager, a team's
-- shield where the tournament's visual policy lets its responsibles manage it); and, as an active responsible of a live
-- entry (captain, delegate, assistant), the CURRENT shield of that team and the current logos of its tournament and
-- organization. Reading never widens writing. Never another organization's draft, never an old version.
create or replace function public.can_read_tournament_branding_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_public_tournament_branding_object(p_name)
    or (private.current_identity_id() is not null and (
      public.can_write_tournament_branding_object(p_name)
      or (public.is_tournament_branding_path(p_name) and exists (
        select 1
        from public.tournament_team_managers manager
        join public.tournament_team_entries entry
          on entry.id = manager.team_entry_id
         and entry.organization_id = manager.organization_id
         and entry.status not in ('rejected', 'withdrawn', 'archived')
        join public.tournaments tournament
          on tournament.id = entry.tournament_id
         and tournament.organization_id = entry.organization_id
        join public.tournament_organizations organization
          on organization.id = entry.organization_id
        where manager.user_id = private.current_identity_id()
          and manager.status = 'active'
          and entry.organization_id = split_part(p_name, '/', 1)::uuid
          and (
            (split_part(p_name, '/', 2) = 'teams' and entry.id = split_part(p_name, '/', 3)::uuid and entry.shield_path = p_name)
            or (split_part(p_name, '/', 2) = 'tournaments' and tournament.id = split_part(p_name, '/', 3)::uuid
              and tournament.logo_path = p_name)
            or (split_part(p_name, '/', 2) = 'organizations' and organization.id = split_part(p_name, '/', 3)::uuid
              and organization.logo_path = p_name)
          )
      ))
    ));
$$;

revoke all on function public.is_public_tournament_branding_object(text) from public;
grant execute on function public.is_public_tournament_branding_object(text) to anon, authenticated, service_role;
revoke all on function public.can_read_tournament_branding_object(text) from public;
grant execute on function public.can_read_tournament_branding_object(text) to authenticated, service_role;

-- ============================================================================================ bucket + policies

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tournament-branding', 'tournament-branding', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tournament_branding_select_public on storage.objects;
drop policy if exists tournament_branding_select_authorized on storage.objects;
drop policy if exists tournament_branding_insert_authorized on storage.objects;
drop policy if exists tournament_branding_update_denied on storage.objects;
drop policy if exists tournament_branding_delete_authorized on storage.objects;

create policy tournament_branding_select_public
on storage.objects for select
to anon
using (bucket_id = 'tournament-branding' and public.is_public_tournament_branding_object(name));

-- Also the matching SELECT for DELETE: storage returns the removed row (see Core's policy note).
create policy tournament_branding_select_authorized
on storage.objects for select
to authenticated
using (bucket_id = 'tournament-branding' and public.can_read_tournament_branding_object(name));

create policy tournament_branding_insert_authorized
on storage.objects for insert
to authenticated
with check (bucket_id = 'tournament-branding' and public.can_write_tournament_branding_object(name));

-- Assets are immutable: replacing means a new UUID path, switching the reference, then deleting the previous object.
create policy tournament_branding_update_denied
on storage.objects for update
to authenticated
using (false)
with check (false);

create policy tournament_branding_delete_authorized
on storage.objects for delete
to authenticated
using (bucket_id = 'tournament-branding' and public.can_write_tournament_branding_object(name));

-- ============================================================================================ postconditions
DO $post$
BEGIN
  IF (select public from storage.buckets where id = 'tournament-branding') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TORNEOS_BRANDING_V1_POSTCONDITION_FAILED: the branding bucket must be private';
  END IF;
  IF (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'tournament_branding_%') <> 5 THEN
    RAISE EXCEPTION 'TORNEOS_BRANDING_V1_POSTCONDITION_FAILED: branding policies';
  END IF;
  IF has_function_privilege('anon', 'public.can_read_tournament_branding_object(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TORNEOS_BRANDING_V1_POSTCONDITION_FAILED: anon must not run the identity read rule';
  END IF;
END $post$;

COMMIT;
