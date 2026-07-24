-- ===========================================================================
-- Security patch M3 — Notifications (Stage B: full closure)
-- ---------------------------------------------------------------------------
-- Apply ONLY after the secure app build (1.1.19/40) is live AND every direct
-- cross-user `from('notifications').insert()` client call site is routed
-- through a validating RPC (see the call-site table in the PR). This drops the
-- Stage A interim relationship policy and leaves ONLY self-insert; all
-- cross-user notifications then flow through SECURITY DEFINER RPCs
-- (create_notification, send_match_invite, send_call_to_vote, enqueue_*),
-- which generate content server-side and validate the relationship.
--
-- BREAKING for pre-1.1.19/40 clients: any client still inserting a notification
-- directly for ANOTHER user is denied. Accepted per the approved rollout.
-- Rollback SQL at the bottom.
-- ===========================================================================

BEGIN;

DROP POLICY IF EXISTS notifications_insert_related_or_self ON public.notifications;

DROP POLICY IF EXISTS notifications_insert_self_only ON public.notifications;
CREATE POLICY notifications_insert_self_only
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

COMMIT;

-- ===========================================================================
-- ROLLBACK (Stage B -> Stage A state)
-- ===========================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS notifications_insert_self_only ON public.notifications;
-- -- Recreate the Stage A interim policy from 20260724122000 (see that file).
-- COMMIT;
