BEGIN;

-- Harden bridge sync for large rosters: avoid bubbling technical slot errors
-- when syncing jugadores from team roster into partidos.
CREATE OR REPLACE FUNCTION public.sync_team_match_to_partido(
  p_team_match_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match public.team_matches%ROWTYPE;
  v_challenge public.challenges%ROWTYPE;
  v_team_a public.teams%ROWTYPE;
  v_team_b public.teams%ROWTYPE;
  v_owner_user_id uuid;
  v_partido_id bigint;
  v_match_at timestamptz;
  v_match_local timestamp;
  v_fecha date;
  v_hora text;
  v_modalidad text;
  v_tipo_partido text;
  v_sede text;
  v_nombre text;
  v_cupo integer;
  v_status text;
  v_is_played boolean;
  v_is_cancelled boolean;
  v_remaining_slots integer := 0;
BEGIN
  IF p_team_match_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.id = p_team_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_status := lower(COALESCE(v_match.status, ''));
  v_is_played := v_status = 'played';
  v_is_cancelled := v_status IN ('cancelled', 'canceled', 'cancelado');

  IF v_is_cancelled THEN
    IF v_match.partido_id IS NOT NULL THEN
      UPDATE public.partidos p
      SET
        estado = 'cancelado',
        surveys_sent = true
      WHERE p.id = v_match.partido_id;
    END IF;
    RETURN v_match.partido_id;
  END IF;

  IF v_match.team_a_id IS NULL OR v_match.team_b_id IS NULL THEN
    RETURN v_match.partido_id;
  END IF;

  SELECT *
  INTO v_team_a
  FROM public.teams t
  WHERE t.id = v_match.team_a_id;

  SELECT *
  INTO v_team_b
  FROM public.teams t
  WHERE t.id = v_match.team_b_id;

  IF v_team_a.id IS NULL OR v_team_b.id IS NULL THEN
    RETURN v_match.partido_id;
  END IF;

  IF v_match.challenge_id IS NOT NULL THEN
    SELECT *
    INTO v_challenge
    FROM public.challenges c
    WHERE c.id = v_match.challenge_id;
  END IF;

  v_owner_user_id := COALESCE(v_challenge.created_by_user_id, v_team_a.owner_user_id, v_team_b.owner_user_id);

  IF v_is_played THEN
    v_match_at := COALESCE(v_match.played_at, v_match.scheduled_at, now());
  ELSE
    v_match_at := COALESCE(v_match.scheduled_at, v_match.played_at, now());
  END IF;
  v_match_local := timezone('America/Argentina/Buenos_Aires', v_match_at)::timestamp;
  v_fecha := v_match_local::date;
  v_hora := to_char(v_match_local::time, 'HH24:MI');

  v_modalidad := 'F' || COALESCE(v_match.format::text, '5');
  v_cupo := GREATEST(2, COALESCE(v_match.format, 5) * 2);

  v_tipo_partido := initcap(NULLIF(btrim(COALESCE(v_match.mode, '')), ''));
  IF v_tipo_partido IS NULL THEN
    v_tipo_partido := 'Masculino';
  END IF;

  v_sede := NULLIF(btrim(COALESCE(v_match.location, v_match.location_name, '')), '');
  IF v_sede IS NULL THEN
    v_sede := 'A coordinar';
  END IF;

  v_nombre := format(
    'Desafio: %s vs %s',
    COALESCE(NULLIF(v_team_a.name, ''), 'Equipo A'),
    COALESCE(NULLIF(v_team_b.name, ''), 'Equipo B')
  );

  IF v_match.partido_id IS NOT NULL THEN
    UPDATE public.partidos p
    SET
      nombre = v_nombre,
      fecha = v_fecha,
      hora = v_hora,
      sede = v_sede,
      modalidad = v_modalidad,
      tipo_partido = v_tipo_partido,
      cupo_jugadores = v_cupo,
      falta_jugadores = false,
      precio_cancha_por_persona = v_match.cancha_cost,
      creado_por = COALESCE(p.creado_por, v_owner_user_id),
      estado = CASE WHEN v_is_played THEN 'finalizado' ELSE 'active' END,
      surveys_sent = CASE
        WHEN v_is_played THEN COALESCE(p.surveys_sent, false)
        ELSE false
      END
    WHERE p.id = v_match.partido_id
    RETURNING p.id INTO v_partido_id;
  END IF;

  IF v_partido_id IS NULL THEN
    INSERT INTO public.partidos (
      nombre,
      fecha,
      hora,
      sede,
      modalidad,
      tipo_partido,
      cupo_jugadores,
      falta_jugadores,
      precio_cancha_por_persona,
      creado_por,
      estado,
      surveys_sent
    ) VALUES (
      v_nombre,
      v_fecha,
      v_hora,
      v_sede,
      v_modalidad,
      v_tipo_partido,
      v_cupo,
      false,
      v_match.cancha_cost,
      v_owner_user_id,
      CASE WHEN v_is_played THEN 'finalizado' ELSE 'active' END,
      false
    )
    RETURNING id INTO v_partido_id;

    UPDATE public.team_matches tm
    SET partido_id = v_partido_id
    WHERE tm.id = v_match.id;
  END IF;

  BEGIN
    WITH source_rows AS (
      SELECT
        tm.id AS team_member_id,
        tm.team_id,
        j.id AS source_player_id,
        COALESCE(
          CASE
            WHEN NULLIF(to_jsonb(tm)->>'user_id', '') IS NOT NULL
              THEN NULLIF(to_jsonb(tm)->>'user_id', '')::uuid
            ELSE NULL::uuid
          END,
          j.usuario_id
        ) AS usuario_id,
        j.uuid AS source_uuid,
        COALESCE(NULLIF(u.nombre, ''), NULLIF(j.nombre, ''), 'Jugador') AS nombre,
        COALESCE(
          NULLIF(to_jsonb(tm)->>'photo_url', ''),
          NULLIF(u.avatar_url, ''),
          NULLIF(j.avatar_url, '')
        ) AS avatar_url,
        COALESCE(j.score, 5) AS score,
        (lower(COALESCE(tm.role, '')) = 'gk') AS is_goalkeeper
      FROM public.team_members tm
      JOIN public.jugadores j
        ON j.id = tm.jugador_id
      LEFT JOIN public.usuarios u
        ON u.id = COALESCE(
          CASE
            WHEN NULLIF(to_jsonb(tm)->>'user_id', '') IS NOT NULL
              THEN NULLIF(to_jsonb(tm)->>'user_id', '')::uuid
            ELSE NULL::uuid
          END,
          j.usuario_id
        )
      WHERE tm.team_id IN (v_match.team_a_id, v_match.team_b_id)
    ),
    dedup_users AS (
      SELECT DISTINCT ON (sr.usuario_id)
        sr.usuario_id,
        sr.nombre,
        sr.avatar_url,
        sr.score,
        sr.is_goalkeeper
      FROM source_rows sr
      WHERE sr.usuario_id IS NOT NULL
      ORDER BY sr.usuario_id, sr.team_member_id
    )
    INSERT INTO public.jugadores (
      partido_id,
      usuario_id,
      uuid,
      nombre,
      avatar_url,
      score,
      is_goalkeeper
    )
    SELECT
      v_partido_id,
      du.usuario_id,
      du.usuario_id,
      du.nombre,
      du.avatar_url,
      du.score,
      du.is_goalkeeper
    FROM dedup_users du
    ON CONFLICT (partido_id, usuario_id)
      WHERE usuario_id IS NOT NULL
    DO UPDATE SET
      nombre = EXCLUDED.nombre,
      avatar_url = COALESCE(EXCLUDED.avatar_url, public.jugadores.avatar_url),
      score = COALESCE(EXCLUDED.score, public.jugadores.score),
      is_goalkeeper = EXCLUDED.is_goalkeeper;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'MATCH_FULL_WITH_SUBSTITUTES' THEN
        RAISE;
      END IF;
  END;

  SELECT GREATEST(v_cupo - COUNT(*), 0)::integer
  INTO v_remaining_slots
  FROM public.jugadores j
  WHERE j.partido_id = v_partido_id;

  IF v_remaining_slots > 0 THEN
    BEGIN
      WITH source_rows AS (
        SELECT
          tm.id AS team_member_id,
          tm.team_id,
          j.id AS source_player_id,
          COALESCE(
            CASE
              WHEN NULLIF(to_jsonb(tm)->>'user_id', '') IS NOT NULL
                THEN NULLIF(to_jsonb(tm)->>'user_id', '')::uuid
              ELSE NULL::uuid
            END,
            j.usuario_id
          ) AS usuario_id,
          j.uuid AS source_uuid,
          COALESCE(NULLIF(u.nombre, ''), NULLIF(j.nombre, ''), 'Jugador') AS nombre,
          COALESCE(
            NULLIF(to_jsonb(tm)->>'photo_url', ''),
            NULLIF(u.avatar_url, ''),
            NULLIF(j.avatar_url, '')
          ) AS avatar_url,
          COALESCE(j.score, 5) AS score,
          (lower(COALESCE(tm.role, '')) = 'gk') AS is_goalkeeper
        FROM public.team_members tm
        JOIN public.jugadores j
          ON j.id = tm.jugador_id
        LEFT JOIN public.usuarios u
          ON u.id = COALESCE(
            CASE
              WHEN NULLIF(to_jsonb(tm)->>'user_id', '') IS NOT NULL
                THEN NULLIF(to_jsonb(tm)->>'user_id', '')::uuid
              ELSE NULL::uuid
            END,
            j.usuario_id
          )
        WHERE tm.team_id IN (v_match.team_a_id, v_match.team_b_id)
      ),
      dedup_guests AS (
        SELECT DISTINCT ON (COALESCE(sr.source_uuid::text, format('team_member:%s', sr.team_member_id::text)))
          sr.team_member_id,
          sr.source_uuid,
          sr.nombre,
          sr.avatar_url,
          sr.score,
          sr.is_goalkeeper
        FROM source_rows sr
        WHERE sr.usuario_id IS NULL
        ORDER BY COALESCE(sr.source_uuid::text, format('team_member:%s', sr.team_member_id::text)), sr.team_member_id
      ),
      prepared_guests AS (
        SELECT
          dg.team_member_id,
          dg.nombre,
          dg.avatar_url,
          dg.score,
          dg.is_goalkeeper,
          row_number() OVER (ORDER BY dg.team_member_id) AS rn,
          COALESCE(
            dg.source_uuid,
            (
              substr(hash_value, 1, 8) || '-' ||
              substr(hash_value, 9, 4) || '-' ||
              '4' || substr(hash_value, 14, 3) || '-' ||
              'a' || substr(hash_value, 18, 3) || '-' ||
              substr(hash_value, 21, 12)
            )::uuid
          ) AS resolved_uuid
        FROM (
          SELECT
            dg.*,
            md5(format('%s:%s', p_team_match_id::text, dg.team_member_id::text)) AS hash_value
          FROM dedup_guests dg
        ) dg
      )
      INSERT INTO public.jugadores (
        partido_id,
        usuario_id,
        uuid,
        nombre,
        avatar_url,
        score,
        is_goalkeeper
      )
      SELECT
        v_partido_id,
        NULL,
        pg.resolved_uuid,
        pg.nombre,
        pg.avatar_url,
        pg.score,
        pg.is_goalkeeper
      FROM prepared_guests pg
      WHERE pg.rn <= v_remaining_slots
      ON CONFLICT (partido_id, uuid)
        WHERE uuid IS NOT NULL
      DO UPDATE SET
        nombre = EXCLUDED.nombre,
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.jugadores.avatar_url),
        score = COALESCE(EXCLUDED.score, public.jugadores.score),
        is_goalkeeper = EXCLUDED.is_goalkeeper;
    EXCEPTION
      WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'MATCH_FULL_WITH_SUBSTITUTES' THEN
          RAISE;
        END IF;
    END;
  END IF;

  RETURN v_partido_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_team_match_to_partido(uuid) TO authenticated, service_role;

