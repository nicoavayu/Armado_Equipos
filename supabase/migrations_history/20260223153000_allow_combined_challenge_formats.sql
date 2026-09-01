BEGIN;

-- Allow accepted challenges with mixed formats (challenge format stays as owner team format).
CREATE OR REPLACE FUNCTION public.validate_challenge_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := auth.role();
  v_is_service_role boolean := COALESCE(v_role, '') = 'service_role';
  v_challenger_format smallint;
  v_accepted_format smallint;
BEGIN
  SELECT t.format
  INTO v_challenger_format
  FROM public.teams t
  WHERE t.id = NEW.challenger_team_id;

  IF v_challenger_format IS NULL THEN
    RAISE EXCEPTION 'challenger_team_id invalido';
  END IF;

  IF NEW.format <> v_challenger_format THEN
    RAISE EXCEPTION 'challenge.format debe coincidir con teams.format del challenger';
  END IF;

  IF NEW.accepted_team_id IS NOT NULL THEN
    SELECT t.format
    INTO v_accepted_format
    FROM public.teams t
    WHERE t.id = NEW.accepted_team_id;

    IF v_accepted_format IS NULL THEN
      RAISE EXCEPTION 'accepted_team_id invalido';
    END IF;

    IF NEW.accepted_team_id = NEW.challenger_team_id THEN
      RAISE EXCEPTION 'challenger_team_id y accepted_team_id no pueden ser iguales';
    END IF;
  END IF;

  IF NEW.status = 'open' THEN
    IF NEW.accepted_team_id IS NOT NULL OR NEW.accepted_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'challenges open no pueden tener accepted_team_id/accepted_by_user_id';
    END IF;
  END IF;

  IF NEW.status IN ('accepted', 'confirmed', 'completed')
     AND (NEW.accepted_team_id IS NULL OR NEW.accepted_by_user_id IS NULL) THEN
    RAISE EXCEPTION 'status % requiere accepted_team_id y accepted_by_user_id', NEW.status;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_service_role THEN
      IF v_uid IS NULL THEN
        RAISE EXCEPTION 'usuario no autenticado';
      END IF;

      IF NOT public.team_user_is_owner(NEW.challenger_team_id, v_uid) THEN
        RAISE EXCEPTION 'solo owner del challenger_team puede crear el challenge';
      END IF;

      IF NEW.status <> 'open' THEN
        RAISE EXCEPTION 'challenge inicial debe ser open';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF OLD.status IN ('completed', 'canceled') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'no se puede cambiar estado desde %', OLD.status;
  END IF;

  IF OLD.accepted_team_id IS NOT NULL
     AND NEW.accepted_team_id IS DISTINCT FROM OLD.accepted_team_id THEN
    RAISE EXCEPTION 'accepted_team_id no puede cambiar una vez asignado';
  END IF;

  IF OLD.accepted_by_user_id IS NOT NULL
     AND NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id THEN
    RAISE EXCEPTION 'accepted_by_user_id no puede cambiar una vez asignado';
  END IF;

  IF OLD.status <> NEW.status THEN
    IF OLD.status = 'open' AND NEW.status = 'accepted' THEN
      IF NOT v_is_service_role THEN
        IF v_uid IS NULL THEN
          RAISE EXCEPTION 'usuario no autenticado';
        END IF;

        IF NEW.accepted_by_user_id IS DISTINCT FROM v_uid THEN
          RAISE EXCEPTION 'accepted_by_user_id debe ser auth.uid()';
        END IF;

        IF public.team_user_is_admin_or_owner(OLD.challenger_team_id, v_uid) THEN
          RAISE EXCEPTION 'el equipo challenger no puede autoaceptar su propio desafio';
        END IF;

        IF NOT public.team_user_is_admin_or_owner(NEW.accepted_team_id, v_uid) THEN
          RAISE EXCEPTION 'solo owner/admin del accepted_team puede aceptar';
        END IF;
      END IF;

    ELSIF OLD.status = 'accepted' AND NEW.status = 'confirmed' THEN
      IF NOT v_is_service_role THEN
        IF v_uid IS NULL OR NOT public.challenge_user_is_owner_or_captain(OLD.id, v_uid) THEN
          RAISE EXCEPTION 'solo owner/capitan involucrado puede confirmar';
        END IF;
      END IF;

    ELSIF OLD.status = 'confirmed' AND NEW.status = 'completed' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.team_matches tm
        WHERE tm.challenge_id = OLD.id
      ) THEN
        RAISE EXCEPTION 'no se puede completar challenge sin team_match';
      END IF;

      IF NOT v_is_service_role THEN
        IF v_uid IS NULL OR NOT public.challenge_user_is_owner_or_captain(OLD.id, v_uid) THEN
          RAISE EXCEPTION 'solo owner/capitan involucrado puede completar';
        END IF;
      END IF;

    ELSIF NEW.status = 'canceled' AND OLD.status IN ('open', 'accepted', 'confirmed') THEN
      IF NOT v_is_service_role THEN
        IF v_uid IS NULL OR NOT public.challenge_user_is_owner_or_captain(OLD.id, v_uid) THEN
          RAISE EXCEPTION 'solo owner/capitan involucrado puede cancelar';
        END IF;
      END IF;

    ELSE
      RAISE EXCEPTION 'transicion de estado invalida: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Allow challenge-origin team_matches to keep challenge format even if team_b has another format.
