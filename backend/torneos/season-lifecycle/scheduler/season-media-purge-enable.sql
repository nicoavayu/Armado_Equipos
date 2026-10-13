-- Arma2 Torneos — REAL DELETION switch ON: activates the purge job the runner created inactive. Its own GO, after:
--   * the runner (season-lifecycle-cron.sql) is in force with the purge job inactive;
--   * the Vault entries torneos_media_purge_secret and torneos_media_store_purge_url exist (created by the operator from a
--     TTY; this file only checks their names, never reads a value);
--   * torneos-media-store is deployed with TORNEOS_MEDIA_PURGE_SECRET (not visible from the database: the GO checklist).
-- From the next :08/:23/:38/:53, photos whose season deadline passed (and orphans) are removed from Storage for good.
-- Off again: season-media-purge-disable.sql (removed photos are not recovered by any rollback).
BEGIN;
DO $pre$
BEGIN
  IF to_regprocedure('private.request_tournament_media_purge(integer)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'torneos-season-media-purge' AND NOT active)
    OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'torneos-season-media-lifecycle' AND active) THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_PURGE_PRECONDITION_FAILED: the runner with an inactive purge job is not in force';
  END IF;
  IF (SELECT count(*) FROM vault.secrets WHERE name IN ('torneos_media_purge_secret', 'torneos_media_store_purge_url')) <> 2 THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_PURGE_PRECONDITION_FAILED: Vault entries missing';
  END IF;
END $pre$;
SELECT cron.alter_job(jobid, active := true) FROM cron.job WHERE jobname = 'torneos-season-media-purge';
DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'torneos-season-media-purge' AND active) THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_PURGE_POSTCONDITION_FAILED';
  END IF;
END $post$;
COMMIT;
