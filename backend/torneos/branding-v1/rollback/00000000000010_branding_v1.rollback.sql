-- Rollback of BRANDING-V1 (00000000000010_branding_v1.sql) on the isolated Torneos project. Documented, never automatic:
-- run only with an explicit GO, AFTER the gateway runs without TORNEOS_BRANDING_MODE (nothing signs or stores anymore).
--
-- Effects: the five storage policies and the two read rules go away and the bucket is emptied of nothing — objects stay
-- in storage (private, unreachable without policies) until an operator deletes them with the storage API; the durable
-- references (tournaments.logo_path, tournament_organizations.logo_path, tournament_team_entries.shield_path,
-- participant snapshots) are left as they are: they are paths, never URLs, and every composition already renders the
-- initials when it cannot sign a path. Requests, entries and profiles are untouched.
BEGIN;

drop policy if exists tournament_branding_select_public on storage.objects;
drop policy if exists tournament_branding_select_authorized on storage.objects;
drop policy if exists tournament_branding_insert_authorized on storage.objects;
drop policy if exists tournament_branding_update_denied on storage.objects;
drop policy if exists tournament_branding_delete_authorized on storage.objects;

drop function if exists public.can_read_tournament_branding_object(text);
drop function if exists public.is_public_tournament_branding_object(text);

-- The bucket row stays (deleting it requires the bucket to be empty): it is private and has no policy left.

DO $post$
BEGIN
  IF EXISTS (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'tournament_branding_%') THEN
    RAISE EXCEPTION 'TORNEOS_BRANDING_V1_ROLLBACK_FAILED: policies left';
  END IF;
END $post$;

COMMIT;
