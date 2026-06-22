-- Security hardening: restrict reset_votacion to the match admin.
--
-- Previously reset_votacion was granted to `anon` (and PUBLIC) with no
-- authorization check, so any caller could wipe votes / public votes /
-- public voters and null out player scores for ANY match by id.
--
-- This migration:
--   1) Adds an authorization check: only the match owner (partidos.creado_por)
--      may reset voting. service_role / backend jobs (auth.uid() IS NULL) keep
--      bypass for maintenance.
--   2) Revokes EXECUTE from PUBLIC and anon. The legitimate caller is the
--      authenticated admin (src/services/db/matches.js -> resetVotacion); the
--      public link/code voting flow uses the public_* RPCs, NOT this function,
--      so this does not affect guest voting.
--
-- Body is otherwise identical to 20260327183000_harden_voting_access_and_public_contract.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.reset_votacion(match_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF match_id IS NULL THEN
    RAISE EXCEPTION 'match_id is required' USING ERRCODE = '22023';
  END IF;

  -- Only the match admin may reset voting. service_role / backend jobs run with
  -- auth.uid() = NULL and are allowed through for maintenance.
  IF v_uid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.partidos p
      WHERE p.id = match_id
        AND p.creado_por = v_uid
    ) THEN
      RAISE EXCEPTION 'not_authorized: solo el admin del partido puede resetear la votacion'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.votos
  WHERE partido_id = match_id;

  DELETE FROM public.votos_publicos
  WHERE partido_id = match_id;

  DELETE FROM public.public_voters
  WHERE partido_id = match_id;

  UPDATE public.jugadores
  SET score = NULL
  WHERE partido_id = match_id;

  PERFORM public.cleanup_voting_access_state(match_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_votacion(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_votacion(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_votacion(bigint) TO authenticated, service_role;

COMMIT;
