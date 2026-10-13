-- Arma2 Torneos — REAL DELETION switch OFF: deactivates the purge job; the lifecycle job (close, notices, marking) keeps
-- running. Leases of a purge in flight expire on their own (5 minutes). Photos already removed are not recovered.
BEGIN;
DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'torneos-season-media-purge' AND active) THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_PURGE_PRECONDITION_FAILED: the purge job is not active';
  END IF;
END $pre$;
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'torneos-season-media-purge';
DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'torneos-season-media-purge' AND NOT active)
    OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'torneos-season-media-lifecycle' AND active) THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_PURGE_POSTCONDITION_FAILED';
  END IF;
END $post$;
COMMIT;
