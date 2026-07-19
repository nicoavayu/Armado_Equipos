-- Multiple positions + goalkeeper availability + goalkeeper-search join role.
--
-- Feature: "Búsqueda de arquero + Mercado de Arqueros + múltiples posiciones".
--
-- Design decisions (kept consistent with the existing schema):
--   * Positions live on `usuarios` as a text[] array `posiciones` (max 2, no
--     duplicates, values in {ARQ,DEF,MED,DEL}). This mirrors the existing single
--     `posicion` text column instead of introducing a relational table.
--   * `posicion` (legacy single-value column) is KEPT and auto-synced to
--     `posiciones[1]` by a BEFORE trigger, so legacy readers keep working while
--     `posiciones` is the single source of truth. Transition is documented here.
--   * `disponible_arquero` (opt-in "available to keep goal") requires ARQ in the
--     player's positions; the trigger force-clears it otherwise.
--   * A match searches for a goalkeeper via `partidos.busca_arquero` (independent
--     from the existing `falta_jugadores` "open to community" flag for players).
--   * A join request carries the requested `role` (player | goalkeeper); the
--     approval RPC sets `jugadores.is_goalkeeper` per-match from that role.
--
-- Reversible: the DOWN steps at the bottom are documented (commented) so the
-- change can be rolled back without data loss for pre-existing rows.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) usuarios: positions array + goalkeeper availability
-- ---------------------------------------------------------------------------
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS posiciones text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS disponible_arquero boolean NOT NULL DEFAULT false;

