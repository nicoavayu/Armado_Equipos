-- Arma2 Torneos · Multimedia observability · database collector
--
-- ONE read-only statement. No DDL, no DML, no function creation: this file is
-- not a migration and must never be applied as one. It is what the metrics
-- collector runs on an interval against Staging with a read-capable service
-- credential.
--
-- What it deliberately does NOT return: object names, quarantine paths,
-- organization/tournament/gallery ids, user ids, lease tokens, session tokens
-- and raw error text. Every value below is a count, an age or a ratio, so the
-- metrics backend cannot become a second copy of the identity map.
--
-- The two ages are computed with `now()` inside the database so a collector
-- with a skewed clock cannot fabricate freshness.
--
-- Usage (read-only, single row of JSON):
--   psql "$STAGING_DATABASE_URL_READONLY" -v ON_ERROR_STOP=1 \
--     -f ops/torneos-staging/observability/media-pipeline-signals.sql

SELECT jsonb_build_object(
  'collectedAt', now(),

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
  -- evaluator treats "absent" as "already expired" instead of "unknown".
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

  -- Share of the last hour's jobs that ended without a published asset.
  'uploadFailureRatio', (
    SELECT CASE WHEN count(*) = 0 THEN 0
      ELSE round(
        count(*) FILTER (WHERE status IN ('failed', 'abandoned'))::numeric
        / count(*)::numeric, 4)
    END
    FROM public.tournament_media_processing_jobs
    WHERE created_at >= now() - interval '1 hour'
  ),

  -- The database's own verdict, never recomputed by the collector.
  'uploadReady', (
    SELECT CASE WHEN (public.tournament_media_pipeline_readiness() ->> 'uploadReady')::boolean
      THEN 1 ELSE 0 END
  )
) AS media_pipeline_signals;
