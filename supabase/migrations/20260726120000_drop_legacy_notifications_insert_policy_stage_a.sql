-- ===========================================================================
-- Security patch M3 — Notifications (Stage A hotfix): remove the SECOND legacy
-- CHECK(true) INSERT policy that 20260724122000 did not drop (finding #22).
-- ---------------------------------------------------------------------------
-- Prod `public.notifications` carried TWO permissive INSERT policies for
-- `authenticated`, each WITH CHECK (true):
--   * notifications_insert_authenticated_any_user  (20260226123000)  -> dropped
--       by the Stage A migration 20260724122000.
--   * "Allow Insert Authenticated"                 (legacy, ad-hoc)  -> NEVER
--       dropped by Stage A NOR by Stage B.
-- RLS INSERT policies are OR-combined, so a single surviving CHECK(true) policy
-- re-opens the exact forge / impersonation hole Stage A set out to close: any
-- authenticated user can still INSERT a notification with an ARBITRARY user_id /
-- type / title / message / data for ANY other user. While "Allow Insert
-- Authenticated" exists the strict Stage A policy
-- notifications_insert_related_or_self is INERT (it can only ever add more, and
-- CHECK(true) already permits everything).
--
-- This migration:
--   1. DROPs "Allow Insert Authenticated" so the strict Stage A relationship
--      policy actually governs direct inserts.
--   2. Adds NARROW, relationship-validated Stage A COMPATIBILITY policies for
--      the direct-insert flows of the CURRENTLY INSTALLED client (main /
--      1.1.19) that notifications_insert_related_or_self does NOT cover, so
--      dropping the broad policy does not break installed apps. NONE of them is
--      WITH CHECK(true): each validates a REAL database relationship and never
--      trusts client title / message / data beyond a length bound. See the
--      installed-client call-site audit in the PR description.
--   3. Runs a verification GATE (inside the same transaction) that FAILS the
--      deploy if any permissive `authenticated` INSERT policy with an
--      unrestricted WITH CHECK survives, and asserts "Allow Insert
--      Authenticated" is gone.
--
-- Stage B (20260724132000_notifications_rpc_only_stage_b.sql) drops the interim
-- relationship policy AND every compatibility policy added here, leaving ONLY
-- self-insert; all cross-user inserts then flow through the SECURITY DEFINER
-- RPCs (create_notification, send_match_invite, send_call_to_vote, enqueue_*).
-- Rollback SQL at the bottom.
-- ===========================================================================

BEGIN;

ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 1. Remove the surviving broad CHECK(true) policy (finding #22).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow Insert Authenticated" ON public.notifications;

-- ---------------------------------------------------------------------------
-- 2. Stage A compatibility policies for installed-client direct inserts.
--    Every policy below is relationship-validated; none is unrestricted.
-- ---------------------------------------------------------------------------

-- 2a. SELF: a user may always create a notification addressed to THEMSELVES.
--     This is NOT the abuse the finding targets (forging to OTHER users) — the
--     row is only ever visible to its owner (notifications_select_own), so a
--     self-insert can neither phish nor impersonate anyone. Covers the
--     installed-client self-inserts whose `type` is outside the strict Stage A
--     allowlist: challenge_result_survey (challengeResultNotificationService)
--     and the generic NotificationContext.createNotification path (which emits
--     e.g. `post_match_survey` to the current user).
DROP POLICY IF EXISTS notifications_insert_self_compat ON public.notifications;
CREATE POLICY notifications_insert_self_compat
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND char_length(COALESCE(title, '')) <= 200
  AND char_length(COALESCE(message, '')) <= 1000
);

-- 2b. TEAM CHALLENGE parties: the two concrete parties (creator / acceptor) of
--     the SAME real challenge may notify each other even though rival teams do
--     not share a match / team / friendship. The relationship is validated
--     against the real public.challenges row — the pairing is NOT taken from
--     client-supplied `data`. Covers teamChallenges.js `team_challenge_accepted`
--     (the directed-challenge push) and the `match_update` accept fan-out.
DROP POLICY IF EXISTS notifications_insert_challenge_parties_compat ON public.notifications;
CREATE POLICY notifications_insert_challenge_parties_compat
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  type IN ('team_challenge_accepted', 'challenge', 'team_match', 'match_update')
  AND char_length(COALESCE(title, '')) <= 200
  AND char_length(COALESCE(message, '')) <= 1000
  AND EXISTS (
    SELECT 1 FROM public.challenges c
    WHERE auth.uid() IN (c.created_by_user_id, c.accepted_by_user_id)
      AND public.notifications.user_id IN (c.created_by_user_id, c.accepted_by_user_id)
      AND public.notifications.user_id <> auth.uid()
  )
);

