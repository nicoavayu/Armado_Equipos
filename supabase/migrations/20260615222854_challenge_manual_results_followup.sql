-- Follow-up for challenge manual results.
-- 20260615120000 is already applied in Remote; keep it immutable and replace
-- only the RPC behavior here.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_report_challenge_result(
  p_challenge_id uuid,
  p_result_status text
)
RETURNS public.team_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_match public.team_matches%ROWTYPE;
  v_reporter_team_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_result_status IS NULL OR p_result_status NOT IN ('team_a_win', 'team_b_win', 'draw') THEN
    RAISE EXCEPTION 'Resultado invalido';
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
    RAISE EXCEPTION 'Challenge sin equipo rival';
  END IF;

  IF v_challenge.status NOT IN ('accepted', 'confirmed', 'completed') THEN
    RAISE EXCEPTION 'Solo se puede cargar el resultado en desafios confirmados';
  END IF;

  IF v_challenge.status = 'accepted'
     AND (v_challenge.scheduled_at IS NULL OR v_challenge.scheduled_at > now()) THEN
    RAISE EXCEPTION 'Solo se puede cargar el resultado cuando el desafio ya se jugo';
  END IF;

  IF NOT (
    public.team_user_is_admin_or_owner(v_challenge.challenger_team_id, v_uid)
    OR public.team_user_is_admin_or_owner(v_challenge.accepted_team_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'Solo owner/capitan/admin involucrado puede cargar el resultado';
  END IF;

  -- Determine which side reported the result (metadata only; nullable).
  IF public.team_user_is_admin_or_owner(v_challenge.challenger_team_id, v_uid) THEN
    v_reporter_team_id := v_challenge.challenger_team_id;
  ELSIF public.team_user_is_admin_or_owner(v_challenge.accepted_team_id, v_uid) THEN
    v_reporter_team_id := v_challenge.accepted_team_id;
  ELSE
    v_reporter_team_id := NULL;
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.challenge_id = p_challenge_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.team_matches tm
    SET
      status = 'played',
      played_at = COALESCE(tm.played_at, tm.scheduled_at, now()),
      result_status = p_result_status,
      result_reported_by_team_id = COALESCE(v_reporter_team_id, tm.result_reported_by_team_id),
      result_reported_at = COALESCE(tm.result_reported_at, now()),
      result_updated_at = now(),
      updated_at = now()
    WHERE tm.id = v_match.id
    RETURNING * INTO v_match;
  ELSE
    INSERT INTO public.team_matches (
      origin_type,
      challenge_id,
      team_a_id,
      team_b_id,
      played_at,
      scheduled_at,
      format,
      mode,
      location,
      location_name,
      status,
      result_status,
      result_reported_by_team_id,
      result_reported_at,
      result_updated_at,
      updated_at
    ) VALUES (
      'challenge',
      v_challenge.id,
      v_challenge.challenger_team_id,
      v_challenge.accepted_team_id,
      now(),
      COALESCE(v_challenge.scheduled_at, now()),
      v_challenge.format,
      v_challenge.mode,
      COALESCE(v_challenge.location, v_challenge.location_name),
      COALESCE(v_challenge.location, v_challenge.location_name),
      'played',
      p_result_status,
      v_reporter_team_id,
      now(),
      now(),
      now()
    )
    RETURNING * INTO v_match;
  END IF;

  UPDATE public.challenges c
  SET
    status = 'completed',
    updated_at = now()
  WHERE c.id = p_challenge_id
    AND c.status <> 'completed';

  RETURN v_match;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_report_challenge_result(uuid, text) TO authenticated, service_role;

COMMIT;
