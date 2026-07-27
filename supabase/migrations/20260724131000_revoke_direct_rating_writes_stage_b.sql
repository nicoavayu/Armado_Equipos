-- ===========================================================================
-- Security patch M1 — No-show ranking (Stage B: full closure)
-- ---------------------------------------------------------------------------
-- Apply ONLY after the secure app build (1.1.19/40) is live in both stores
-- (see rollout in the PR). This revokes the direct write paths so
-- rating_adjustments / no_show_recovery_state can be written ONLY through the
-- SECURITY DEFINER RPC process_match_no_show_ranking (or service_role).
--
-- BREAKING for pre-1.1.19/40 clients: their in-app no-show processing (direct
-- INSERT/UPSERT during survey finalization) stops working. Accepted per the
-- approved rollout (web is already on the RPC; few native users; update prompt).
-- Reading own/ shared rows is unaffected. Rollback SQL at the bottom.
-- ===========================================================================

BEGIN;

-- rating_adjustments: remove the permissive INSERT policy and direct write grants.
DROP POLICY IF EXISTS rating_adjustments_insert_authenticated ON public.rating_adjustments;
REVOKE INSERT, UPDATE, DELETE ON public.rating_adjustments FROM authenticated;

-- no_show_recovery_state: remove permissive INSERT/UPDATE policies and grants.
DROP POLICY IF EXISTS no_show_recovery_state_insert_authenticated ON public.no_show_recovery_state;
DROP POLICY IF EXISTS no_show_recovery_state_update_authenticated ON public.no_show_recovery_state;
REVOKE INSERT, UPDATE, DELETE ON public.no_show_recovery_state FROM authenticated;

-- service_role keeps full access; SELECT stays governed by the scoped policies
-- created in 20260724121000 (own rows / shared-match for rating_adjustments,
-- own row for no_show_recovery_state).

COMMIT;

-- ===========================================================================
-- ROLLBACK (Stage B -> Stage A state)
-- ===========================================================================
-- BEGIN;
-- GRANT INSERT ON public.rating_adjustments TO authenticated;
-- CREATE POLICY rating_adjustments_insert_authenticated ON public.rating_adjustments
--   FOR INSERT TO authenticated WITH CHECK (true);
-- GRANT INSERT, UPDATE ON public.no_show_recovery_state TO authenticated;
-- CREATE POLICY no_show_recovery_state_insert_authenticated ON public.no_show_recovery_state
--   FOR INSERT TO authenticated WITH CHECK (true);
-- CREATE POLICY no_show_recovery_state_update_authenticated ON public.no_show_recovery_state
--   FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- COMMIT;