-- 2c. NO-SHOW ranking messages: the survey-finalizer notifies a co-participant
--     of a real no-show penalty / recovery. This is the SAME shared-match
--     relationship notifications_insert_related_or_self already trusts; the only
--     gap is that the installed client uses the `*_applied` type names, which are
--     outside the Stage A allowlist. Covers penalties.js
--     insertPrivateRankingNotification. The relationship mirrors the Stage A
--     shared-match branches EXACTLY (creator-inclusive, both directions): the
--     process that closes the survey may be the match ADMIN (partidos.creado_por)
--     rather than a roster row, and must still be able to notify the penalized
--     roster player.
DROP POLICY IF EXISTS notifications_insert_match_ranking_compat ON public.notifications;
CREATE POLICY notifications_insert_match_ranking_compat
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  type IN ('no_show_penalty_applied', 'no_show_recovery_applied')
  AND char_length(COALESCE(title, '')) <= 200
  AND char_length(COALESCE(message, '')) <= 1000
  AND (
    -- both are roster players of the same match
    EXISTS (
      SELECT 1
      FROM public.jugadores j_self
      JOIN public.jugadores j_rec ON j_rec.partido_id = j_self.partido_id
      WHERE j_self.usuario_id = auth.uid()
        AND j_rec.usuario_id = public.notifications.user_id
    )
    -- or the match creator/participant notifies a creator/participant (mirrors
    -- notifications_insert_related_or_self so the admin-finalizer case is covered)
    OR EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE (p.creado_por = auth.uid() OR EXISTS (
              SELECT 1 FROM public.jugadores j WHERE j.partido_id = p.id AND j.usuario_id = auth.uid()))
        AND (p.creado_por = public.notifications.user_id OR EXISTS (
              SELECT 1 FROM public.jugadores j2 WHERE j2.partido_id = p.id AND j2.usuario_id = public.notifications.user_id))
    )
  )
);

-- 2d. MATCH JOIN REQUEST: a user with a REAL pending join request may notify the
--     match admin (its creator). Mirrors create_notification's
--     match_join_request check and covers the matchJoinNotificationService
--     direct-insert FALLBACK (used only when the enqueue_* RPC is unavailable).
--     Validated against the real match_join_requests + partidos rows — only
--     `partido_id` is read from the row, and only to be checked against those
--     tables (never client free text).
DROP POLICY IF EXISTS notifications_insert_join_request_compat ON public.notifications;
CREATE POLICY notifications_insert_join_request_compat
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  type = 'match_join_request'
  AND char_length(COALESCE(title, '')) <= 200
  AND char_length(COALESCE(message, '')) <= 1000
  AND partido_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.match_join_requests r
    JOIN public.partidos p ON p.id = r.match_id
    WHERE r.match_id = public.notifications.partido_id
      AND r.user_id = auth.uid()
      AND lower(COALESCE(r.status, '')) = 'pending'
      AND p.creado_por = public.notifications.user_id
  )
);

-- ---------------------------------------------------------------------------
-- 3. Verification gate (in-transaction; rolls the whole migration back if it
--    fires). No-op against a correctly patched database.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_leftover text;
BEGIN
  -- (b) the named legacy policy must be gone
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications'
      AND policyname = 'Allow Insert Authenticated'
  ) THEN
    RAISE EXCEPTION
      'notifications hardening gate: legacy policy "Allow Insert Authenticated" still present on public.notifications';
  END IF;

  -- (a) no permissive INSERT policy for authenticated/public with an
  --     unrestricted WITH CHECK (true, (true), or an omitted check) survives.
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
      'notifications hardening gate: permissive authenticated INSERT policy with an unrestricted WITH CHECK survives: %',
      v_leftover;
  END IF;
END $$;

COMMIT;

-- ===========================================================================
-- ROLLBACK (Stage A hotfix -> pre-hotfix Stage A state)
-- ===========================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS notifications_insert_self_compat ON public.notifications;
-- DROP POLICY IF EXISTS notifications_insert_challenge_parties_compat ON public.notifications;
-- DROP POLICY IF EXISTS notifications_insert_match_ranking_compat ON public.notifications;
-- DROP POLICY IF EXISTS notifications_insert_join_request_compat ON public.notifications;
-- CREATE POLICY "Allow Insert Authenticated" ON public.notifications
--   FOR INSERT TO authenticated WITH CHECK (true);
-- COMMIT;
