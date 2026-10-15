-- PREMIUM SPONSORS 0020 rollback: removes exactly what 00000000000020 added and puts back the 0017 body of
-- private.tournament_branding_object_in_use (byte for byte, pinned by md5 below). No other function, policy, bucket or
-- grant changes. Run only with the frontend's sponsors UI off (the four RPCs disappear; the gateway answers their calls
-- with the database's "function not found").
--
-- Sponsors are user data. While public.tournament_organization_sponsors holds ANY row (active or archived) this file
-- refuses (TORNEOS_0020_ROLLBACK_REFUSED) and changes nothing. The only override, for an operator who has decided to
-- discard them, is a session setting made in the SAME psql session before this file runs:
--     SET torneos.sponsors_rollback_force = 'DISCARD SPONSOR ROWS';
-- (db-0020.mjs does that only with `rollback-0020 --force` and its own phrase). The logo objects stay in the bucket:
-- after the rollback nothing references them, so they are removable like any other unreferenced branding object.
BEGIN;
DO $pre$
DECLARE
  v_md5 text;
  v_rows bigint;
BEGIN
  IF to_regclass('public.tournament_organization_sponsors') IS NULL
    OR to_regprocedure('public.get_tournament_organization_sponsors(uuid,uuid)') IS NULL
    OR to_regprocedure('public.upsert_tournament_organization_sponsor(uuid,uuid,text,text,integer)') IS NULL
    OR to_regprocedure('public.archive_tournament_organization_sponsor(uuid,uuid)') IS NULL
    OR to_regprocedure('public.authorize_tournament_social_sponsors(uuid,uuid,text,uuid[])') IS NULL
    OR to_regprocedure('private.tournament_sponsors_entitled(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_0020_ROLLBACK_PRECONDITION_FAILED: 00000000000020 is not applied';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'private.tournament_branding_object_in_use(text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '8189dc2bebca6c29ca15eb6840d95c91' THEN
    RAISE EXCEPTION 'TORNEOS_0020_ROLLBACK_PRECONDITION_FAILED: tournament_branding_object_in_use is not the 0020 body (%)', v_md5;
  END IF;
  SELECT count(*) INTO v_rows FROM public.tournament_organization_sponsors;
  IF v_rows > 0 AND coalesce(current_setting('torneos.sponsors_rollback_force', true), '') <> 'DISCARD SPONSOR ROWS' THEN
    RAISE EXCEPTION 'TORNEOS_0020_ROLLBACK_REFUSED: % sponsor rows exist (set torneos.sponsors_rollback_force to discard them)', v_rows;
  END IF;
END
$pre$;

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
               where participant.snapshot_shield_path = p_name);
$$;

drop function public.authorize_tournament_social_sponsors(uuid, uuid, text, uuid[]);
drop function public.archive_tournament_organization_sponsor(uuid, uuid);
drop function public.upsert_tournament_organization_sponsor(uuid, uuid, text, text, integer);
drop function public.get_tournament_organization_sponsors(uuid, uuid);
drop function private.tournament_sponsors_entitled(uuid, uuid, uuid);
drop table public.tournament_organization_sponsors;

DO $post$
BEGIN
  IF to_regclass('public.tournament_organization_sponsors') IS NOT NULL
    OR to_regprocedure('public.get_tournament_organization_sponsors(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.upsert_tournament_organization_sponsor(uuid,uuid,text,text,integer)') IS NOT NULL
    OR to_regprocedure('public.archive_tournament_organization_sponsor(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.authorize_tournament_social_sponsors(uuid,uuid,text,uuid[])') IS NOT NULL
    OR to_regprocedure('private.tournament_sponsors_entitled(uuid,uuid,uuid)') IS NOT NULL
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.tournament_branding_object_in_use(text)'::regprocedure)
       IS DISTINCT FROM 'fd7eb865713c713c96e595f9a35ce230'
    OR has_function_privilege('anon', 'private.tournament_branding_object_in_use(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.tournament_branding_object_in_use(text)', 'EXECUTE')
    OR (SELECT public FROM storage.buckets WHERE id = 'tournament-branding') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TORNEOS_0020_ROLLBACK_POSTCONDITION_FAILED';
  END IF;
END
$post$;
COMMIT;
