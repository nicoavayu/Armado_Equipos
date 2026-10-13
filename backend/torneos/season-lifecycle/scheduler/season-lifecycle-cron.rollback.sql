-- ROLLBACK of season-lifecycle-cron.sql: unschedules both jobs and drops the purge caller. The pg_cron and pg_net
-- extensions stay enabled (other jobs could use them; disabling pg_cron deletes every job of the project). The Vault
-- entries are removed by the operator if wanted (vault.secrets rows named torneos_media_purge_secret and
-- torneos_media_store_purge_url). Seasons, notices and purges already done are untouched.
BEGIN;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('torneos-season-media-lifecycle', 'torneos-season-media-purge');
DROP FUNCTION IF EXISTS private.request_tournament_media_purge(integer);
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('torneos-season-media-lifecycle', 'torneos-season-media-purge')) THEN
    RAISE EXCEPTION 'TORNEOS_SEASON_CRON_ROLLBACK_FAILED: jobs remain';
  END IF;
END $post$;
COMMIT;
