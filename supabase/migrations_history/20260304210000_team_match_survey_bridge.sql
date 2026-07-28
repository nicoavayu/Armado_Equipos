BEGIN;

ALTER TABLE public.team_matches
  ADD COLUMN IF NOT EXISTS partido_id bigint NULL REFERENCES public.partidos(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS team_matches_partido_id_uidx
  ON public.team_matches(partido_id)
  WHERE partido_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jugadores_partido_usuario_uidx
  ON public.jugadores(partido_id, usuario_id)
  WHERE usuario_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jugadores_partido_uuid_uidx
  ON public.jugadores(partido_id, uuid)
  WHERE uuid IS NOT NULL;

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

  IF lower(COALESCE(v_match.status, '')) <> 'played' THEN
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

  v_match_at := COALESCE(v_match.played_at, v_match.scheduled_at, now());
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
      estado = 'finalizado'
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
      'finalizado',
      false
    )
    RETURNING id INTO v_partido_id;

    UPDATE public.team_matches tm
    SET partido_id = v_partido_id
    WHERE tm.id = v_match.id;
  END IF;

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
    du.usuario_id::text,
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
    SELECT DISTINCT ON (COALESCE(sr.source_uuid, format('team_member:%s', sr.team_member_id::text)))
      sr.team_member_id,
      sr.source_uuid,
      sr.nombre,
      sr.avatar_url,
      sr.score,
      sr.is_goalkeeper
    FROM source_rows sr
    WHERE sr.usuario_id IS NULL
    ORDER BY COALESCE(sr.source_uuid, format('team_member:%s', sr.team_member_id::text)), sr.team_member_id
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
    COALESCE(NULLIF(dg.source_uuid, ''), format('team_member:%s', dg.team_member_id::text)),
    dg.nombre,
    dg.avatar_url,
    dg.score,
    dg.is_goalkeeper
  FROM dedup_guests dg
  ON CONFLICT (partido_id, uuid)
    WHERE uuid IS NOT NULL
  DO UPDATE SET
    nombre = EXCLUDED.nombre,
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.jugadores.avatar_url),
    score = COALESCE(EXCLUDED.score, public.jugadores.score),
    is_goalkeeper = EXCLUDED.is_goalkeeper;

  RETURN v_partido_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_team_match_to_partido(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_sync_team_match_to_partido_bridge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(COALESCE(NEW.status, '')) = 'played' THEN
    PERFORM public.sync_team_match_to_partido(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_team_match_to_partido_bridge ON public.team_matches;
CREATE TRIGGER trg_sync_team_match_to_partido_bridge
AFTER INSERT OR UPDATE OF status, played_at, scheduled_at, location, location_name, cancha_cost, mode, format, team_a_id, team_b_id
ON public.team_matches
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_team_match_to_partido_bridge();

DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT tm.id
    FROM public.team_matches tm
    WHERE lower(COALESCE(tm.status, '')) = 'played'
  LOOP
    BEGIN
      PERFORM public.sync_team_match_to_partido(v_row.id);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'sync_team_match_to_partido failed for %: %', v_row.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

COMMIT;
