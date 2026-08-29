-- Arma2 Torneos · Multimedia observability · collector PHASE B (metrics)
--
-- ONE read-only statement. No DDL, no DML, no function creation: this file is
-- not a migration and must never be applied as one.
--
-- ===========================================================================
-- PRECONDITION — this file may not be run on its own
-- ===========================================================================
-- Run ops/torneos-staging/observability/media-pipeline-preflight.sql FIRST, in
-- the same session or at least as the same role against the same database, and
-- run this file ONLY if that phase returned `observable: true`.
--
-- The reason is not caution, it is arithmetic. This statement names the
-- protected tables and the readiness function directly and unconditionally:
--
--   * a missing table fails at parse time with 42P01,
--   * a missing SELECT grant fails at executor start-up with 42501,
--   * a missing function fails at parse time,
--
-- and none of those can be caught, softened or reported by this statement,
-- because a statement cannot report on the conditions that stop it from
-- running. The previous single-query design wrapped every metric in
-- `CASE WHEN visible THEN ...`, which looked like a guard and was not one:
-- PostgreSQL resolves names and checks privileges for the whole range table
-- before the first CASE is ever evaluated. See the long note at the top of the
-- preflight file.
--
-- So the guard lives outside the SQL, in the collector, which must:
--   1. run Phase A,
--   2. refuse to continue unless `observable` is true,
--   3. run this file,
--   4. hand BOTH rows to `snapshotFromCollectorPhases()`, which re-checks the
--      pairing and rejects metrics that arrive without a matching proof.
--
-- Because Phase A has already proven visibility, the counts below need no
-- CASE and no coalesce-to-zero: a zero from this query is a real zero, an
-- empty queue is genuinely empty, and there is no path by which "invisible"
-- can be read as "healthy".
--
-- ===========================================================================
-- What it deliberately does NOT return: object names, quarantine paths,
-- organization/tournament/gallery ids, user ids, lease tokens, session tokens
-- and raw error text. Every value below is a count, an age or a ratio, so the
-- metrics backend cannot become a second copy of the identity map. The role and
-- database names are reported so the evaluator can prove this phase ran as the
-- same role, against the same database, as the proof that authorised it.
--
-- The ages are computed with `now()` inside the database so a collector with a
-- skewed clock cannot fabricate freshness.
--
-- NOTE ON DWELL TIME: this query returns instantaneous values only. It emits no
-- `*SustainedSeconds` field, because a single scrape cannot know how long a
-- value has held. The collector process derives dwell across consecutive
-- scrapes (`deriveSustainedSeconds` in scripts/torneos-staging/observability-lib.mjs).
-- A snapshot that carries this query's output and nothing else evaluates any
-- breaching dwell-gated metric as `unknown`, never as `ok`.
--
-- Usage (read-only, single row of JSON, ONLY after a passing preflight):
--   psql "$STAGING_DATABASE_URL_READONLY" -v ON_ERROR_STOP=1 \
--     -f ops/torneos-staging/observability/media-pipeline-signals.sql

SELECT jsonb_build_object(
  'phase', 'metrics',
  'contractVersion', 1,
  'collectedAt', now(),
  -- Carried so the evaluator can pair this row with the preflight that
  -- authorised it. A metrics row from a different role, or a different
  -- database, is refused rather than merged.
  'collector', jsonb_build_object(
    'role', current_user::text,
    'database', current_database()::text
  ),

  -- Quarantine depth: every object that has been uploaded and has not finished
  -- processing. Counted from the queue, which is the only place that knows an
  -- object exists before an asset does.
  'quarantineDepth', (
    SELECT count(*) FROM public.tournament_media_processing_jobs
    WHERE status <> 'succeeded'
  ),

  'queueDepth', (
    SELECT count(*) FROM public.tournament_media_processing_jobs
    WHERE status = 'queued'
  ),

  'oldestJobAgeSeconds', (
    SELECT coalesce(
      floor(extract(epoch FROM now() - min(created_at)))::bigint, 0
    )
    FROM public.tournament_media_processing_jobs
    WHERE status IN ('queued', 'leased')
  ),

  -- A lease that has expired but is still marked leased: the sweeper
  -- (`cleanup_tournament_media_processing_jobs`) has not run, or is failing.
  'expiredLeases', (
    SELECT count(*) FROM public.tournament_media_processing_jobs
    WHERE status = 'leased' AND lease_expires_at <= now()
  ),

  'stuckLeaseAgeSeconds', (
    SELECT coalesce(
      floor(extract(epoch FROM now() - min(lease_expires_at)))::bigint, 0
    )
    FROM public.tournament_media_processing_jobs
    WHERE status = 'leased' AND lease_expires_at <= now()
  ),

  -- Attestation headroom. A missing row reports -1 rather than null so the
  -- evaluator treats "absent" as "already expired" instead of "unknown". That
  -- substitution is only sound because Phase A already proved the rows would
  -- have been visible had they existed.
  'signerAttestationExpiresInSeconds', (
    SELECT coalesce(
      (SELECT floor(extract(epoch FROM expires_at - now()))::bigint
       FROM public.tournament_media_service_attestations WHERE service = 'signer'),
      -1
    )
  ),
  'processorAttestationExpiresInSeconds', (
    SELECT coalesce(
      (SELECT floor(extract(epoch FROM expires_at - now()))::bigint
       FROM public.tournament_media_service_attestations WHERE service = 'processor'),
      -1
    )
  ),

  -- Signature age comes from the processor's own attested evidence, so it
  -- reflects what the database accepted, not what a scanner claims out of band.
  -- Absent evidence reports the seven-day failure threshold, never zero.
  'clamavSignatureAgeSeconds', (
    SELECT coalesce(
      (SELECT floor(extract(epoch FROM now() - (
         (capabilities #>> '{evidence,antivirus,signaturesAt}')::timestamptz
       )))::bigint
       FROM public.tournament_media_service_attestations
       WHERE service = 'processor'
         AND (capabilities #>> '{evidence,antivirus,signaturesAt}') IS NOT NULL),
      604800
    )
  ),

  -- Share of the last hour's jobs that ended without a published asset. The
  -- sample count travels with it so an idle hour ("0 of 0") is distinguishable
  -- from a proven-clean hour ("0 of 400") without either of them being NULL:
  -- an empty window is genuinely not an alert, but it is also not evidence.
  'uploadFailureRatio', (
    SELECT CASE WHEN count(*) = 0 THEN 0
      ELSE round(
        count(*) FILTER (WHERE status IN ('failed', 'abandoned'))::numeric
        / count(*)::numeric, 4)
    END
    FROM public.tournament_media_processing_jobs
    WHERE created_at >= now() - interval '1 hour'
  ),
  'uploadFailureRatioSampleCount', (
    SELECT count(*) FROM public.tournament_media_processing_jobs
    WHERE created_at >= now() - interval '1 hour'
  ),

  -- The database's own verdict, never recomputed by the collector.
  'uploadReady', (
    SELECT CASE WHEN (public.tournament_media_pipeline_readiness() ->> 'uploadReady')::boolean
      THEN 1 ELSE 0 END
  )
) AS media_pipeline_signals;