-- Ensure cancellation notifies all involved players (both teams) with human-readable context.
CREATE OR REPLACE FUNCTION public.rpc_cancel_team_match(
  p_match_id uuid
)
RETURNS public.team_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.team_matches%ROWTYPE;
  v_team_a public.teams%ROWTYPE;
  v_team_b public.teams%ROWTYPE;
  v_cancelled_by_team_id uuid;
  v_cancelled_by_team_name text;
  v_team_a_name text;
  v_team_b_name text;
  v_notification_message text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF NOT public.team_match_user_is_admin_or_owner(p_match_id, v_uid) THEN
    RAISE EXCEPTION 'Solo owner/admin de los equipos puede cancelar este partido';
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido no encontrado';
  END IF;

  IF lower(COALESCE(v_match.status, '')) = 'played' THEN
    RAISE EXCEPTION 'No se puede cancelar un partido ya jugado';
  END IF;

  IF lower(COALESCE(v_match.status, '')) IN ('cancelled', 'canceled', 'cancelado') THEN
    RETURN v_match;
  END IF;

  UPDATE public.team_matches tm
  SET
    status = 'cancelled',
    updated_at = now()
  WHERE tm.id = p_match_id
  RETURNING * INTO v_match;

  IF v_match.challenge_id IS NOT NULL THEN
    UPDATE public.challenges c
    SET
      status = 'canceled',
      updated_at = now()
    WHERE c.id = v_match.challenge_id
      AND c.status <> 'completed';
  END IF;

  SELECT *
  INTO v_team_a
  FROM public.teams t
  WHERE t.id = v_match.team_a_id;

  SELECT *
  INTO v_team_b
  FROM public.teams t
  WHERE t.id = v_match.team_b_id;

  v_team_a_name := COALESCE(NULLIF(v_team_a.name, ''), 'Equipo A');
  v_team_b_name := COALESCE(NULLIF(v_team_b.name, ''), 'Equipo B');

  SELECT tm.team_id
  INTO v_cancelled_by_team_id
  FROM public.team_members tm
  WHERE tm.user_id = v_uid
    AND tm.team_id IN (v_match.team_a_id, v_match.team_b_id)
    AND lower(COALESCE(tm.permissions_role, '')) IN ('owner', 'admin')
  ORDER BY CASE WHEN tm.team_id = v_match.team_a_id THEN 0 ELSE 1 END, tm.created_at
  LIMIT 1;

  IF v_cancelled_by_team_id IS NULL THEN
    IF v_team_a.owner_user_id = v_uid THEN
      v_cancelled_by_team_id := v_team_a.id;
    ELSIF v_team_b.owner_user_id = v_uid THEN
      v_cancelled_by_team_id := v_team_b.id;
    END IF;
  END IF;

  IF v_cancelled_by_team_id = v_team_a.id THEN
    v_cancelled_by_team_name := v_team_a_name;
  ELSIF v_cancelled_by_team_id = v_team_b.id THEN
    v_cancelled_by_team_name := v_team_b_name;
  ELSE
    v_cancelled_by_team_name := 'uno de los equipos';
  END IF;

  v_notification_message := format(
    'El capitán de "%s" canceló el partido %s vs %s.',
    v_cancelled_by_team_name,
    v_team_a_name,
    v_team_b_name
  );

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, data, read, created_at)
    SELECT
      recipients.user_id,
      'match_cancelled',
      'Partido cancelado',
      v_notification_message,
      jsonb_build_object(
        'team_match_id', v_match.id,
        'challenge_id', v_match.challenge_id,
        'origin_type', 'challenge',
        'match_id', v_match.partido_id,
        'partido_id', v_match.partido_id,
        'cancelled_by_team_id', v_cancelled_by_team_id,
        'cancelled_by_team_name', v_cancelled_by_team_name,
        'team_a_name', v_team_a_name,
        'team_b_name', v_team_b_name,
        'link', '/desafios/equipos/partidos/' || v_match.id::text,
        'source', 'team_challenge'
      ),
      false,
      now()
    FROM (
      SELECT DISTINCT user_id
      FROM (
        SELECT t.owner_user_id AS user_id
        FROM public.teams t
        WHERE t.id IN (v_match.team_a_id, v_match.team_b_id)

        UNION ALL

        SELECT tm.user_id
        FROM public.team_members tm
        WHERE tm.team_id IN (v_match.team_a_id, v_match.team_b_id)
          AND tm.user_id IS NOT NULL

        UNION ALL

        SELECT j.usuario_id
        FROM public.team_members tm
        JOIN public.jugadores j ON j.id = tm.jugador_id
        WHERE tm.team_id IN (v_match.team_a_id, v_match.team_b_id)
          AND j.usuario_id IS NOT NULL
      ) raw_members
      WHERE user_id IS NOT NULL
    ) recipients;
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  RETURN v_match;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_cancel_team_match(uuid) TO authenticated, service_role;

COMMIT;
