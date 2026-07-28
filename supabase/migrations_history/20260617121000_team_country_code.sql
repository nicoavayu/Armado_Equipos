-- ============================================================================
-- País real para equipos (teams.country_code) + exposición en RPCs de ranking
-- Date: 2026-06-17
--
-- Agrega un país REAL por equipo para que el filtro por país no dependa de una
-- bandera hardcodeada:
--   * teams.country_code char(2) NOT NULL DEFAULT 'AR' (backfillea a 'AR' los
--     equipos existentes; el producto es AR-first) + CHECK ISO alpha-2.
--   * rpc_get_team_challenge_rankings / rpc_search_challengeable_teams agregan
--     country_code a su salida (el filtro por país es client-side, igual que el
--     sort: no se agregan parámetros nuevos). El helper de stats no se toca.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) teams.country_code (ISO 3166-1 alpha-2). Default AR -> backfill existente.
-- ---------------------------------------------------------------------------
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS country_code char(2) NOT NULL DEFAULT 'AR';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teams_country_code_check'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_country_code_check
      CHECK (country_code ~ '^[A-Z]{2}$');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) RPC ranking: misma lógica de 20260616193000 + country_code en la salida.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_get_team_challenge_rankings(text, text, text, int, text);
CREATE OR REPLACE FUNCTION public.rpc_get_team_challenge_rankings(
  p_format text DEFAULT NULL,
  p_zone text DEFAULT NULL,
  p_sort text DEFAULT 'played',
  p_limit int DEFAULT 50,
  p_period text DEFAULT 'all'
)
RETURNS TABLE (
  team_id uuid,
  team_name text,
  avatar_url text,
  format smallint,
  zone text,
  country_code text,
  skill_level text,
  color_primary text,
  color_secondary text,
  color_accent text,
  played_count bigint,
  wins bigint,
  draws bigint,
  losses bigint,
  win_rate numeric,
  last_played_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_format smallint := NULLIF(regexp_replace(COALESCE(p_format, ''), '\D', '', 'g'), '')::smallint;
  v_zone text := NULLIF(btrim(COALESCE(p_zone, '')), '');
  v_sort text := lower(COALESCE(NULLIF(btrim(p_sort), ''), 'played'));
  v_since timestamptz := CASE
    WHEN lower(COALESCE(p_period, 'all')) IN ('90d', '90', 'last_90', 'recent') THEN now() - interval '90 days'
    ELSE NULL
  END;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  RETURN QUERY
  WITH stats AS (
    SELECT * FROM public.team_challenge_confirmed_team_stats(v_since)
  )
  SELECT
    t.id,
    t.name,
    t.crest_url,
    t.format,
    t.base_zone,
    t.country_code::text,
    t.skill_level,
    t.color_primary,
    t.color_secondary,
    t.color_accent,
    s.played_count,
    s.wins,
    s.draws,
    s.losses,
    (CASE WHEN s.played_count > 0 THEN round(s.wins * 100.0 / s.played_count) ELSE 0 END)::numeric AS win_rate,
    s.last_played_at
  FROM stats s
  JOIN public.teams t ON t.id = s.team_id
  WHERE t.is_active = true
    AND (v_format IS NULL OR t.format = v_format)
    AND (v_zone IS NULL OR t.base_zone ILIKE '%' || v_zone || '%')
  ORDER BY
    CASE WHEN v_sort = 'wins' THEN s.wins END DESC NULLS LAST,
    CASE WHEN v_sort = 'wins' THEN (CASE WHEN s.played_count > 0 THEN s.wins * 100.0 / s.played_count ELSE 0 END) END DESC NULLS LAST,
    CASE WHEN v_sort = 'wins' THEN s.played_count END DESC NULLS LAST,
    CASE WHEN v_sort <> 'wins' THEN s.played_count END DESC NULLS LAST,
    CASE WHEN v_sort <> 'wins' THEN s.wins END DESC NULLS LAST,
    s.last_played_at DESC NULLS LAST
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_team_challenge_rankings(text, text, text, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_get_team_challenge_rankings(text, text, text, int, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) RPC directorio: misma lógica + country_code en la salida.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_search_challengeable_teams(text, text, text, int);
CREATE OR REPLACE FUNCTION public.rpc_search_challengeable_teams(
  p_query text DEFAULT NULL,
  p_format text DEFAULT NULL,
  p_zone text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  team_id uuid,
  team_name text,
  avatar_url text,
  format smallint,
  zone text,
  country_code text,
  skill_level text,
  color_primary text,
  color_secondary text,
  color_accent text,
  played_count bigint,
  wins bigint,
  draws bigint,
  losses bigint,
  win_rate numeric,
  last_played_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_query text := NULLIF(btrim(COALESCE(p_query, '')), '');
  v_format smallint := NULLIF(regexp_replace(COALESCE(p_format, ''), '\D', '', 'g'), '')::smallint;
  v_zone text := NULLIF(btrim(COALESCE(p_zone, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  RETURN QUERY
  WITH stats AS (
    SELECT * FROM public.team_challenge_confirmed_team_stats(NULL)
  )
  SELECT
    t.id,
    t.name,
    t.crest_url,
    t.format,
    t.base_zone,
    t.country_code::text,
    t.skill_level,
    t.color_primary,
    t.color_secondary,
    t.color_accent,
    COALESCE(s.played_count, 0)::bigint,
    COALESCE(s.wins, 0)::bigint,
    COALESCE(s.draws, 0)::bigint,
    COALESCE(s.losses, 0)::bigint,
    (CASE WHEN COALESCE(s.played_count, 0) > 0 THEN round(s.wins * 100.0 / s.played_count) ELSE 0 END)::numeric AS win_rate,
    s.last_played_at
  FROM public.teams t
  LEFT JOIN stats s ON s.team_id = t.id
  WHERE t.is_active = true
    AND (v_query IS NULL OR t.name ILIKE '%' || v_query || '%')
    AND (v_format IS NULL OR t.format = v_format)
    AND (v_zone IS NULL OR t.base_zone ILIKE '%' || v_zone || '%')
  ORDER BY
    COALESCE(s.played_count, 0) DESC,
    s.last_played_at DESC NULLS LAST,
    t.name ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_search_challengeable_teams(text, text, text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_search_challengeable_teams(text, text, text, int) TO authenticated, service_role;

COMMIT;
