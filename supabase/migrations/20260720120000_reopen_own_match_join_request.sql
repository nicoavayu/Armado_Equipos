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
-- no equivalent.
--
-- FIX: reopen_own_match_join_request runs as the table owner (bypassing RLS,
-- exactly like cancel and the demote trigger) and reopens the caller's own
-- terminal request to 'pending'. It validates the WHOLE operation server-side and
-- returns CONTROLLED business statuses (never a generic error), so the UI can show
-- the exact reason and the fix never depends on the client's own checks:
--   * the match exists, is not cancelled/finished/deleted, and kicks off in the
--     future (operativo + futuro);
--   * the caller is not already on the roster;
--   * the request belongs to the authenticated caller (auth.uid());
--   * the role is valid; a 'goalkeeper' reopen requires busca_arquero = true AND
--     the caller to keep goal (ARQ); a 'player' reopen requires the match to be
--     open to players (falta_jugadores = true);
--   * an 'approved' request is never reopened (returned as-is);
--   * two concurrent reopens can never diverge: the request row is locked
--     FOR UPDATE, so the second caller serializes behind the first and sees the
--     already-'pending' row (idempotent).
-- Writing `role` still fires the BEFORE UPDATE OF role guard as a backstop.
--
-- Returned jsonb `status` values:
--   pending | already_approved | already_member | not_found | invalid_role |
--   match_not_found | match_past | match_closed | goalkeeper_not_searched |
--   not_goalkeeper | players_not_searched
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
  v_estado text;
  v_deleted_at timestamptz;
  v_kickoff timestamptz;
  v_falta_jugadores boolean;
  v_busca_arquero boolean;
  v_has_arq boolean;
  v_rows integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('player', 'goalkeeper') THEN
    RETURN jsonb_build_object('status', 'invalid_role');
  END IF;

  -- Lock the caller's own request row first so two fast taps serialize instead of
  -- racing (one reopens, the other then sees the already-'pending' row).
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

  -- Already active: return as-is. Idempotent (a double tap never errors) and an
  -- 'approved' request is never silently reopened.
  IF v_status = 'pending' THEN
    RETURN jsonb_build_object('status', 'pending', 'request_id', v_request_id, 'reopened', false);
  END IF;

  IF v_status = 'approved' THEN
    RETURN jsonb_build_object('status', 'already_approved', 'request_id', v_request_id);
  END IF;

  -- The caller must not already be on the roster (e.g. re-added out of band).
  IF EXISTS (
    SELECT 1 FROM public.jugadores j
    WHERE j.partido_id = p_match_id AND j.usuario_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('status', 'already_member', 'request_id', v_request_id);
  END IF;

  -- Match must exist, be operativo (not cancelled/finished/deleted) and futuro.
  SELECT lower(trim(COALESCE(p.estado, ''))),
         p.deleted_at,
         public.partido_kickoff_at(p.fecha, p.hora),
         COALESCE(p.falta_jugadores, false),
         COALESCE(p.busca_arquero, false)
    INTO v_estado, v_deleted_at, v_kickoff, v_falta_jugadores, v_busca_arquero
  FROM public.partidos p
  WHERE p.id = p_match_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'match_not_found', 'request_id', v_request_id);
  END IF;

  IF v_deleted_at IS NOT NULL
     OR v_estado IN ('cancelado', 'cancelled', 'canceled', 'deleted',
                     'finalizado', 'finished', 'completed', 'closed') THEN
    RETURN jsonb_build_object('status', 'match_closed', 'request_id', v_request_id);
  END IF;

  IF v_kickoff IS NULL OR v_kickoff <= now() THEN
    RETURN jsonb_build_object('status', 'match_past', 'request_id', v_request_id);
  END IF;

  -- Role eligibility (does not rely on the client's checks).
  IF v_role = 'goalkeeper' THEN
    IF NOT v_busca_arquero THEN
      RETURN jsonb_build_object('status', 'goalkeeper_not_searched', 'request_id', v_request_id);
    END IF;

    SELECT ('ARQ' = ANY(COALESCE(u.posiciones, '{}'::text[])))
      INTO v_has_arq
    FROM public.usuarios u
    WHERE u.id = v_user_id;

    IF NOT COALESCE(v_has_arq, false) THEN
      RETURN jsonb_build_object('status', 'not_goalkeeper', 'request_id', v_request_id);
    END IF;
  ELSE
    -- New flow: a 'player' request requires the match to be open to players.
    IF NOT v_falta_jugadores THEN
      RETURN jsonb_build_object('status', 'players_not_searched', 'request_id', v_request_id);
    END IF;
  END IF;

  -- Terminal (rejected / cancelled / ...) and eligible → reopen to 'pending'.
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
