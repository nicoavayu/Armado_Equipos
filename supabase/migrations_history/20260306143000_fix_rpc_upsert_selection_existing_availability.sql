-- Fix: when selecting starter/substitute, preserve current availability from the
-- existing challenge_team_squad row before INSERT trigger validation.
-- Without this, the INSERT path used "pending" and the BEFORE INSERT trigger
-- raised "Solo jugadores disponibles pueden ser convocados" even on conflicts.

CREATE OR REPLACE FUNCTION public.rpc_upsert_challenge_team_selection(
  p_challenge_id uuid,
  p_team_id uuid,
  p_player_id text,
  p_selection_status text,
  p_approved_by_captain boolean DEFAULT true
)
RETURNS public.challenge_team_squad
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_player_id public.jugadores.id%TYPE;
  v_selection text := lower(COALESCE(p_selection_status, 'not_selected'));
  v_row public.challenge_team_squad%ROWTYPE;
  v_existing_row public.challenge_team_squad%ROWTYPE;
  v_insert_availability text := 'pending';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF v_selection NOT IN ('starter', 'substitute', 'not_selected') THEN
    RAISE EXCEPTION 'Estado de selección inválido';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  IF v_challenge.accepted_team_id IS NULL THEN
    RAISE EXCEPTION 'El desafío todavía no tiene rival confirmado';
  END IF;

  IF p_team_id IS DISTINCT FROM v_challenge.challenger_team_id
     AND p_team_id IS DISTINCT FROM v_challenge.accepted_team_id THEN
    RAISE EXCEPTION 'team_id no pertenece al desafío';
  END IF;

  IF NOT public.team_user_is_captain_or_owner(p_team_id, v_uid) THEN
    RAISE EXCEPTION 'Solo capitán/admin puede editar el plantel final';
  END IF;

  IF COALESCE(v_challenge.squad_status, 'not_open') IN ('closed', 'finalized') THEN
    RAISE EXCEPTION 'La convocatoria ya está cerrada';
  END IF;

  SELECT j.id
  INTO v_player_id
  FROM public.jugadores j
  WHERE j.id::text = trim(COALESCE(p_player_id, ''))
  LIMIT 1;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Jugador inválido para convocatoria';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.team_id = p_team_id
      AND tm.jugador_id = v_player_id
  ) THEN
    RAISE EXCEPTION 'El jugador no pertenece a ese equipo';
  END IF;

  PERFORM public.prepare_challenge_team_squad(p_challenge_id, true);

  SELECT *
  INTO v_existing_row
  FROM public.challenge_team_squad cts
  WHERE cts.challenge_id = p_challenge_id
    AND cts.team_id = p_team_id
    AND cts.player_id = v_player_id
  LIMIT 1;

  IF FOUND THEN
    v_insert_availability := COALESCE(v_existing_row.availability_status, 'pending');
  END IF;

  IF v_selection IN ('starter', 'substitute') AND v_insert_availability <> 'available' THEN
    RAISE EXCEPTION 'Solo jugadores disponibles pueden ser convocados';
  END IF;

  INSERT INTO public.challenge_team_squad (
    challenge_id,
    team_id,
    player_id,
    availability_status,
    selection_status,
    approved_by_captain,
    selected_at,
    selected_by,
    updated_at
  ) VALUES (
    p_challenge_id,
    p_team_id,
    v_player_id,
    v_insert_availability,
    v_selection,
    CASE
      WHEN v_selection = 'not_selected' THEN false
      ELSE COALESCE(p_approved_by_captain, true)
    END,
    CASE
      WHEN v_selection = 'not_selected' THEN NULL
      ELSE now()
    END,
    CASE
      WHEN v_selection = 'not_selected' THEN NULL
      ELSE v_uid
    END,
    now()
  )
  ON CONFLICT (challenge_id, team_id, player_id)
  DO UPDATE SET
    selection_status = EXCLUDED.selection_status,
    approved_by_captain = EXCLUDED.approved_by_captain,
    selected_at = EXCLUDED.selected_at,
    selected_by = EXCLUDED.selected_by,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_upsert_challenge_team_selection(uuid, uuid, text, text, boolean) TO authenticated, service_role;