CREATE OR REPLACE FUNCTION public.validate_team_match_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_challenge public.challenges%ROWTYPE;
  v_team_a_format smallint;
  v_team_b_format smallint;
BEGIN
  SELECT t.format INTO v_team_a_format FROM public.teams t WHERE t.id = NEW.team_a_id;
  SELECT t.format INTO v_team_b_format FROM public.teams t WHERE t.id = NEW.team_b_id;

  IF v_team_a_format IS NULL OR v_team_b_format IS NULL THEN
    RAISE EXCEPTION 'team_a_id/team_b_id invalidos';
  END IF;

  IF NEW.challenge_id IS NULL THEN
    IF NEW.format <> v_team_a_format OR NEW.format <> v_team_b_format THEN
      RAISE EXCEPTION 'team_matches.format debe coincidir con formato de ambos equipos';
    END IF;
  END IF;

  IF NEW.challenge_id IS NOT NULL THEN
    SELECT *
    INTO v_challenge
    FROM public.challenges c
    WHERE c.id = NEW.challenge_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'challenge_id invalido';
    END IF;

    IF v_challenge.accepted_team_id IS NULL THEN
      RAISE EXCEPTION 'challenge_id no tiene rival aceptado';
    END IF;

    IF v_challenge.status NOT IN ('accepted', 'confirmed', 'completed') THEN
      RAISE EXCEPTION 'challenge_id debe estar aceptado para registrar team_match';
    END IF;

    IF NEW.team_a_id <> v_challenge.challenger_team_id
       OR NEW.team_b_id <> v_challenge.accepted_team_id THEN
      RAISE EXCEPTION 'team_matches debe usar los equipos del challenge';
    END IF;

    IF NEW.format <> v_challenge.format THEN
      RAISE EXCEPTION 'team_matches.format debe coincidir con challenges.format';
    END IF;

    IF NEW.format <> v_team_a_format THEN
      RAISE EXCEPTION 'team_matches.format debe coincidir con formato del challenger';
    END IF;

    NEW.is_format_combined := (v_team_b_format <> NEW.format);

    IF TG_OP = 'INSERT'
       AND EXISTS (
         SELECT 1 FROM public.team_matches tm WHERE tm.challenge_id = NEW.challenge_id
       )
    THEN
      RAISE EXCEPTION 'ya existe un team_match para este challenge';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.challenge_id IS DISTINCT FROM NEW.challenge_id
       AND EXISTS (
         SELECT 1 FROM public.team_matches tm WHERE tm.challenge_id = NEW.challenge_id
       )
    THEN
      RAISE EXCEPTION 'ya existe un team_match para este challenge';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF OLD.status = 'played' AND NEW.status <> 'played' THEN
      RAISE EXCEPTION 'no se puede cambiar estado desde played';
    END IF;

    IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
      RAISE EXCEPTION 'no se puede cambiar estado desde cancelled';
    END IF;

    IF OLD.status = 'pending' AND NEW.status NOT IN ('pending', 'confirmed', 'played', 'cancelled') THEN
      RAISE EXCEPTION 'transicion de estado invalida: % -> %', OLD.status, NEW.status;
    END IF;

    IF OLD.status = 'confirmed' AND NEW.status NOT IN ('pending', 'confirmed', 'played', 'cancelled') THEN
      RAISE EXCEPTION 'transicion de estado invalida: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;

  IF NEW.status = 'played' THEN
    NEW.played_at := COALESCE(NEW.played_at, NEW.scheduled_at, now());
  END IF;

  NEW.location_name := COALESCE(NULLIF(btrim(COALESCE(NEW.location, '')), ''), NEW.location_name);

  RETURN NEW;
END;
$$;

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

  IF v_challenge.status <> 'open' THEN
    RAISE EXCEPTION 'Solo se pueden aceptar challenges en estado open';
  END IF;

  IF v_challenge.challenger_team_id = p_accepted_team_id THEN
    RAISE EXCEPTION 'Un equipo no puede aceptarse a si mismo';
  END IF;

  IF public.team_user_is_admin_or_owner(v_challenge.challenger_team_id, v_uid) THEN
    RAISE EXCEPTION 'No podes aceptar un challenge propio';
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

  challenge_id := v_challenge.id;
  match_id := v_match.id;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_accept_challenge(uuid, uuid) TO authenticated, service_role;

COMMIT;
