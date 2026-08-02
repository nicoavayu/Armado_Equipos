-- SAFE CONTAINMENT for 20260802090000_tournament_media_upload_pipeline.sql
-- PRECONDITION: Multimedia flag false; signer/processor stopped; no issued sessions.
-- PRESERVES: attestations table shape, sessions, assets, variants and Storage objects.
-- NON-REVERSIBLE ACTIONS: none. Schema/data deletion is outside automatic rollback.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('arma2-media-upload-safe-rollback', 0));

-- Serialise with session writers. Once this transaction commits, the revoked
-- service-role entry points prevent new writers from passing this lock.
LOCK TABLE public.tournament_media_upload_sessions
  IN SHARE ROW EXCLUSIVE MODE;

DO $rollback$
DECLARE
  active_sessions integer;
BEGIN
  SELECT count(*) INTO active_sessions
  FROM public.tournament_media_upload_sessions
  WHERE status = 'issued' AND expires_at > now();
  IF active_sessions <> 0 THEN
    RAISE EXCEPTION 'MEDIA_SAFE_ROLLBACK_REQUIRES_SESSION_DRAIN active_sessions=%', active_sessions;
  END IF;
END
$rollback$;

SELECT public.revoke_tournament_media_service_attestation('signer');
SELECT public.revoke_tournament_media_service_attestation('processor');

-- Close new writes and signing. Read-only audit/recovery functions and cleanup
-- are deliberately retained so operators can verify and restore safely.
REVOKE ALL ON FUNCTION public.attest_tournament_media_service(
  text, text, jsonb, integer
) FROM service_role, authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.request_tournament_media_upload_session(
  uuid, text, text, bigint, uuid
) FROM service_role, authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.authorize_tournament_media_upload_target(uuid, text, uuid)
  FROM service_role, authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.complete_tournament_media_upload_for_actor(
  uuid, uuid, text, text, bigint, integer, integer, text
) FROM service_role, authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_tournament_media_variants(uuid, jsonb)
  FROM service_role, authenticated, anon, PUBLIC;

DO $rollback$
BEGIN
  IF COALESCE((public.tournament_media_pipeline_readiness()->>'uploadReady')::boolean, false) THEN
    RAISE EXCEPTION 'MEDIA_SAFE_ROLLBACK_POSTCONDITION_UPLOAD_STILL_READY';
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
    'public.authorize_tournament_media_upload_target(uuid,text,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.complete_tournament_media_upload_for_actor(uuid,uuid,text,text,bigint,integer,integer,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.finalize_tournament_media_variants(uuid,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'MEDIA_SAFE_ROLLBACK_POSTCONDITION_MUTATION_STILL_GRANTED';
  END IF;
END
$rollback$;

COMMIT;
