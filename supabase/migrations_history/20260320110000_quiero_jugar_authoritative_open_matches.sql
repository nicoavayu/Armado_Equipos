BEGIN;

ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS sede_place_id text,
  ADD COLUMN IF NOT EXISTS sede_direccion_normalizada text,
  ADD COLUMN IF NOT EXISTS sede_latitud double precision,
  ADD COLUMN IF NOT EXISTS sede_longitud double precision;

ALTER TABLE public.partidos_frecuentes
  ADD COLUMN IF NOT EXISTS sede_place_id text,
  ADD COLUMN IF NOT EXISTS sede_direccion_normalizada text,
  ADD COLUMN IF NOT EXISTS sede_latitud double precision,
  ADD COLUMN IF NOT EXISTS sede_longitud double precision;

UPDATE public.partidos p
SET
  sede_place_id = COALESCE(
    NULLIF(trim(p.sede_place_id), ''),
    NULLIF(trim(COALESCE(p."sedeMaps" ->> 'place_id', p."sedeMaps" ->> 'placeId')), '')
  ),
  sede_direccion_normalizada = COALESCE(
    NULLIF(trim(p.sede_direccion_normalizada), ''),
    NULLIF(trim(p.sede), '')
  ),
  sede_latitud = COALESCE(
    p.sede_latitud,
    NULLIF(COALESCE(
      p."sedeMaps" ->> 'lat',
      p."sedeMaps" ->> 'latitude',
      p."sedeMaps" #>> '{geometry,location,lat}'
    ), '')::double precision
  ),
  sede_longitud = COALESCE(
    p.sede_longitud,
    NULLIF(COALESCE(
      p."sedeMaps" ->> 'lng',
      p."sedeMaps" ->> 'longitude',
      p."sedeMaps" #>> '{geometry,location,lng}'
    ), '')::double precision
  )
WHERE
  p.sede_place_id IS NULL
  OR p.sede_direccion_normalizada IS NULL
  OR p.sede_latitud IS NULL
  OR p.sede_longitud IS NULL;

UPDATE public.partidos_frecuentes pf
SET
  sede_direccion_normalizada = COALESCE(
    NULLIF(trim(pf.sede_direccion_normalizada), ''),
    NULLIF(trim(pf.sede), '')
  )
