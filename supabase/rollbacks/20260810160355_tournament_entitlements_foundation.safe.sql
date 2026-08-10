-- SAFE CONTAINMENT for 20260810160355_tournament_entitlements_foundation.sql
-- PRESERVES: subscriptions, overrides, media metadata, sporting data and audit.
-- NON-REVERSIBLE ACTIONS: none. No table, row or Storage object is deleted.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('arma2-entitlements-safe-rollback',0));

REVOKE ALL ON FUNCTION public.get_effective_tournament_entitlements(uuid,uuid)
  FROM authenticated,anon,PUBLIC;
REVOKE ALL ON FUNCTION public.has_tournament_entitlement(uuid,uuid,text)
  FROM authenticated,anon,PUBLIC;
REVOKE ALL ON FUNCTION public.set_tournament_organization_subscription(
  uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,integer
) FROM service_role,authenticated,anon,PUBLIC;
REVOKE ALL ON FUNCTION public.set_tournament_entitlement_override(
  uuid,uuid,text,boolean,timestamptz,text
) FROM service_role,authenticated,anon,PUBLIC;
REVOKE ALL ON FUNCTION public.clear_tournament_entitlement_override(uuid,uuid,text)
  FROM service_role,authenticated,anon,PUBLIC;
REVOKE ALL ON FUNCTION public.list_tournament_media_retention_candidates(
  uuid,uuid,timestamptz
) FROM service_role,authenticated,anon,PUBLIC;

ALTER TABLE public.tournament_media_upload_sessions
  DISABLE TRIGGER tournament_media_upload_sessions_matchday_limit;

COMMIT;
