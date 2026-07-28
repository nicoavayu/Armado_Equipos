-- ===========================================================================
-- Security patch M4 — Storage jugadores-fotos (Stage B: full closure)
-- ---------------------------------------------------------------------------
-- Apply ONLY after the web build routing guest uploads through the Edge
-- Function (upload-voting-photo, service_role) is live. This drops the broad
-- anon/authenticated INSERT policy, leaving:
--   * public SELECT (jugadores_fotos_public_read) — images keep loading;
--   * owner-scoped INSERT/UPDATE for authenticated (jugadores_fotos_owner_*
--     from 20260724124000) — users upload only into their own namespace;
--   * NO anon write path at all — guest photo uploads go through the Edge
--     Function with a validated single-use capability token (service_role).
--
-- After this migration there is NO anonymous INSERT/UPDATE/DELETE on
-- storage.objects for this bucket. Rollback SQL at the bottom.
-- ===========================================================================

BEGIN;

DROP POLICY IF EXISTS jugadores_fotos_anon_authenticated_insert ON storage.objects;

COMMIT;

-- ===========================================================================
-- ROLLBACK (Stage B -> Stage A state)
-- ===========================================================================
-- BEGIN;
-- CREATE POLICY jugadores_fotos_anon_authenticated_insert ON storage.objects
--   FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'jugadores-fotos');
-- COMMIT;
