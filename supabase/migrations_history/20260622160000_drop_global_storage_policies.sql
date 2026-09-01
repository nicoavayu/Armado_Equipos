-- ===========================================================================
-- Storage hardening — Phase 2 (CLOSE the global hole)
-- ---------------------------------------------------------------------------
-- Storage Phase 1 (20260622150000_storage_scoped_policies.sql) already created
-- and applied the correct, bucket-scoped replacement policies in production:
--
--   * avatars_public_read                          (public SELECT, avatars)
--   * jugadores_fotos_public_read                  (public SELECT, jugadores-fotos)
--   * jugadores_fotos_anon_authenticated_insert    (anon/auth INSERT, jugadores-fotos)
--   * jugadores_fotos_anon_authenticated_update    (anon/auth UPDATE, jugadores-fotos)
--
-- This Phase 2 migration removes the four dangerous GLOBAL policies
--   "Public access for upload and download yw9jo2_0..3"
-- which currently grant {public} access with USING/WITH CHECK true across the
-- whole storage.objects table — i.e. anonymous SELECT, INSERT, UPDATE and
-- DELETE on EVERY bucket. Dropping them CLOSES global anonymous DELETE (and the
-- anonymous write-anywhere hole) without breaking any legitimate flow:
--
--   * jugadores-fotos keeps SELECT / INSERT / UPDATE for anon and authenticated
--     via the Phase 1 scoped policies, so the guest photo-upload flow in
--     VotingView keeps working for anonymous players.
--   * team-crests stays protected by its existing owner-folder policies
--     (team_crests_public_read / _insert_owner_folder / _update_owner_folder /
--     _delete_owner_folder) from 20260221200000_equipos_desafios_module.sql.
--   * avatars is left with public read only (avatars_public_read); it has no
--     write flow in the app.
--
-- This migration ONLY drops policies on storage.objects. It creates NO new
-- policy and does not alter any RPC, function grant, public-schema table policy,
-- voting/join/roster flow, notifications, reset-votacion or
-- compute_awards_for_match. It is idempotent (DROP POLICY IF EXISTS) and wrapped
-- in a single transaction.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Drop the four dangerous global {public}/true policies (Phase 1 replacements
-- are already live, so removing these only closes anonymous write/delete).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public access for upload and download yw9jo2_0" ON storage.objects;
DROP POLICY IF EXISTS "Public access for upload and download yw9jo2_1" ON storage.objects;
DROP POLICY IF EXISTS "Public access for upload and download yw9jo2_2" ON storage.objects;
DROP POLICY IF EXISTS "Public access for upload and download yw9jo2_3" ON storage.objects;

COMMIT;
