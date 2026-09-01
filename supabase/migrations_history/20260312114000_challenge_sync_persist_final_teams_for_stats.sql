BEGIN;

-- Ensure challenge -> partido sync persists enough roster/result metadata for user stats
-- (W/D/L assignment needs resolved final teams).
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
  v_team_a_refs text[] := ARRAY[]::text[];
  v_team_b_refs text[] := ARRAY[]::text[];
  v_result_status text := 'pending';
  v_winner_team text := NULL;
  v_finished_at timestamptz := NULL;
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

  IF v_is_played THEN
    IF COALESCE(v_match.score_a, 0) = COALESCE(v_match.score_b, 0) THEN
      v_result_status := 'draw';
      v_winner_team := 'empate';
    ELSIF COALESCE(v_match.score_a, 0) > COALESCE(v_match.score_b, 0) THEN
      v_result_status := 'finished';
      v_winner_team := 'A';
    ELSE
      v_result_status := 'finished';
      v_winner_team := 'B';
    END IF;
    v_finished_at := COALESCE(v_match.played_at, v_match.scheduled_at, now());
  ELSIF v_is_cancelled THEN
    v_result_status := 'not_played';
    v_winner_team := NULL;
    v_finished_at := now();
  ELSE
    v_result_status := 'pending';
    v_winner_team := NULL;
    v_finished_at := NULL;
  END IF;

  IF v_is_cancelled THEN
    IF v_match.partido_id IS NOT NULL THEN
      UPDATE public.partidos p
      SET
        estado = 'cancelado',
        surveys_sent = true,
        survey_status = COALESCE(p.survey_status, 'closed'),
        result_status = CASE
          WHEN COALESCE(p.result_status, 'pending') = 'pending' THEN v_result_status
          ELSE p.result_status
        END,
        winner_team = CASE
          WHEN COALESCE(p.result_status, 'pending') = 'pending' THEN NULL
          ELSE p.winner_team
        END,
        finished_at = COALESCE(p.finished_at, v_finished_at)
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

  -- Resolve final roster refs per team so stats can map user -> team (A/B).
  WITH source_rows AS (
    SELECT
      tm.team_id,
      NULLIF(
        COALESCE(
          NULLIF(to_jsonb(tm)->>'user_id', ''),
          CASE WHEN j.usuario_id IS NOT NULL THEN j.usuario_id::text ELSE NULL END,
          CASE WHEN j.uuid IS NOT NULL THEN j.uuid::text ELSE NULL END,
          format('team_member:%s', tm.id::text)
        ),
        ''
      ) AS ref
    FROM public.team_members tm
    JOIN public.jugadores j
      ON j.id = tm.jugador_id
    WHERE tm.team_id IN (v_match.team_a_id, v_match.team_b_id)
  )
  SELECT
    COALESCE(
      array_agg(DISTINCT sr.ref ORDER BY sr.ref)
        FILTER (WHERE sr.team_id = v_match.team_a_id AND sr.ref IS NOT NULL),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT sr.ref ORDER BY sr.ref)
        FILTER (WHERE sr.team_id = v_match.team_b_id AND sr.ref IS NOT NULL),
      ARRAY[]::text[]
    )
  INTO v_team_a_refs, v_team_b_refs
  FROM source_rows sr;

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
      END,
      survey_status = CASE
        WHEN v_is_played THEN 'closed'
        ELSE COALESCE(p.survey_status, 'open')
      END,
      result_status = CASE
        WHEN v_is_played THEN v_result_status
        ELSE COALESCE(p.result_status, 'pending')
      END,
      winner_team = CASE
        WHEN v_is_played THEN v_winner_team
        ELSE p.winner_team
      END,
      finished_at = CASE
        WHEN v_is_played THEN COALESCE(p.finished_at, v_finished_at)
        ELSE p.finished_at
      END,
      final_team_a = CASE
        WHEN COALESCE(array_length(v_team_a_refs, 1), 0) > 0 THEN to_jsonb(v_team_a_refs)
        ELSE p.final_team_a
      END,
      final_team_b = CASE
        WHEN COALESCE(array_length(v_team_b_refs, 1), 0) > 0 THEN to_jsonb(v_team_b_refs)
        ELSE p.final_team_b
      END,
      survey_team_a = CASE
        WHEN COALESCE(array_length(v_team_a_refs, 1), 0) > 0 THEN to_jsonb(v_team_a_refs)
        ELSE p.survey_team_a
      END,
      survey_team_b = CASE
        WHEN COALESCE(array_length(v_team_b_refs, 1), 0) > 0 THEN to_jsonb(v_team_b_refs)
        ELSE p.survey_team_b
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
      surveys_sent,
      survey_status,
      result_status,
      winner_team,
      finished_at,
      survey_team_a,
      survey_team_b,
      final_team_a,
      final_team_b
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
      false,
      CASE WHEN v_is_played THEN 'closed' ELSE 'open' END,
      CASE WHEN v_is_played THEN v_result_status ELSE 'pending' END,
      CASE WHEN v_is_played THEN v_winner_team ELSE NULL END,
      CASE WHEN v_is_played THEN v_finished_at ELSE NULL END,
      CASE WHEN COALESCE(array_length(v_team_a_refs, 1), 0) > 0 THEN to_jsonb(v_team_a_refs) ELSE '[]'::jsonb END,
      CASE WHEN COALESCE(array_length(v_team_b_refs, 1), 0) > 0 THEN to_jsonb(v_team_b_refs) ELSE '[]'::jsonb END,
      CASE WHEN COALESCE(array_length(v_team_a_refs, 1), 0) > 0 THEN to_jsonb(v_team_a_refs) ELSE '[]'::jsonb END,
      CASE WHEN COALESCE(array_length(v_team_b_refs, 1), 0) > 0 THEN to_jsonb(v_team_b_refs) ELSE '[]'::jsonb END
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

-- Backfill played challenge matches that still miss team/result projection in partidos.
DO $$
DECLARE
  v_team_match_id uuid;
BEGIN
  FOR v_team_match_id IN
    SELECT tm.id
    FROM public.team_matches tm
    LEFT JOIN public.partidos p
      ON p.id = tm.partido_id
    WHERE lower(COALESCE(tm.status, '')) = 'played'
      AND (
        tm.partido_id IS NULL
        OR p.id IS NULL
        OR COALESCE(p.result_status, 'pending') = 'pending'
        OR p.winner_team IS NULL
        OR jsonb_typeof(COALESCE(p.final_team_a, 'null'::jsonb)) <> 'array'
        OR jsonb_typeof(COALESCE(p.final_team_b, 'null'::jsonb)) <> 'array'
        OR jsonb_array_length(COALESCE(p.final_team_a, '[]'::jsonb)) = 0
        OR jsonb_array_length(COALESCE(p.final_team_b, '[]'::jsonb)) = 0
      )
  LOOP
    PERFORM public.sync_team_match_to_partido(v_team_match_id);
  END LOOP;
END;
$$;

COMMIT;
