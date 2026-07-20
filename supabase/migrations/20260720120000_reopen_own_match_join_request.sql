-- Let a requester REOPEN their OWN match join request via a SECURITY DEFINER RPC
-- (forward fix for PR #87 smoke finding: an ejected player cannot request again —
-- "No se pudo enviar la solicitud").
--
-- ROOT CAUSE: match_join_requests carries a single unique row per
-- (match_id, user_id). After an admin eject, the demote trigger
-- (20260719121000) sets that row to 'rejected'. On re-request the public screen
-- INSERTs a fresh 'pending' row, hits the unique violation (23505) and falls back
-- to a DIRECT client UPDATE rejected/cancelled -> pending. But the ONLY UPDATE
-- policy on match_join_requests is admin-only:
--     "admin can update match requests" USING (partido.creado_por = auth.uid())
-- so the requester's UPDATE matches ZERO rows, PostgREST's `.single()` throws and
-- the UI shows the generic "No se pudo enviar la solicitud". Self-cancel + rejoin
-- has the same latent bug; it only avoided it because cancellation goes through
-- the SECURITY DEFINER RPC cancel_own_match_join_request while the reopen path had
-- no equivalent and updated the row directly.
--
-- FIX: mirror cancel_own_match_join_request. reopen_own_match_join_request runs as
-- the table owner (bypassing RLS, exactly like cancel and the demote trigger) and
-- moves the caller's own terminal request back to 'pending' with the requested
-- role. Because it writes `role`, the existing BEFORE UPDATE OF role guard
-- (trg_match_join_request_role_guard) still fires, so reopening as 'goalkeeper' is
-- rejected server-side when the match is not searching a goalkeeper or the
-- requester no longer has ARQ. An already pending/approved row is returned as-is
-- (idempotent) so a double tap never errors. A first-time requester with no prior
-- row gets 'not_found' and the caller INSERTs normally (that path already works
-- under the "user can request join" INSERT policy).
--
-- Forward-only and additive; does not touch any applied migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.reopen_own_match_join_request(
  p_match_id bigint,
  p_role text DEFAULT 'player'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text := lower(trim(COALESCE(p_role, 'player')));
  v_request_id bigint;
  v_status text;
  v_rows integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('player', 'goalkeeper') THEN
    RAISE EXCEPTION 'Rol de solicitud inválido: %', v_role
      USING ERRCODE = 'check_violation';
  END IF;

  -- One row per (match, user). Lock it so two fast taps serialize instead of
  -- racing the reopen against a concurrent approve/cancel.
  SELECT r.id, lower(trim(COALESCE(r.status, '')))
    INTO v_request_id, v_status
  FROM public.match_join_requests r
  WHERE r.match_id = p_match_id
    AND r.user_id = v_user_id
  ORDER BY r.created_at DESC NULLS LAST, r.id DESC
  LIMIT 1
  FOR UPDATE;

  -- No prior request: nothing to reopen. The caller INSERTs a fresh 'pending' row
  -- (allowed by the "user can request join" INSERT policy).
  IF v_request_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Already active: return as-is. Idempotent, so a double tap never errors and an
  -- 'approved' row is never silently downgraded.
  IF v_status = 'pending' THEN
    RETURN jsonb_build_object('status', 'pending', 'request_id', v_request_id, 'reopened', false);
  END IF;

  IF v_status = 'approved' THEN
    RETURN jsonb_build_object('status', 'approved', 'request_id', v_request_id, 'reopened', false);
  END IF;

  -- Terminal (rejected / cancelled / anything else): reopen to 'pending' with the
  -- requested role. Writing `role` fires the BEFORE UPDATE OF role guard, which
  -- rejects an ineligible goalkeeper reopen (match not searching a goalkeeper, or
  -- requester without ARQ) with its own controlled error.
  UPDATE public.match_join_requests
  SET status = 'pending',
      role = v_role,
      decided_at = NULL,
      decided_by = NULL
  WHERE id = v_request_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  RETURN jsonb_build_object('status', 'pending', 'request_id', v_request_id, 'reopened', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_own_match_join_request(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_own_match_join_request(bigint, text) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback reference — not executed):
--   DROP FUNCTION IF EXISTS public.reopen_own_match_join_request(bigint, text);
-- ---------------------------------------------------------------------------
