-- SAFE CONTAINMENT for 20260802120000_tournament_media_trusted_processing.sql
-- PRECONDITION: Multimedia flag false; worker stopped leasing; queue drained.
-- PRESERVES: jobs, sessions, assets, variants, quarantine objects and audit.
-- NON-REVERSIBLE ACTIONS: none. Table/object deletion requires second approval.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('arma2-media-processing-safe-rollback', 0));

DO $rollback$
DECLARE
  active_jobs integer;
BEGIN
  SELECT count(*) INTO active_jobs
  FROM public.tournament_media_processing_jobs
  WHERE status IN ('queued', 'leased');
  IF active_jobs <> 0 THEN
    RAISE EXCEPTION 'MEDIA_SAFE_ROLLBACK_REQUIRES_DRAIN active_jobs=%', active_jobs;
  END IF;
END
$rollback$;

-- Revoke fresh attestations. These rows are ephemeral operational leases, not
-- user content; deleting them is the database's defined revocation mechanism.
SELECT public.revoke_tournament_media_service_attestation('signer');
SELECT public.revoke_tournament_media_service_attestation('processor');

-- Stop queue orchestration and trusted callbacks. Cleanup remains available to
-- service_role so an approved incident procedure can purge failed quarantine
-- objects without reopening uploads.
REVOKE ALL ON FUNCTION public.enqueue_tournament_media_processing_job(uuid, text, uuid)
  FROM service_role, authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.lease_tournament_media_processing_jobs(text, integer, integer)
  FROM service_role, authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.complete_tournament_media_processing_job(uuid, text, uuid)
  FROM service_role, authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.fail_tournament_media_processing_job(uuid, text, text)
  FROM service_role, authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.complete_tournament_media_upload_for_job(
  uuid, text, text, bigint, integer, integer, text
) FROM service_role, authenticated, anon, PUBLIC;

REVOKE ALL ON TABLE public.tournament_media_processing_jobs
  FROM authenticated, anon, PUBLIC;

DO $rollback$
BEGIN
  IF COALESCE((public.tournament_media_pipeline_readiness()->>'uploadReady')::boolean, false) THEN
    RAISE EXCEPTION 'MEDIA_SAFE_ROLLBACK_POSTCONDITION_UPLOAD_STILL_READY';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_media_processing_jobs
    WHERE status IN ('queued', 'leased')
  ) THEN
    RAISE EXCEPTION 'MEDIA_SAFE_ROLLBACK_POSTCONDITION_ACTIVE_JOBS';
  END IF;
END
$rollback$;

COMMIT;
