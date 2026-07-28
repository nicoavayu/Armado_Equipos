BEGIN;

DROP FUNCTION IF EXISTS public.rpc_accept_challenge(uuid, uuid);
CREATE OR REPLACE FUNCTION public.rpc_accept_challenge(
  p_challenge_id uuid,
  p_accepted_team_id uuid
)
RETURNS TABLE(challenge_id uuid, match_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_match public.team_matches%ROWTYPE;
  v_accepted_format smallint;
  v_is_format_combined boolean := false;
  v_challenger_name text;
  v_accepted_name text;
  v_accept_message text;
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

  IF v_challenge.challenger_team_id = p_accepted_team_id THEN
    RAISE EXCEPTION 'Un equipo no puede aceptarse a si mismo';
  END IF;

  IF NOT public.team_user_is_admin_or_owner(p_accepted_team_id, v_uid) THEN
    RAISE EXCEPTION 'Solo owner/admin del equipo rival puede aceptar';
  END IF;

  SELECT t.format
  INTO v_accepted_format
  FROM public.teams t
  WHERE t.id = p_accepted_team_id
    AND t.is_active = true;

  IF v_accepted_format IS NULL THEN
    RAISE EXCEPTION 'Equipo inactivo o invalido para aceptar challenge';
  END IF;

  v_is_format_combined := (v_accepted_format <> v_challenge.format);

  -- Idempotent retry path: if challenge was already accepted by this same team,
  -- return the existing/upserted match instead of failing.
  IF v_challenge.status IN ('accepted', 'confirmed', 'completed') THEN
    IF v_challenge.accepted_team_id IS DISTINCT FROM p_accepted_team_id THEN
      RAISE EXCEPTION 'Challenge ya fue aceptado por otro equipo';
    END IF;

    SELECT *
    INTO v_match
    FROM public.team_matches tm
    WHERE tm.challenge_id = v_challenge.id
    ORDER BY tm.created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
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
        CASE
          WHEN v_challenge.status = 'completed' THEN 'played'
          WHEN v_challenge.status = 'confirmed' THEN 'confirmed'
          ELSE 'pending'
        END,
        v_is_format_combined,
        COALESCE(v_challenge.location, v_challenge.location_name),
        now()
      )
      RETURNING * INTO v_match;
    END IF;

    challenge_id := v_challenge.id;
    match_id := v_match.id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_challenge.status <> 'open' THEN
    RAISE EXCEPTION 'Solo se pueden aceptar challenges en estado open';
  END IF;

  UPDATE public.challenges c
  SET
    status = 'accepted',
    accepted_team_id = p_accepted_team_id,
    accepted_by_user_id = v_uid,
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
    'pending',
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
      ELSE 'pending'
    END,
    is_format_combined = EXCLUDED.is_format_combined,
    location_name = EXCLUDED.location_name,
    updated_at = now()
  RETURNING * INTO v_match;

  -- Notifications should never rollback acceptance.
  BEGIN
    SELECT t.name INTO v_challenger_name FROM public.teams t WHERE t.id = v_challenge.challenger_team_id;
    SELECT t.name INTO v_accepted_name FROM public.teams t WHERE t.id = v_challenge.accepted_team_id;

    v_accept_message := format(
      'El desafio entre %s y %s fue aceptado. Ya pueden coordinar la cancha.',
      COALESCE(NULLIF(v_challenger_name, ''), 'Equipo A'),
      COALESCE(NULLIF(v_accepted_name, ''), 'Equipo B')
    );

    INSERT INTO public.notifications (user_id, type, title, message, data, read, created_at)
    SELECT
      recipients.user_id,
      notification_type.type,
      notification_type.title,
      CASE
        WHEN notification_type.type = 'challenge_accepted' THEN v_accept_message
        ELSE format('Se creo el partido para %s vs %s.', COALESCE(NULLIF(v_challenger_name, ''), 'Equipo A'), COALESCE(NULLIF(v_accepted_name, ''), 'Equipo B'))
      END,
      jsonb_build_object(
        'challenge_id', v_challenge.id,
        'team_match_id', v_match.id,
        'origin_type', 'challenge',
        'link', '/quiero-jugar/equipos/partidos/' || v_match.id::text
      ),
      false,
      now()
    FROM (
      SELECT DISTINCT user_id
      FROM (
        SELECT t.owner_user_id AS user_id
        FROM public.teams t
        WHERE t.id IN (v_challenge.challenger_team_id, v_challenge.accepted_team_id)

        UNION ALL

        SELECT tm.user_id
        FROM public.team_members tm
        WHERE tm.team_id IN (v_challenge.challenger_team_id, v_challenge.accepted_team_id)
          AND tm.user_id IS NOT NULL

        UNION ALL

        SELECT j.usuario_id
        FROM public.team_members tm
        JOIN public.jugadores j ON j.id = tm.jugador_id
        WHERE tm.team_id IN (v_challenge.challenger_team_id, v_challenge.accepted_team_id)
          AND j.usuario_id IS NOT NULL
      ) raw_members
      WHERE user_id IS NOT NULL
    ) recipients
    CROSS JOIN (
      VALUES
        ('challenge_accepted'::text, 'Desafio aceptado'::text),
        ('team_match_created'::text, 'Partido creado'::text)
    ) AS notification_type(type, title);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  challenge_id := v_challenge.id;
  match_id := v_match.id;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_accept_challenge(uuid, uuid) TO authenticated, service_role;

COMMIT;
