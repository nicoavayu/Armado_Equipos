-- Fix: disambiguate availability updates when a user can map to multiple team_members
-- across challenge teams. Allow frontend to pass team/player target explicitly.

CREATE OR REPLACE FUNCTION public.rpc_set_challenge_availability(
  p_challenge_id uuid,
  p_availability_status text,
  p_team_id uuid DEFAULT NULL,
  p_player_id text DEFAULT NULL
)
RETURNS public.challenge_team_squad
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_member record;
  v_row public.challenge_team_squad%ROWTYPE;
  v_status text := lower(COALESCE(p_availability_status, ''));
  v_requested_team_id uuid := p_team_id;
  v_requested_player_id public.jugadores.id%TYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF v_status NOT IN ('available', 'unavailable') THEN
    RAISE EXCEPTION 'Estado de disponibilidad inválido';
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

  IF v_requested_team_id IS NOT NULL
     AND v_requested_team_id IS DISTINCT FROM v_challenge.challenger_team_id
     AND v_requested_team_id IS DISTINCT FROM v_challenge.accepted_team_id THEN
    RAISE EXCEPTION 'team_id no pertenece al desafío';
  END IF;

  IF trim(COALESCE(p_player_id, '')) <> '' THEN
    SELECT j.id
    INTO v_requested_player_id
    FROM public.jugadores j
    WHERE j.id::text = trim(p_player_id)
    LIMIT 1;

    IF v_requested_player_id IS NULL THEN
      RAISE EXCEPTION 'Jugador inválido para convocatoria';
    END IF;
  END IF;

  PERFORM public.prepare_challenge_team_squad(p_challenge_id, true);

  SELECT
    tm.team_id,
    tm.jugador_id
  INTO v_member
  FROM public.team_members tm
  LEFT JOIN public.jugadores j ON j.id = tm.jugador_id
  WHERE tm.team_id IN (v_challenge.challenger_team_id, v_challenge.accepted_team_id)
    AND (
      tm.user_id = v_uid
      OR j.usuario_id = v_uid
    )
    AND (v_requested_team_id IS NULL OR tm.team_id = v_requested_team_id)
    AND (v_requested_player_id IS NULL OR tm.jugador_id = v_requested_player_id)
  ORDER BY
    CASE
      WHEN v_requested_team_id IS NOT NULL AND tm.team_id = v_requested_team_id THEN 0
      ELSE 1
    END,
    CASE
      WHEN v_requested_player_id IS NOT NULL AND tm.jugador_id = v_requested_player_id THEN 0
      ELSE 1
    END,
    tm.is_captain DESC,
    tm.created_at ASC
  LIMIT 1;

  IF v_member.team_id IS NULL OR v_member.jugador_id IS NULL THEN
    RAISE EXCEPTION 'No pertenecés al plantel de este desafío';
  END IF;

  INSERT INTO public.challenge_team_squad (
    challenge_id,
    team_id,
    player_id,
    availability_status,
    selection_status,
    approved_by_captain,
    responded_at,
    updated_at
  ) VALUES (
    p_challenge_id,
    v_member.team_id,
    v_member.jugador_id,
    v_status,
    'not_selected',
    false,
    now(),
    now()
  )
  ON CONFLICT (challenge_id, team_id, player_id)
  DO UPDATE SET
    availability_status = EXCLUDED.availability_status,
    responded_at = now(),
    selection_status = CASE
      WHEN EXCLUDED.availability_status = 'unavailable' THEN 'not_selected'
      ELSE public.challenge_team_squad.selection_status
    END,
    approved_by_captain = CASE
      WHEN EXCLUDED.availability_status = 'unavailable' THEN false
      ELSE public.challenge_team_squad.approved_by_captain
    END,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_set_challenge_availability(uuid, text, uuid, text) TO authenticated, service_role;
