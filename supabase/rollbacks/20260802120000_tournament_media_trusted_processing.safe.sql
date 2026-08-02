-- SAFE CONTAINMENT for 20260802120000_tournament_media_trusted_processing.sql
-- PRECONDITION: Multimedia flag false; worker stopped leasing; queue drained.
-- PRESERVES: jobs, sessions, assets, variants, quarantine objects and audit.
-- NON-REVERSIBLE ACTIONS: none. Table/object deletion requires second approval.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('arma2-media-processing-safe-rollback', 0));

-- Freeze both producers and consumers while drain preconditions are checked.
-- The lock is released only when the privilege revocations become visible.
LOCK TABLE public.tournament_media_upload_sessions,
  public.tournament_media_processing_jobs
  IN SHARE ROW EXCLUSIVE MODE;

DO $rollback$
DECLARE
  active_jobs integer;
  active_sessions integer;
BEGIN
  SELECT count(*) INTO active_jobs
  FROM public.tournament_media_processing_jobs
  WHERE status IN ('queued', 'leased');
  IF active_jobs <> 0 THEN
    RAISE EXCEPTION 'MEDIA_SAFE_ROLLBACK_REQUIRES_DRAIN active_jobs=%', active_jobs;
  END IF;
  SELECT count(*) INTO active_sessions
  FROM public.tournament_media_upload_sessions
  WHERE status = 'issued' AND expires_at > now();
  IF active_sessions <> 0 THEN
    RAISE EXCEPTION 'MEDIA_SAFE_ROLLBACK_REQUIRES_SESSION_DRAIN active_sessions=%', active_sessions;
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
REVOKE ALL ON FUNCTION public.attest_tournament_media_service(
  text, text, jsonb, integer
) FROM service_role, authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.request_tournament_media_upload_session(
  uuid, text, text, bigint, uuid
) FROM service_role, authenticated, anon, PUBLIC;
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
  IF EXISTS (
    SELECT 1 FROM public.tournament_media_upload_sessions
    WHERE status = 'issued' AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'MEDIA_SAFE_ROLLBACK_POSTCONDITION_ACTIVE_SESSIONS';
  END IF;
  IF has_function_privilege(
    'service_role',
    'public.attest_tournament_media_service(text,text,jsonb,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.request_tournament_media_upload_session(uuid,text,text,bigint,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.enqueue_tournament_media_processing_job(uuid,text,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.lease_tournament_media_processing_jobs(text,integer,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.complete_tournament_media_processing_job(uuid,text,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.fail_tournament_media_processing_job(uuid,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.complete_tournament_media_upload_for_job(uuid,text,text,bigint,integer,integer,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'MEDIA_SAFE_ROLLBACK_POSTCONDITION_MUTATION_STILL_GRANTED';
  END IF;
END
$rollback$;

COMMIT;