WHERE pf.sede_direccion_normalizada IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'partidos_sede_latitud_range_check'
  ) THEN
    ALTER TABLE public.partidos
      ADD CONSTRAINT partidos_sede_latitud_range_check
      CHECK (
        sede_latitud IS NULL
        OR (sede_latitud >= -90 AND sede_latitud <= 90)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'partidos_sede_longitud_range_check'
  ) THEN
    ALTER TABLE public.partidos
      ADD CONSTRAINT partidos_sede_longitud_range_check
      CHECK (
        sede_longitud IS NULL
        OR (sede_longitud >= -180 AND sede_longitud <= 180)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'partidos_sede_latlng_not_zero_zero_check'
  ) THEN
    ALTER TABLE public.partidos
      ADD CONSTRAINT partidos_sede_latlng_not_zero_zero_check
      CHECK (
        sede_latitud IS NULL
        OR sede_longitud IS NULL
        OR NOT (
          abs(sede_latitud) < 0.0001
          AND abs(sede_longitud) < 0.0001
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'partidos_frecuentes_sede_latitud_range_check'
  ) THEN
    ALTER TABLE public.partidos_frecuentes
      ADD CONSTRAINT partidos_frecuentes_sede_latitud_range_check
      CHECK (
        sede_latitud IS NULL
        OR (sede_latitud >= -90 AND sede_latitud <= 90)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'partidos_frecuentes_sede_longitud_range_check'
  ) THEN
    ALTER TABLE public.partidos_frecuentes
      ADD CONSTRAINT partidos_frecuentes_sede_longitud_range_check
      CHECK (
        sede_longitud IS NULL
        OR (sede_longitud >= -180 AND sede_longitud <= 180)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'partidos_frecuentes_sede_latlng_not_zero_zero_check'
  ) THEN
    ALTER TABLE public.partidos_frecuentes
      ADD CONSTRAINT partidos_frecuentes_sede_latlng_not_zero_zero_check
      CHECK (
        sede_latitud IS NULL
        OR sede_longitud IS NULL
        OR NOT (
          abs(sede_latitud) < 0.0001
          AND abs(sede_longitud) < 0.0001
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS partidos_quiero_jugar_open_candidates_idx
  ON public.partidos (estado, fecha, hora, created_at DESC)
  WHERE deleted_at IS NULL
    AND COALESCE(falta_jugadores, false) = true;

CREATE INDEX IF NOT EXISTS partidos_sede_place_id_idx
  ON public.partidos (sede_place_id)
  WHERE sede_place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS partidos_frecuentes_sede_place_id_idx
  ON public.partidos_frecuentes (sede_place_id)
  WHERE sede_place_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.normalize_partido_estado(p_estado text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(trim(COALESCE(p_estado, ''))) IN ('active', 'activo') THEN 'active'
    WHEN lower(trim(COALESCE(p_estado, ''))) IN ('cancelado', 'cancelled', 'canceled') THEN 'cancelado'
    WHEN lower(trim(COALESCE(p_estado, ''))) IN ('deleted', 'eliminado', 'archived', 'hidden') THEN 'deleted'
    WHEN lower(trim(COALESCE(p_estado, ''))) IN ('finalizado', 'finished', 'completed', 'closed') THEN 'finalizado'
    WHEN trim(COALESCE(p_estado, '')) = '' THEN 'unknown'
    ELSE lower(trim(p_estado))
  END;
$$;

CREATE OR REPLACE FUNCTION public.coordinates_are_valid(
  p_lat double precision,
  p_lng double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_lat IS NOT NULL
    AND p_lng IS NOT NULL
    AND p_lat BETWEEN -90 AND 90
    AND p_lng BETWEEN -180 AND 180
    AND NOT (abs(p_lat) < 0.0001 AND abs(p_lng) < 0.0001);
$$;

CREATE OR REPLACE FUNCTION public.partido_kickoff_at(
  p_fecha date,
  p_hora text
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_time text := trim(COALESCE(p_hora, ''));
  v_parts text[];
  v_hour int;
  v_minute int;
  v_second int := 0;
BEGIN
  IF p_fecha IS NULL OR v_time = '' THEN
    RETURN NULL;
  END IF;

  IF v_time !~ '^\d{1,2}:\d{2}(:\d{2})?$' THEN
    RETURN NULL;
  END IF;

  v_parts := regexp_split_to_array(v_time, ':');
  v_hour := v_parts[1]::int;
  v_minute := v_parts[2]::int;
  IF array_length(v_parts, 1) >= 3 THEN
    v_second := v_parts[3]::int;
  END IF;

  IF v_hour NOT BETWEEN 0 AND 23 OR v_minute NOT BETWEEN 0 AND 59 OR v_second NOT BETWEEN 0 AND 59 THEN
    RETURN NULL;
  END IF;

  RETURN make_timestamptz(
    EXTRACT(YEAR FROM p_fecha)::int,
    EXTRACT(MONTH FROM p_fecha)::int,
    EXTRACT(DAY FROM p_fecha)::int,
    v_hour,
    v_minute,
    v_second,
    'America/Argentina/Buenos_Aires'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.partido_is_operationally_open(
  p_estado text,
  p_deleted_at timestamptz,
  p_survey_status text,
  p_result_status text,
  p_finished_at timestamptz,
  p_fecha date,
  p_hora text,
  p_falta_jugadores boolean,
  p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(p_falta_jugadores, false) = true
    AND public.normalize_partido_estado(p_estado) = 'active'
    AND p_deleted_at IS NULL
    AND COALESCE(lower(trim(p_survey_status)), 'open') <> 'closed'
    AND COALESCE(lower(trim(p_result_status)), 'pending') NOT IN ('finished', 'draw', 'not_played')
    AND p_finished_at IS NULL
    AND public.partido_kickoff_at(p_fecha, p_hora) IS NOT NULL
    AND public.partido_kickoff_at(p_fecha, p_hora) > COALESCE(p_now, now());
$$;

CREATE OR REPLACE FUNCTION public.haversine_km(
  p_from_lat double precision,
  p_from_lng double precision,
  p_to_lat double precision,
  p_to_lng double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN NOT public.coordinates_are_valid(p_from_lat, p_from_lng)
      OR NOT public.coordinates_are_valid(p_to_lat, p_to_lng)
    THEN NULL
    ELSE (
      6371::double precision * 2::double precision * atan2(
        sqrt(
          sin(radians(p_to_lat - p_from_lat) / 2::double precision)^2
          + cos(radians(p_from_lat)) * cos(radians(p_to_lat))
          * sin(radians(p_to_lng - p_from_lng) / 2::double precision)^2
        ),
        sqrt(
          1::double precision - (
            sin(radians(p_to_lat - p_from_lat) / 2::double precision)^2
            + cos(radians(p_from_lat)) * cos(radians(p_to_lat))
            * sin(radians(p_to_lng - p_from_lng) / 2::double precision)^2
          )
        )
      )
    )
  END;
$$;

CREATE OR REPLACE VIEW public.partidos_abiertos_operativos
WITH (security_invoker = on)
AS
SELECT
  p.id,
  p.created_at,
  p.updated_at,
  p.codigo,
  p.match_ref,
  p.nombre,
  p.fecha,
  p.hora,
  public.partido_kickoff_at(p.fecha, p.hora) AS kickoff_at,
  p.sede,
  COALESCE(NULLIF(trim(p.sede_direccion_normalizada), ''), NULLIF(trim(p.sede), '')) AS sede_direccion_normalizada,
  COALESCE(
    NULLIF(trim(p.sede_place_id), ''),
    NULLIF(trim(COALESCE(p."sedeMaps" ->> 'place_id', p."sedeMaps" ->> 'placeId')), '')
  ) AS sede_place_id,
  p.sede_latitud,
  p.sede_longitud,
  p."sedeMaps" AS "sedeMaps",
  p.creado_por,
  p.modalidad,
  p.cupo_jugadores,
  COALESCE(p.falta_jugadores, false) AS falta_jugadores,
  p.tipo_partido,
  p.estado,
  public.normalize_partido_estado(p.estado) AS estado_normalizado,
  COALESCE(player_rows.jugadores, '[]'::jsonb) AS jugadores,
  COALESCE(player_rows.jugadores_count, 0) AS jugadores_count
FROM public.partidos p
LEFT JOIN LATERAL (
  SELECT
    jsonb_agg(to_jsonb(j) ORDER BY j.id) AS jugadores,
    COUNT(*)::int AS jugadores_count
  FROM public.jugadores j
  WHERE j.partido_id = p.id
) AS player_rows ON true
WHERE public.partido_is_operationally_open(
  p.estado,
  p.deleted_at,
  p.survey_status,
  p.result_status,
  p.finished_at,
  p.fecha,
  p.hora,
  p.falta_jugadores,
  now()
);

CREATE OR REPLACE FUNCTION public.get_open_matches_for_quiero_jugar(
  p_user_lat double precision DEFAULT NULL,
  p_user_lng double precision DEFAULT NULL,
  p_max_distance_km integer DEFAULT 30
)
RETURNS TABLE (
  id bigint,
  created_at timestamptz,
  updated_at timestamptz,
  codigo text,
  match_ref uuid,
  nombre text,
  fecha date,
  hora text,
  kickoff_at timestamptz,
  sede text,
  sede_direccion_normalizada text,
  sede_place_id text,
  sede_latitud double precision,
  sede_longitud double precision,
  "sedeMaps" jsonb,
  creado_por uuid,
  modalidad text,
  cupo_jugadores integer,
  falta_jugadores boolean,
  tipo_partido text,
  estado text,
  estado_normalizado text,
  jugadores jsonb,
  jugadores_count integer,
  user_has_location boolean,
  match_has_coordinates boolean,
  distance_km double precision
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH user_input AS (
    SELECT
      CASE
        WHEN public.coordinates_are_valid(p_user_lat, p_user_lng) THEN p_user_lat
        ELSE NULL
      END AS user_lat,
      CASE
        WHEN public.coordinates_are_valid(p_user_lat, p_user_lng) THEN p_user_lng
        ELSE NULL
      END AS user_lng,
      GREATEST(1, LEAST(COALESCE(p_max_distance_km, 30), 30))::int AS max_distance_km
  ),
  candidate_rows AS (
    SELECT
      v.*,
      (ui.user_lat IS NOT NULL AND ui.user_lng IS NOT NULL) AS user_has_location,
      public.coordinates_are_valid(v.sede_latitud, v.sede_longitud) AS match_has_coordinates,
      CASE
        WHEN ui.user_lat IS NOT NULL
          AND ui.user_lng IS NOT NULL
          AND public.coordinates_are_valid(v.sede_latitud, v.sede_longitud)
        THEN public.haversine_km(ui.user_lat, ui.user_lng, v.sede_latitud, v.sede_longitud)
        ELSE NULL
      END AS distance_km,
      ui.max_distance_km
    FROM public.partidos_abiertos_operativos v
    CROSS JOIN user_input ui
  )
  SELECT
    c.id,
    c.created_at,
    c.updated_at,
    c.codigo,
    c.match_ref,
    c.nombre,
    c.fecha,
    c.hora,
    c.kickoff_at,
    c.sede,
    c.sede_direccion_normalizada,
    c.sede_place_id,
    c.sede_latitud,
    c.sede_longitud,
    c."sedeMaps",
    c.creado_por,
    c.modalidad,
    c.cupo_jugadores,
    c.falta_jugadores,
    c.tipo_partido,
    c.estado,
    c.estado_normalizado,
    c.jugadores,
    c.jugadores_count,
    c.user_has_location,
    c.match_has_coordinates,
    c.distance_km
  FROM candidate_rows c
  WHERE (
    NOT c.user_has_location
    OR (
      c.match_has_coordinates
      AND c.distance_km IS NOT NULL
      AND c.distance_km <= c.max_distance_km
    )
  )
  ORDER BY c.kickoff_at ASC, c.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.debug_quiero_jugar_match_audit(
  p_user_lat double precision DEFAULT NULL,
  p_user_lng double precision DEFAULT NULL,
  p_max_distance_km integer DEFAULT 30
)
RETURNS TABLE (
  partido_id bigint,
  nombre text,
  estado text,
  estado_normalizado text,
  cancelado boolean,
  deleted_at timestamptz,
  survey_status text,
  result_status text,
  finished_at timestamptz,
  falta_jugadores boolean,
  start_datetime timestamptz,
  expired boolean,
  user_has_location boolean,
  match_has_coordinates boolean,
  distance_km double precision,
  within_distance boolean,
  included_in_list boolean,
  exclusion_reasons text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH user_input AS (
    SELECT
      CASE
        WHEN public.coordinates_are_valid(p_user_lat, p_user_lng) THEN p_user_lat
        ELSE NULL
      END AS user_lat,
      CASE
        WHEN public.coordinates_are_valid(p_user_lat, p_user_lng) THEN p_user_lng
        ELSE NULL
      END AS user_lng,
      GREATEST(1, LEAST(COALESCE(p_max_distance_km, 30), 30))::int AS max_distance_km
  ),
  candidate_rows AS (
    SELECT
      p.id AS partido_id,
      p.nombre,
      p.estado,
      public.normalize_partido_estado(p.estado) AS estado_normalizado,
      p.deleted_at,
      p.survey_status,
      p.result_status,
      p.finished_at,
      COALESCE(p.falta_jugadores, false) AS falta_jugadores,
      public.partido_kickoff_at(p.fecha, p.hora) AS start_datetime,
      (ui.user_lat IS NOT NULL AND ui.user_lng IS NOT NULL) AS user_has_location,
      public.coordinates_are_valid(p.sede_latitud, p.sede_longitud) AS match_has_coordinates,
      CASE
        WHEN ui.user_lat IS NOT NULL
          AND ui.user_lng IS NOT NULL
          AND public.coordinates_are_valid(p.sede_latitud, p.sede_longitud)
        THEN public.haversine_km(ui.user_lat, ui.user_lng, p.sede_latitud, p.sede_longitud)
        ELSE NULL
      END AS distance_km,
      ui.max_distance_km
    FROM public.partidos p
    CROSS JOIN user_input ui
  ),
  audited AS (
    SELECT
      c.*,
      (c.estado_normalizado = 'cancelado') AS cancelado,
      (c.start_datetime IS NOT NULL AND c.start_datetime <= now()) AS expired,
      (
        c.user_has_location
        AND c.match_has_coordinates
        AND c.distance_km IS NOT NULL
        AND c.distance_km <= c.max_distance_km
      ) AS within_distance,
      array_remove(ARRAY[
        CASE WHEN c.estado_normalizado <> 'active' THEN 'state_not_open' END,
        CASE WHEN c.deleted_at IS NOT NULL THEN 'soft_deleted' END,
        CASE WHEN COALESCE(lower(trim(c.survey_status)), 'open') = 'closed' THEN 'survey_closed' END,
        CASE WHEN COALESCE(lower(trim(c.result_status)), 'pending') IN ('finished', 'draw', 'not_played') THEN 'result_closed' END,
        CASE WHEN c.finished_at IS NOT NULL THEN 'finished_at_present' END,
        CASE WHEN c.falta_jugadores <> true THEN 'no_slots_available' END,
        CASE WHEN c.start_datetime IS NULL THEN 'invalid_kickoff' END,
        CASE WHEN c.start_datetime IS NOT NULL AND c.start_datetime <= now() THEN 'match_expired' END,
        CASE WHEN c.user_has_location AND NOT c.match_has_coordinates THEN 'match_distance_unresolvable' END,
        CASE WHEN c.user_has_location AND c.match_has_coordinates AND c.distance_km IS NOT NULL AND c.distance_km > c.max_distance_km THEN 'outside_distance' END
      ], NULL) AS exclusion_reasons
    FROM candidate_rows c
  )
  SELECT
    a.partido_id,
    a.nombre,
    a.estado,
    a.estado_normalizado,
    a.cancelado,
    a.deleted_at,
    a.survey_status,
    a.result_status,
    a.finished_at,
    a.falta_jugadores,
    a.start_datetime,
    a.expired,
    a.user_has_location,
    a.match_has_coordinates,
    a.distance_km,
    CASE
      WHEN NOT a.user_has_location THEN NULL
      ELSE a.within_distance
    END AS within_distance,
    COALESCE(array_length(a.exclusion_reasons, 1), 0) = 0 AS included_in_list,
    a.exclusion_reasons
  FROM audited a
  ORDER BY a.start_datetime ASC NULLS LAST, a.partido_id ASC;
$$;

REVOKE ALL ON FUNCTION public.get_open_matches_for_quiero_jugar(double precision, double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_open_matches_for_quiero_jugar(double precision, double precision, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.debug_quiero_jugar_match_audit(double precision, double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_quiero_jugar_match_audit(double precision, double precision, integer) TO authenticated;

GRANT SELECT ON public.partidos_abiertos_operativos TO authenticated;

COMMIT;
