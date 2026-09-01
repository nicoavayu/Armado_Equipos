-- SAFE CONTAINMENT for 20260803090000_tournament_social_studio.sql
-- PRECONDITION: Social flag is false and no Social export is in progress.
-- PRESERVES: permission rows, audit evidence, published competition data.
-- NON-REVERSIBLE ACTIONS: none. DROP/DELETE are explicitly out of scope.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('arma2-social-safe-rollback', 0));

-- Close every browser entry point. Service-role read access is retained for
-- audit and restoration; the frontend flag must already be false.
REVOKE ALL ON FUNCTION public.get_tournament_social_snapshot(
  uuid, uuid, uuid, uuid, text, uuid, uuid
) FROM authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.get_tournament_social_studio_context(uuid)
  FROM authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.set_tournament_social_permission(
  uuid, uuid, boolean
) FROM authenticated, anon, PUBLIC;

REVOKE ALL ON TABLE public.tournament_social_permissions
  FROM authenticated, anon, PUBLIC;

-- Postcondition: no client can execute the three exposed Social RPCs.
DO $rollback$
DECLARE
  exposed_count integer;
BEGIN
  SELECT count(*) INTO exposed_count
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name IN (
      'get_tournament_social_snapshot',
      'get_tournament_social_studio_context',
      'set_tournament_social_permission'
    )
    AND grantee IN ('PUBLIC', 'anon', 'authenticated')
    AND privilege_type = 'EXECUTE';
  IF exposed_count <> 0 THEN
    RAISE EXCEPTION 'SOCIAL_SAFE_ROLLBACK_POSTCONDITION_FAILED';
  END IF;
END
$rollback$;

COMMIT;