-- Normalizes a raw position token to one of the 4 canonical abbreviations, or
-- NULL when it is not a recognized position.
CREATE OR REPLACE FUNCTION public.normalize_posicion_token(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE upper(btrim(COALESCE(p_raw, '')))
    WHEN 'ARQ' THEN 'ARQ' WHEN 'ARQUERO' THEN 'ARQ' WHEN 'GK' THEN 'ARQ' WHEN 'PORTERO' THEN 'ARQ'
    WHEN 'DEF' THEN 'DEF' WHEN 'DEFENSOR' THEN 'DEF' WHEN 'DEFENSA' THEN 'DEF'
    WHEN 'MED' THEN 'MED' WHEN 'MEDIOCAMPISTA' THEN 'MED' WHEN 'MEDIO' THEN 'MED' WHEN 'VOL' THEN 'MED'
    WHEN 'DEL' THEN 'DEL' WHEN 'DELANTERO' THEN 'DEL' WHEN 'ATACANTE' THEN 'DEL'
    ELSE NULL
  END;
$$;

-- BEFORE INSERT/UPDATE trigger: dedupes, caps at 2, validates the set, keeps the
-- legacy `posicion` column synced and clears `disponible_arquero` without ARQ.
CREATE OR REPLACE FUNCTION public.tg_normalize_usuario_posiciones()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_source text[];
  v_out text[] := '{}'::text[];
  v_raw text;
  v_norm text;
BEGIN
  -- Legacy single-field writers: if only `posicion` changed (posiciones left
  -- untouched), rebuild positions from the legacy field so old code keeps working.
  IF TG_OP = 'UPDATE'
     AND NEW.posiciones IS NOT DISTINCT FROM OLD.posiciones
     AND NEW.posicion IS DISTINCT FROM OLD.posicion THEN
    v_source := CASE
      WHEN public.normalize_posicion_token(NEW.posicion) IS NOT NULL
        THEN ARRAY[NEW.posicion]
      ELSE '{}'::text[]
    END;
  ELSE
    v_source := COALESCE(NEW.posiciones, '{}'::text[]);
    -- Seed from legacy `posicion` when the array is empty but a legacy value exists.
    IF cardinality(v_source) = 0
       AND public.normalize_posicion_token(NEW.posicion) IS NOT NULL THEN
      v_source := ARRAY[NEW.posicion];
    END IF;
  END IF;

  FOREACH v_raw IN ARRAY v_source LOOP
    v_norm := public.normalize_posicion_token(v_raw);
    IF v_norm IS NOT NULL AND NOT (v_norm = ANY(v_out)) THEN
      v_out := array_append(v_out, v_norm);
    END IF;
    EXIT WHEN cardinality(v_out) >= 2;
  END LOOP;

  NEW.posiciones := v_out;
  -- Single source of truth = posiciones; legacy column mirrors the first entry.
  NEW.posicion := v_out[1];

  IF NOT ('ARQ' = ANY(v_out)) THEN
    NEW.disponible_arquero := false;
  END IF;
  IF NEW.disponible_arquero IS NULL THEN
    NEW.disponible_arquero := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_usuario_posiciones ON public.usuarios;
CREATE TRIGGER trg_normalize_usuario_posiciones
BEFORE INSERT OR UPDATE ON public.usuarios
FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_usuario_posiciones();

-- Backfill: seed positions from the legacy `posicion` for existing rows. The
-- trigger normalizes (dedup/cap/validate) each row as it is written.
UPDATE public.usuarios
SET posiciones = ARRAY[posicion]
WHERE cardinality(COALESCE(posiciones, '{}'::text[])) = 0
  AND public.normalize_posicion_token(posicion) IS NOT NULL;

-- Defense-in-depth constraints (the trigger already guarantees these, but a
-- disabled trigger must not be able to persist invalid data).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_posiciones_max_two_check') THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_posiciones_max_two_check
      CHECK (cardinality(COALESCE(posiciones, '{}'::text[])) <= 2);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_posiciones_valid_values_check') THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_posiciones_valid_values_check
      CHECK (COALESCE(posiciones, '{}'::text[]) <@ ARRAY['ARQ','DEF','MED','DEL']::text[]);
  END IF;
END
$$;

-- GIN index so the goalkeeper market ("contains ARQ") filter stays cheap.
CREATE INDEX IF NOT EXISTS usuarios_posiciones_gin_idx
  ON public.usuarios USING gin (posiciones);
CREATE INDEX IF NOT EXISTS usuarios_disponible_arquero_idx
  ON public.usuarios (disponible_arquero)
  WHERE disponible_arquero = true;

-- ---------------------------------------------------------------------------
-- 2) partidos: goalkeeper-search flag (independent from falta_jugadores)
-- ---------------------------------------------------------------------------
ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS busca_arquero boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 3) match_join_requests: requested role (player | goalkeeper)
-- ---------------------------------------------------------------------------
ALTER TABLE public.match_join_requests
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'player';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_join_requests_role_check') THEN
    ALTER TABLE public.match_join_requests
      ADD CONSTRAINT match_join_requests_role_check
      CHECK (role IN ('player', 'goalkeeper'));
  END IF;
END
$$;

-- Creation-side guard: a 'goalkeeper' request requires the requester to actually
-- keep goal (ARQ among their positions). Otherwise coerce it to a normal player
-- request so a direct API call can never advertise a goalkeeper it isn't — the
-- approval RPC already refuses to set is_goalkeeper without ARQ, and this keeps
-- the stored intent (and the "Se suma como arquero" label) honest. Availability
-- to keep goal (disponible_arquero) is NOT enough: only the ARQ position counts.
CREATE OR REPLACE FUNCTION public.tg_match_join_request_role_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.role, 'player') = 'goalkeeper'
     AND NOT EXISTS (
       SELECT 1 FROM public.usuarios u
       WHERE u.id = NEW.user_id
         AND 'ARQ' = ANY(COALESCE(u.posiciones, '{}'::text[]))
     ) THEN
    NEW.role := 'player';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_join_request_role_guard ON public.match_join_requests;
CREATE TRIGGER trg_match_join_request_role_guard
BEFORE INSERT OR UPDATE OF role ON public.match_join_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_match_join_request_role_guard();

