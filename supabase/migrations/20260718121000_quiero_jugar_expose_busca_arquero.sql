-- Expose `busca_arquero` through a NEW, explicit v2 Quiero Jugar pipeline.
--
-- Backward compatibility is the hard requirement here: the CURRENT view/RPC
-- (`partidos_abiertos_operativos`, `get_open_matches_for_quiero_jugar`,
-- `debug_quiero_jugar_match_audit`) are consumed by apps that are ALREADY
-- installed and that do NOT know the goalkeeper flow. Those objects are left
-- exactly as prod has them: same signature, same columns, same behavior, and the
-- historical `falta_jugadores`-only "operationally open" condition. Installed apps
-- must keep receiving only the matches they received before this PR — in
-- particular they must NEVER start seeing busca_arquero-only matches, which they
-- would mishandle as ordinary player searches.
--
-- The new client (this PR) consumes a NEW, explicit v2 surface instead:
--   * view  partidos_abiertos_operativos_v2
--   * rpc   get_open_matches_for_quiero_jugar_v2
--   * rpc   debug_quiero_jugar_match_audit_v2
-- A match is "operationally open" for v2 when it searches for players
-- (`falta_jugadores`) OR a goalkeeper (`busca_arquero`). The existing
-- `partido_is_operationally_open()` predicate is reused untouched by passing
-- `(falta_jugadores OR busca_arquero)` as its players flag. v2 additionally
-- exposes `busca_arquero` so the client can render "Busca jugadores" / "Busca
-- arquero" badges and filter.

BEGIN;

-- Companion partial index for the v2 candidate set (players OR goalkeeper). The
-- legacy `partidos_quiero_jugar_open_candidates_idx` is intentionally left
-- untouched so the legacy view/RPC keep their original plan.
CREATE INDEX IF NOT EXISTS partidos_quiero_jugar_v2_open_candidates_idx
  ON public.partidos (estado, fecha, hora, created_at DESC)
  WHERE deleted_at IS NULL
    AND (COALESCE(falta_jugadores, false) = true OR COALESCE(busca_arquero, false) = true);

-- v2 view: same shape as the legacy view plus a trailing `busca_arquero` column,
-- and a WHERE that opens on either flag. Created as a NEW object; the legacy view
-- is not redefined.
CREATE OR REPLACE VIEW public.partidos_abiertos_operativos_v2
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
  COALESCE(player_rows.jugadores_count, 0) AS jugadores_count,
  COALESCE(p.busca_arquero, false) AS busca_arquero
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
  (COALESCE(p.falta_jugadores, false) OR COALESCE(p.busca_arquero, false)),
  now()
);

GRANT SELECT ON public.partidos_abiertos_operativos_v2 TO authenticated;

-- v2 open-matches RPC: same shape as the legacy RPC plus the `busca_arquero`
-- column, sourcing from the v2 view. The legacy RPC is not redefined.
DROP FUNCTION IF EXISTS public.get_open_matches_for_quiero_jugar_v2(double precision, double precision, integer);
CREATE FUNCTION public.get_open_matches_for_quiero_jugar_v2(
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
  busca_arquero boolean,
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
    FROM public.partidos_abiertos_operativos_v2 v
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
    c.busca_arquero,
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

REVOKE ALL ON FUNCTION public.get_open_matches_for_quiero_jugar_v2(double precision, double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_open_matches_for_quiero_jugar_v2(double precision, double precision, integer) TO authenticated;

-- v2 debug audit (goalkeeper-aware). The legacy debug function is left untouched.
DROP FUNCTION IF EXISTS public.debug_quiero_jugar_match_audit_v2(double precision, double precision, integer);
CREATE FUNCTION public.debug_quiero_jugar_match_audit_v2(
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
  busca_arquero boolean,
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
      COALESCE(p.busca_arquero, false) AS busca_arquero,
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
        CASE WHEN NOT (c.falta_jugadores OR c.busca_arquero) THEN 'no_slots_available' END,
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
    a.busca_arquero,
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

REVOKE ALL ON FUNCTION public.debug_quiero_jugar_match_audit_v2(double precision, double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_quiero_jugar_match_audit_v2(double precision, double precision, integer) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback reference — not executed). The legacy objects were never
-- touched, so rollback only drops the v2 objects:
--   DROP FUNCTION IF EXISTS public.debug_quiero_jugar_match_audit_v2(double precision, double precision, integer);
--   DROP FUNCTION IF EXISTS public.get_open_matches_for_quiero_jugar_v2(double precision, double precision, integer);
--   DROP VIEW IF EXISTS public.partidos_abiertos_operativos_v2;
--   DROP INDEX IF EXISTS public.partidos_quiero_jugar_v2_open_candidates_idx;
-- ---------------------------------------------------------------------------
