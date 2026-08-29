BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_confirm_challenge(
  p_challenge_id uuid
)
RETURNS public.challenges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_accepted_format smallint;
  v_is_format_combined boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  IF v_challenge.status <> 'accepted' THEN
    RAISE EXCEPTION 'Solo se pueden confirmar challenges en estado accepted';
  END IF;

  IF NOT public.challenge_user_is_owner_or_captain(p_challenge_id, v_uid) THEN
    RAISE EXCEPTION 'Solo owner/capitan involucrado puede confirmar';
  END IF;

  IF v_challenge.accepted_team_id IS NULL THEN
    RAISE EXCEPTION 'Challenge sin equipo rival';
  END IF;

  SELECT t.format
  INTO v_accepted_format
  FROM public.teams t
  WHERE t.id = v_challenge.accepted_team_id;

  IF v_accepted_format IS NOT NULL THEN
    v_is_format_combined := (v_accepted_format <> v_challenge.format);
  END IF;

  UPDATE public.challenges c
  SET
    status = 'confirmed',
    updated_at = now()
  WHERE c.id = p_challenge_id
  RETURNING * INTO v_challenge;

  INSERT INTO public.team_matches (
    origin_type,
    challenge_id,
    team_a_id,
    team_b_id,
    format,
    mode,
    scheduled_at,
    location,
    cancha_cost,
    status,
    is_format_combined,
    location_name,
    updated_at
  ) VALUES (
    'challenge',
    v_challenge.id,
    v_challenge.challenger_team_id,
    v_challenge.accepted_team_id,
    v_challenge.format,
    v_challenge.mode,
    v_challenge.scheduled_at,
    COALESCE(v_challenge.location, v_challenge.location_name),
    COALESCE(v_challenge.cancha_cost, v_challenge.field_price),
    'confirmed',
    v_is_format_combined,
    COALESCE(v_challenge.location, v_challenge.location_name),
    now()
  )
  ON CONFLICT (challenge_id) WHERE challenge_id IS NOT NULL
  DO UPDATE SET
    origin_type = 'challenge',
    team_a_id = EXCLUDED.team_a_id,
    team_b_id = EXCLUDED.team_b_id,
    format = EXCLUDED.format,
    mode = EXCLUDED.mode,
    scheduled_at = EXCLUDED.scheduled_at,
    location = EXCLUDED.location,
    cancha_cost = EXCLUDED.cancha_cost,
    status = CASE
      WHEN public.team_matches.status IN ('played', 'cancelled') THEN public.team_matches.status
      ELSE 'confirmed'
    END,
    is_format_combined = EXCLUDED.is_format_combined,
    location_name = EXCLUDED.location_name,
    updated_at = now();

  RETURN v_challenge;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_confirm_challenge(uuid) TO authenticated, service_role;

COMMIT;