-- ---------------------------------------------------------------------------
-- 4) approve_join_request: honor the requested role for is_goalkeeper.
--    (Redefinition of the current prod version + role handling. A goalkeeper
--    request requires the requester to actually have ARQ among their positions.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_join_request(p_request_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_match_id bigint;
  v_user_id uuid;
  v_status text;
  v_role text;
  v_nombre text;
  v_avatar_url text;
  v_exists boolean;
  v_match_admin_id uuid;
  v_is_goalkeeper boolean;
  v_has_arq boolean;
  v_jugador_id public.jugadores.id%TYPE;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT
    r.match_id,
    r.user_id,
    r.status,
    COALESCE(r.role, 'player'),
    p.creado_por
  INTO
    v_match_id,
    v_user_id,
    v_status,
    v_role,
    v_match_admin_id
  FROM public.match_join_requests r
  JOIN public.partidos p
    ON p.id = r.match_id
  WHERE r.id = p_request_id
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;

  IF v_match_admin_id IS DISTINCT FROM v_actor_user_id THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- A decided-and-closed request (rejected/cancelled) must never be approved,
  -- even by a direct RPC call. 'approved' is intentionally allowed to fall
  -- through so a repeated approval hits the idempotent "already in the match"
  -- path below instead of erroring here.
  IF v_status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'La solicitud no está pendiente';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.jugadores j
    WHERE j.partido_id = v_match_id
      AND j.usuario_id = v_user_id
  ) INTO v_exists;

  IF v_exists THEN
    RAISE EXCEPTION 'El jugador ya está en el partido';
  END IF;

  -- A goalkeeper approval only marks is_goalkeeper when the requester truly has
  -- ARQ in their profile positions; otherwise fall back to a normal player.
  v_is_goalkeeper := false;
  IF v_role = 'goalkeeper' THEN
    SELECT ('ARQ' = ANY(COALESCE(u.posiciones, '{}'::text[])))
      INTO v_has_arq
    FROM public.usuarios u
    WHERE u.id = v_user_id;
    v_is_goalkeeper := COALESCE(v_has_arq, false);
  END IF;

  SELECT
    COALESCE(u.nombre, p.nombre, 'Jugador'),
    COALESCE(u.avatar_url, p.avatar_url)
  INTO v_nombre, v_avatar_url
  FROM public.usuarios u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_user_id;

  INSERT INTO public.jugadores (
    partido_id,
    usuario_id,
    nombre,
    avatar_url,
    score,
    is_goalkeeper
  ) VALUES (
    v_match_id,
    v_user_id,
    v_nombre,
    v_avatar_url,
    5,
    v_is_goalkeeper
  )
  RETURNING id INTO v_jugador_id;

  IF v_jugador_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo agregar el jugador al partido';
  END IF;

  IF v_status <> 'approved' THEN
    UPDATE public.match_join_requests
    SET status = 'approved',
        decided_at = now(),
        decided_by = v_actor_user_id
    WHERE id = p_request_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'match_id', v_match_id,
    'user_id', v_user_id,
    'role', v_role,
    'is_goalkeeper', v_is_goalkeeper,
    'jugador_id', v_jugador_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_join_request(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_join_request(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Goalkeeper "needs GK" notification fan-out (deduped, admin-triggered).
--    Notifies eligible, available goalkeepers within radius exactly once per
--    (user, match) for the whole life of the match (re-toggling never spams).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS notifications_match_needs_goalkeeper_unique
  ON public.notifications (user_id, partido_id)
  WHERE type = 'match_needs_goalkeeper';

CREATE OR REPLACE FUNCTION public.notify_available_goalkeepers(
  p_match_id bigint,
  p_max_distance_km integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_match public.partidos%ROWTYPE;
  v_kickoff timestamptz;
  v_max int := GREATEST(1, LEAST(COALESCE(p_max_distance_km, 30), 30));
  v_match_has_coords boolean;
  v_notified int := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_match
  FROM public.partidos
  WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido no encontrado';
  END IF;

  IF v_match.creado_por IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Only fan out for a match that is actively searching for a goalkeeper and is
  -- still in the future. Never blocks the caller: returns a no-op summary.
  IF COALESCE(v_match.busca_arquero, false) <> true THEN
    RETURN jsonb_build_object('ok', true, 'notified', 0, 'reason', 'not_searching_goalkeeper');
  END IF;

  v_kickoff := public.partido_kickoff_at(v_match.fecha, v_match.hora);
  IF v_kickoff IS NULL OR v_kickoff <= now() THEN
    RETURN jsonb_build_object('ok', true, 'notified', 0, 'reason', 'match_not_future');
  END IF;

  v_match_has_coords := public.coordinates_are_valid(v_match.sede_latitud, v_match.sede_longitud);

  WITH eligible AS (
    SELECT
      u.id,
      CASE
        WHEN v_match_has_coords AND public.coordinates_are_valid(u.latitud, u.longitud)
          THEN public.haversine_km(v_match.sede_latitud, v_match.sede_longitud, u.latitud, u.longitud)
        ELSE NULL
      END AS dist
    FROM public.usuarios u
    WHERE u.disponible_arquero = true
      AND 'ARQ' = ANY(COALESCE(u.posiciones, '{}'::text[]))
      AND u.id <> v_actor
      AND NOT EXISTS (
        SELECT 1 FROM public.jugadores j
        WHERE j.partido_id = p_match_id AND j.usuario_id = u.id
      )
  ),
  recipients AS (
    SELECT id
    FROM eligible
    WHERE
      -- No match coordinates → cannot filter by distance, notify all eligible.
      NOT v_match_has_coords
      -- With coordinates, require the goalkeeper within radius (valid coords).
      OR (dist IS NOT NULL AND dist <= v_max)
  ),
  inserted AS (
    INSERT INTO public.notifications (
      user_id, type, title, message, partido_id, data, read, created_at
    )
    SELECT
      r.id,
      'match_needs_goalkeeper',
      'Buscan arquero cerca tuyo',
      trim(both ' ·' FROM concat_ws(' · ',
        NULLIF(
          concat_ws(' ',
            to_char(v_match.fecha, 'DD/MM'),
            NULLIF(left(COALESCE(v_match.hora, ''), 5), '')
          ), ''),
        NULLIF(v_match.modalidad, ''),
        NULLIF(btrim(COALESCE(v_match.sede_direccion_normalizada, v_match.sede, '')), '')
      )),
      p_match_id,
      jsonb_build_object(
        'match_id', p_match_id,
        'matchId', p_match_id,
        'type', 'match_needs_goalkeeper',
        'link', '/partido-publico/' || p_match_id
      ),
      false,
      now()
    FROM recipients r
    ON CONFLICT (user_id, partido_id) WHERE (type = 'match_needs_goalkeeper')
    DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_notified FROM inserted;

  RETURN jsonb_build_object('ok', true, 'notified', v_notified);
END;
$$;

REVOKE ALL ON FUNCTION public.notify_available_goalkeepers(bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_available_goalkeepers(bigint, integer) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback reference — not executed):
--   DROP FUNCTION IF EXISTS public.notify_available_goalkeepers(bigint, integer);
--   DROP INDEX IF EXISTS public.notifications_match_needs_goalkeeper_unique;
--   DROP TRIGGER IF EXISTS trg_match_join_request_role_guard ON public.match_join_requests;
--   DROP FUNCTION IF EXISTS public.tg_match_join_request_role_guard();
--   ALTER TABLE public.match_join_requests DROP COLUMN IF EXISTS role;
--   ALTER TABLE public.partidos DROP COLUMN IF EXISTS busca_arquero;
--   DROP TRIGGER IF EXISTS trg_normalize_usuario_posiciones ON public.usuarios;
--   DROP FUNCTION IF EXISTS public.tg_normalize_usuario_posiciones();
--   ALTER TABLE public.usuarios
--     DROP CONSTRAINT IF EXISTS usuarios_posiciones_max_two_check,
--     DROP CONSTRAINT IF EXISTS usuarios_posiciones_valid_values_check,
--     DROP COLUMN IF EXISTS disponible_arquero,
--     DROP COLUMN IF EXISTS posiciones;
--   DROP FUNCTION IF EXISTS public.normalize_posicion_token(text);
--   (approve_join_request reverts to 20260323160000_make_approve_join_request_require_player_insert.sql)
-- ---------------------------------------------------------------------------
