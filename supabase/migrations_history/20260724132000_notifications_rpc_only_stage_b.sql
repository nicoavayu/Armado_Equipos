-- ===========================================================================
-- Security patch M3 — Notifications (Stage B: full closure)
-- ---------------------------------------------------------------------------
-- Apply ONLY after the secure app build (1.1.19/40) is live AND every direct
-- cross-user `from('notifications').insert()` client call site is routed
-- through a validating RPC (see the call-site table in the PR). This drops the
-- Stage A interim relationship policy, the Stage A hotfix compatibility policies
-- (20260726120000) AND the legacy "Allow Insert Authenticated" policy
-- (finding #22), leaving ONLY self-insert; all cross-user notifications then
-- flow through SECURITY DEFINER RPCs (create_notification, send_match_invite,
-- send_call_to_vote, enqueue_*), which generate content server-side and validate
-- the relationship.
--
-- BREAKING for pre-1.1.19/40 clients: any client still inserting a notification
-- directly for ANOTHER user is denied. Accepted per the approved rollout.
-- Rollback SQL at the bottom.
-- ===========================================================================

BEGIN;

DROP POLICY IF EXISTS notifications_insert_related_or_self ON public.notifications;

-- Also drop the legacy CHECK(true) policy (finding #22) and every Stage A hotfix
-- compatibility policy so Stage B truly leaves ONLY self-insert. Belt-and-
-- suspenders: the 20260726120000 hotfix already dropped "Allow Insert
-- Authenticated", but Stage B must be self-sufficient regardless of apply order.
DROP POLICY IF EXISTS "Allow Insert Authenticated" ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_self_compat ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_challenge_parties_compat ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_match_ranking_compat ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_join_request_compat ON public.notifications;

DROP POLICY IF EXISTS notifications_insert_self_only ON public.notifications;
CREATE POLICY notifications_insert_self_only
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Deploy gate: after Stage B, no permissive authenticated/public INSERT policy
-- with an unrestricted WITH CHECK may survive, and only self-insert remains.
DO $$
DECLARE
  v_leftover text;
BEGIN
  SELECT string_agg(policyname, ', ')
    INTO v_leftover
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'notifications'
    AND cmd = 'INSERT'
    AND permissive = 'PERMISSIVE'
    AND (roles && ARRAY['authenticated', 'public']::name[])
    AND regexp_replace(lower(COALESCE(with_check, 'true')), '[[:space:]()]', '', 'g') = 'true';
  IF v_leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Stage B gate: permissive authenticated INSERT policy with an unrestricted WITH CHECK survives: %',
      v_leftover;
  END IF;
END $$;

COMMIT;

-- ===========================================================================
-- ROLLBACK (Stage B -> Stage A state)
-- ===========================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS notifications_insert_self_only ON public.notifications;
-- -- Recreate the Stage A interim policy from 20260724122000 (see that file).
-- COMMIT;
