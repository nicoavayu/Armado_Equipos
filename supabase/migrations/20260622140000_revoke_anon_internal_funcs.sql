-- Security hardening: revoke anonymous / PUBLIC EXECUTE on internal-only functions.
--
-- Two SECURITY DEFINER functions are currently reachable by `anon` because the
-- default PUBLIC EXECUTE grant was never revoked (and one was even granted to
-- `anon` explicitly). Neither is part of the public guest flow:
--
--   * fanout_survey_start_notifications() — a scheduled maintenance job that
--     inserts "survey_start" notifications. It runs from the backend scheduler
--     (service_role), NOT from guests. It is not part of the guest flow.
--
--   * cleanup_voting_access_state(bigint) — deletes voting notifications /
--     delivery-log rows for a match. It is a helper invoked by reset_votacion
--     (already admin-only) and, as a fallback, directly from the authenticated
--     admin path in src/services/db/matches.js -> resetVotacion. It is not part
--     of the guest flow.
--
-- IMPORTANT: EXECUTE is granted to PUBLIC by default, so revoking `anon` alone
-- is not enough. We must revoke PUBLIC and then re-grant EXECUTE explicitly to
-- the roles that must keep access.
--
-- Scope notes:
--   * cleanup_voting_access_state keeps `authenticated` because resetVotacion
--     has a client-side fallback that calls it directly from the authenticated
--     admin.
--   * compute_awards_for_match is intentionally NOT touched here: it is invoked
--     by authenticated members, so it is out of scope for this PR.
--   * The public guest RPCs (match resolution, invite lookup, voter
--     bootstrap/submit) are intentionally NOT touched.
--   * Storage policies and broad RLS policies are intentionally NOT touched
--     (deferred to a separate PR).
--
-- This migration is idempotent: REVOKE of a non-existent privilege is a no-op,
-- and GRANT is safe to re-run. The function bodies are left unchanged.

BEGIN;

-- 1) fanout_survey_start_notifications(): internal scheduled job only.
--    Lock down to service_role (and owner). Not part of the guest flow.
REVOKE EXECUTE ON FUNCTION public.fanout_survey_start_notifications() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fanout_survey_start_notifications() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fanout_survey_start_notifications() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fanout_survey_start_notifications() TO service_role;

-- 2) cleanup_voting_access_state(bigint): internal helper.
--    Keep authenticated (resetVotacion fallback) + service_role. Drop anon / PUBLIC.
REVOKE EXECUTE ON FUNCTION public.cleanup_voting_access_state(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_voting_access_state(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.cleanup_voting_access_state(bigint) TO authenticated, service_role;

COMMIT;
