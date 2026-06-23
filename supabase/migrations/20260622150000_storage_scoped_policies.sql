-- ===========================================================================
-- Storage hardening — Phase 1 (ADDITIVE, low risk)
-- ---------------------------------------------------------------------------
-- This migration ONLY adds the correct, bucket-scoped Storage policies and
-- removes a handful of dead legacy policies. It is deliberately ADDITIVE:
--
--   * It does NOT drop the four dangerous global policies
--       "Public access for upload and download yw9jo2_0..3"
--     ({public}, USING true) that currently allow anonymous read/write/delete
--     on EVERY storage bucket. Those are removed in Storage Phase 2, once the
--     scoped replacements below have been verified in production.
--
--   * Because the global policies still exist, runtime behaviour does NOT
--     change yet: Postgres RLS is permissive (OR), so adding narrower policies
--     alongside the broad ones cannot remove access. The point of this phase is
--     to land and review the correct policies first.
--
-- Scope of buckets:
--   * avatars         — read-only public access. Orphan in current code (no
--                       upload path references it), so NO INSERT/UPDATE/DELETE.
--   * jugadores-fotos  — public read + anon/authenticated INSERT & UPDATE. The
--                       guest voting flow (VotingView) lets anonymous players
--                       upload their photo, so anon writes must stay allowed.
--                       NO DELETE: the app has no legitimate delete flow here.
--   * team-crests      — intentionally NOT touched. Its scoped, owner-folder
--                       policies already live in
--                       20260221200000_equipos_desafios_module.sql
--                       (team_crests_public_read / _insert_owner_folder /
--                       _update_owner_folder / _delete_owner_folder).
--
-- Dead legacy policies removed:
--   * "Give anon users access to JPG images in folder yw9jo2_0..2" only match
--     public/*.jpg. The real upload code writes flat paths with varying
--     extensions, so these never match anything and are safe to drop.
--
-- This migration touches ONLY storage.objects. It does not alter any RPC,
-- function grant, public-schema table policy, voting/join/roster flow,
-- notifications, reset-votacion or compute_awards_for_match.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- avatars — public read only (orphan bucket: no write flow in the app)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS avatars_public_read ON storage.objects;
CREATE POLICY avatars_public_read
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- ---------------------------------------------------------------------------
-- jugadores-fotos — public read + anon/authenticated insert & update
--   (guest VotingView photo upload requires anonymous writes; no DELETE)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS jugadores_fotos_public_read ON storage.objects;
CREATE POLICY jugadores_fotos_public_read
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'jugadores-fotos');

DROP POLICY IF EXISTS jugadores_fotos_anon_authenticated_insert ON storage.objects;
CREATE POLICY jugadores_fotos_anon_authenticated_insert
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'jugadores-fotos');

DROP POLICY IF EXISTS jugadores_fotos_anon_authenticated_update ON storage.objects;
CREATE POLICY jugadores_fotos_anon_authenticated_update
ON storage.objects
FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'jugadores-fotos')
WITH CHECK (bucket_id = 'jugadores-fotos');

-- ---------------------------------------------------------------------------
-- Drop dead legacy policies (match only public/*.jpg, never hit by real code)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Give anon users access to JPG images in folder yw9jo2_0" ON storage.objects;
DROP POLICY IF EXISTS "Give anon users access to JPG images in folder yw9jo2_1" ON storage.objects;
DROP POLICY IF EXISTS "Give anon users access to JPG images in folder yw9jo2_2" ON storage.objects;

-- NOTE: the four dangerous global policies
--   "Public access for upload and download yw9jo2_0..3"
-- are intentionally LEFT IN PLACE here. They are removed in Storage Phase 2.

COMMIT;
