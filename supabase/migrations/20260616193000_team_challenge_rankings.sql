-- ============================================================================
-- Team challenge rankings & challengeable-teams directory (read-only)
-- Date: 2026-06-16
--
-- Adds discovery features to the Desafios section WITHOUT touching any existing
-- table, trigger, RLS policy, or sensitive function. This migration is purely
-- additive and read-only:
--   * public.team_challenge_confirmed_team_stats(timestamptz)
--       Internal helper. Single source of truth for "confirmed challenge match"
--       counting: counts a team_matches row ONLY when the result is final and
--       agreed (result_confirmed = true, result_conflict = false, a valid
--       result_status). Provisional results, conflicts, cancelled/rejected and
--       unreported matches are NOT counted. Each confirmed match contributes one
--       played game to BOTH teams and the matching win/draw/loss.
--   * rpc_get_team_challenge_rankings(...)  -> ranking ("mas jugaron"/"mas ganaron")
--   * rpc_search_challengeable_teams(...)   -> directory of active teams
--
-- Both RPCs are SECURITY DEFINER, expose ONLY non-sensitive public team data
-- (name, crest, format, base_zone, colors + aggregated stats), never player /
-- email / phone data, require an authenticated caller, and only list active
-- (is_active = true) teams. No write paths are opened.
--
-- Explicitly NOT touched: teams/team_matches/challenges schema, account
-- deletion, enforce_team_member_permissions, validate_challenge_payload, any
-- existing RPC, or app versions.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: per-team aggregated stats over CONFIRMED challenge matches only.
-- team_a = challenger, team_b = accepted (see challenge_manual_results).
-- p_since (nullable) restricts to matches whose result time is recent enough,
-- used by the "ultimos 90 dias" ranking period filter.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_challenge_confirmed_team_stats(
  p_since timestamptz DEFAULT NULL
)
RETURNS TABLE (
  team_id uuid,
  played_count bigint,
  wins bigint,
  draws bigint,
  losses bigint,
  last_played_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH confirmed AS (
    SELECT
      tm.team_a_id,
      tm.team_b_id,
      tm.result_status,
      COALESCE(
        tm.result_updated_at,
        tm.result_reported_at,
        tm.played_at,
        tm.scheduled_at,
        tm.created_at
      ) AS played_at
    FROM public.team_matches tm
    WHERE
      (lower(COALESCE(tm.origin_type, '')) = 'challenge' OR tm.challenge_id IS NOT NULL)
      AND tm.result_confirmed = true
      AND COALESCE(tm.result_conflict, false) = false
      AND tm.result_status IN ('team_a_win', 'team_b_win', 'draw')
      AND tm.team_a_id IS NOT NULL
      AND tm.team_b_id IS NOT NULL
  ),
  per_team AS (
    -- team_a (challenger) perspective
    SELECT
      c.team_a_id AS team_id,
      CASE WHEN c.result_status = 'team_a_win' THEN 1 ELSE 0 END AS won,
      CASE WHEN c.result_status = 'draw' THEN 1 ELSE 0 END AS drew,
      CASE WHEN c.result_status = 'team_b_win' THEN 1 ELSE 0 END AS lost,
      c.played_at
    FROM confirmed c
    UNION ALL
    -- team_b (accepted) perspective
    SELECT
      c.team_b_id AS team_id,
      CASE WHEN c.result_status = 'team_b_win' THEN 1 ELSE 0 END AS won,
      CASE WHEN c.result_status = 'draw' THEN 1 ELSE 0 END AS drew,
      CASE WHEN c.result_status = 'team_a_win' THEN 1 ELSE 0 END AS lost,
      c.played_at
    FROM confirmed c
  )
  SELECT
    pt.team_id,
    COUNT(*)::bigint AS played_count,
    SUM(pt.won)::bigint AS wins,
    SUM(pt.drew)::bigint AS draws,
    SUM(pt.lost)::bigint AS losses,
    MAX(pt.played_at) AS last_played_at
  FROM per_team pt
  WHERE p_since IS NULL OR pt.played_at >= p_since
  GROUP BY pt.team_id;
$$;

-- Internal helper: only the SECURITY DEFINER RPCs (running as owner) call it.
REVOKE ALL ON FUNCTION public.team_challenge_confirmed_team_stats(timestamptz) FROM public;

-- ---------------------------------------------------------------------------
-- RPC 1: team ranking. p_sort = 'played' (mas jugaron) | 'wins' (mas ganaron).
-- Only teams with at least one confirmed challenge match appear.
-- ---------------------------------------------------------------------------
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
    -- 'wins' (mas ganaron): wins DESC, win_rate DESC, played_count DESC
    CASE WHEN v_sort = 'wins' THEN s.wins END DESC NULLS LAST,
    CASE WHEN v_sort = 'wins' THEN (CASE WHEN s.played_count > 0 THEN s.wins * 100.0 / s.played_count ELSE 0 END) END DESC NULLS LAST,
    CASE WHEN v_sort = 'wins' THEN s.played_count END DESC NULLS LAST,
    -- 'played' (mas jugaron): played_count DESC, wins DESC
    CASE WHEN v_sort <> 'wins' THEN s.played_count END DESC NULLS LAST,
    CASE WHEN v_sort <> 'wins' THEN s.wins END DESC NULLS LAST,
    s.last_played_at DESC NULLS LAST
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_team_challenge_rankings(text, text, text, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_get_team_challenge_rankings(text, text, text, int, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPC 2: directory of active teams (challengeable). Teams with no confirmed
-- result still appear, with zeroed stats.
-- ---------------------------------------------------------------------------
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
