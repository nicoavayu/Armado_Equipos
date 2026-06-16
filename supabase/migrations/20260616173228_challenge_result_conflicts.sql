-- ============================================================================
-- Challenge result reports and conflict state
-- Date: 2026-06-16
--
-- Manual challenge results now keep one report per team. A single report can
-- remain provisional, two compatible reports confirm the final result, and two
-- incompatible reports leave the team_match blocked as "result_conflict" with
-- result_status NULL so statistics do not count a win/draw/loss.
-- ============================================================================

BEGIN;

ALTER TABLE public.team_matches
  ADD COLUMN IF NOT EXISTS result_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS result_conflict boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS result_conflict_at timestamptz NULL;

ALTER TABLE public.team_matches
  ALTER COLUMN result_confirmed SET DEFAULT false,
  ALTER COLUMN result_conflict SET DEFAULT false;

ALTER TABLE public.team_matches
  ALTER COLUMN result_confirmed SET NOT NULL,
  ALTER COLUMN result_conflict SET NOT NULL;

-- Preserve historical/backfilled rows that had a loaded result but no
-- per-team reporter metadata. New one-team reports stay unconfirmed until the
-- rival responds.
UPDATE public.team_matches tm
SET
  result_confirmed = true,
  result_conflict = false,
  result_conflict_at = NULL
WHERE tm.result_status IN ('team_a_win', 'team_b_win', 'draw')
  AND tm.result_reported_by_team_id IS NULL
  AND (
    tm.challenge_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.challenges c
      WHERE c.id = tm.challenge_id
        AND c.status IN ('accepted', 'confirmed', 'completed')
    )
  );

CREATE TABLE IF NOT EXISTS public.challenge_result_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_match_id uuid NOT NULL REFERENCES public.team_matches(id) ON DELETE CASCADE,
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  reporting_team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  reported_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_result_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenge_result_reports_status_check
    CHECK (reported_result_status IN ('team_a_win', 'team_b_win', 'draw')),
  CONSTRAINT challenge_result_reports_unique_team
    UNIQUE (team_match_id, reporting_team_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_result_reports_challenge_id
  ON public.challenge_result_reports(challenge_id);

CREATE INDEX IF NOT EXISTS idx_challenge_result_reports_team_match_id
  ON public.challenge_result_reports(team_match_id);

ALTER TABLE public.challenge_result_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.challenge_result_reports FROM PUBLIC, anon, authenticated;

-- Backfill one report from the existing single-reporter metadata so the rival
-- can still confirm or dispute a result that was already loaded by one side.
INSERT INTO public.challenge_result_reports (
  team_match_id,
  challenge_id,
  reporting_team_id,
  reported_by_user_id,
  reported_result_status,
  created_at,
  updated_at
)
SELECT
  tm.id,
  tm.challenge_id,
  tm.result_reported_by_team_id,
  NULL::uuid,
  tm.result_status,
  COALESCE(tm.result_reported_at, tm.updated_at, tm.created_at, now()),
  COALESCE(tm.result_updated_at, tm.updated_at, tm.created_at, now())
FROM public.team_matches tm
WHERE tm.challenge_id IS NOT NULL
  AND tm.result_reported_by_team_id IS NOT NULL
  AND tm.result_status IN ('team_a_win', 'team_b_win', 'draw')
ON CONFLICT (team_match_id, reporting_team_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.rpc_report_challenge_result(
  p_challenge_id uuid,
  p_result_status text
)
RETURNS public.team_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_match public.team_matches%ROWTYPE;
  v_reporter_team_id uuid;
  v_can_report_for_challenger boolean := false;
  v_can_report_for_accepted boolean := false;
  v_report_count integer := 0;
  v_distinct_status_count integer := 0;
  v_resolved_status text := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_result_status IS NULL OR p_result_status NOT IN ('team_a_win', 'team_b_win', 'draw') THEN
    RAISE EXCEPTION 'Resultado invalido';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  IF v_challenge.accepted_team_id IS NULL THEN
    RAISE EXCEPTION 'Challenge sin equipo rival';
  END IF;

  IF v_challenge.status NOT IN ('accepted', 'confirmed', 'completed') THEN
    RAISE EXCEPTION 'Solo se puede responder el resultado en desafios confirmados';
  END IF;

  IF v_challenge.status = 'accepted'
     AND (v_challenge.scheduled_at IS NULL OR v_challenge.scheduled_at > now()) THEN
    RAISE EXCEPTION 'Solo se puede responder el resultado cuando el desafio ya se jugo';
  END IF;

  v_can_report_for_challenger := public.team_user_is_admin_or_owner(v_challenge.challenger_team_id, v_uid)
    OR public.team_user_is_captain_or_owner(v_challenge.challenger_team_id, v_uid);
  v_can_report_for_accepted := public.team_user_is_admin_or_owner(v_challenge.accepted_team_id, v_uid)
    OR public.team_user_is_captain_or_owner(v_challenge.accepted_team_id, v_uid);

  IF NOT (v_can_report_for_challenger OR v_can_report_for_accepted) THEN
    RAISE EXCEPTION 'Solo owner/capitan/admin involucrado puede responder el resultado';
  END IF;

  IF v_can_report_for_challenger AND v_can_report_for_accepted THEN
    RAISE EXCEPTION 'No se pudo identificar un unico equipo para responder el resultado';
  END IF;

  IF v_can_report_for_challenger THEN
    v_reporter_team_id := v_challenge.challenger_team_id;
  ELSE
    v_reporter_team_id := v_challenge.accepted_team_id;
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.challenge_id = p_challenge_id
  FOR UPDATE;

  IF FOUND THEN
    IF COALESCE(v_match.result_conflict, false) THEN
      RAISE EXCEPTION 'El resultado del desafio esta en conflicto y requiere revision manual';
    END IF;

    IF COALESCE(v_match.result_confirmed, false) THEN
      RAISE EXCEPTION 'El resultado del desafio ya fue confirmado';
    END IF;
  ELSE
    INSERT INTO public.team_matches (
      origin_type,
      challenge_id,
      team_a_id,
      team_b_id,
      played_at,
      scheduled_at,
      format,
      mode,
      location,
      location_name,
      status,
      result_status,
      result_confirmed,
      result_conflict,
      result_reported_by_team_id,
      result_reported_at,
      result_updated_at,
      updated_at
    ) VALUES (
      'challenge',
      v_challenge.id,
      v_challenge.challenger_team_id,
      v_challenge.accepted_team_id,
      now(),
      COALESCE(v_challenge.scheduled_at, now()),
      v_challenge.format,
      v_challenge.mode,
      COALESCE(v_challenge.location, v_challenge.location_name),
      COALESCE(v_challenge.location, v_challenge.location_name),
      'played',
      NULL,
      false,
      false,
      NULL,
      NULL,
      NULL,
      now()
    )
    RETURNING * INTO v_match;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.challenge_result_reports r
    WHERE r.team_match_id = v_match.id
      AND r.reporting_team_id = v_reporter_team_id
  ) THEN
    RAISE EXCEPTION 'Tu equipo ya cargo el resultado de este desafio';
  END IF;

  INSERT INTO public.challenge_result_reports (
    team_match_id,
    challenge_id,
    reporting_team_id,
    reported_by_user_id,
    reported_result_status,
    created_at,
    updated_at
  ) VALUES (
    v_match.id,
    v_challenge.id,
    v_reporter_team_id,
    v_uid,
    p_result_status,
    now(),
    now()
  );

  SELECT
    COUNT(*)::integer,
    COUNT(DISTINCT r.reported_result_status)::integer,
    MIN(r.reported_result_status)
  INTO
    v_report_count,
    v_distinct_status_count,
    v_resolved_status
  FROM public.challenge_result_reports r
  WHERE r.team_match_id = v_match.id;

  IF v_report_count >= 2 AND v_distinct_status_count = 1 THEN
    UPDATE public.team_matches tm
    SET
      status = 'played',
      played_at = COALESCE(tm.played_at, tm.scheduled_at, now()),
      result_status = v_resolved_status,
      result_confirmed = true,
      result_conflict = false,
      result_conflict_at = NULL,
      result_reported_by_team_id = NULL,
      result_reported_at = COALESCE(tm.result_reported_at, now()),
      result_updated_at = now(),
      updated_at = now()
    WHERE tm.id = v_match.id
    RETURNING * INTO v_match;
  ELSIF v_report_count >= 2 THEN
    UPDATE public.team_matches tm
    SET
      status = 'played',
      played_at = COALESCE(tm.played_at, tm.scheduled_at, now()),
      result_status = NULL,
      result_confirmed = false,
      result_conflict = true,
      result_conflict_at = now(),
      result_reported_by_team_id = NULL,
      result_reported_at = COALESCE(tm.result_reported_at, now()),
      result_updated_at = now(),
      updated_at = now()
    WHERE tm.id = v_match.id
    RETURNING * INTO v_match;
  ELSE
    UPDATE public.team_matches tm
    SET
      status = 'played',
      played_at = COALESCE(tm.played_at, tm.scheduled_at, now()),
      result_status = p_result_status,
      result_confirmed = false,
      result_conflict = false,
      result_conflict_at = NULL,
      result_reported_by_team_id = v_reporter_team_id,
      result_reported_at = COALESCE(tm.result_reported_at, now()),
      result_updated_at = now(),
      updated_at = now()
    WHERE tm.id = v_match.id
    RETURNING * INTO v_match;
  END IF;

  RETURN v_match;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_report_challenge_result(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_update_team_match_details(
  p_match_id uuid,
  p_scheduled_at timestamptz,
  p_location text,
  p_cancha_cost numeric,
  p_mode text,
  p_format smallint DEFAULT NULL
)
RETURNS public.team_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.team_matches%ROWTYPE;
  v_challenge public.challenges%ROWTYPE;
  v_next_status text;
  v_partido_estado text;
  v_partido_result_status text;
  v_partido_finished_at timestamptz;
  v_has_result boolean := false;
  v_can_edit boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT *
  INTO v_match
  FROM public.team_matches tm
  WHERE tm.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido no encontrado';
  END IF;

  IF lower(COALESCE(v_match.origin_type, '')) <> 'challenge' OR v_match.challenge_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges c
  WHERE c.id = v_match.challenge_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge no encontrado';
  END IF;

  v_can_edit := v_challenge.created_by_user_id = v_uid
    OR public.team_user_is_admin_or_owner(v_match.team_a_id, v_uid)
    OR public.team_user_is_admin_or_owner(v_match.team_b_id, v_uid)
    OR public.team_user_is_captain_or_owner(v_match.team_a_id, v_uid)
    OR public.team_user_is_captain_or_owner(v_match.team_b_id, v_uid);

  IF NOT v_can_edit THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_has_result := v_match.result_status IN ('team_a_win', 'team_b_win', 'draw')
    OR COALESCE(v_match.result_confirmed, false)
    OR COALESCE(v_match.result_conflict, false);

  IF lower(COALESCE(v_match.status, '')) IN ('cancelled', 'canceled', 'cancelado') THEN
    RAISE EXCEPTION 'No se puede editar un partido %', v_match.status;
  END IF;

  IF v_has_result THEN
    RAISE EXCEPTION 'No se puede editar un partido con resultado cargado';
  END IF;

  IF v_match.partido_id IS NOT NULL THEN
    SELECT
      p.estado,
      p.result_status,
      p.finished_at
    INTO
      v_partido_estado,
      v_partido_result_status,
      v_partido_finished_at
    FROM public.partidos p
    WHERE p.id = v_match.partido_id;

    IF FOUND AND (
      lower(COALESCE(v_partido_estado, '')) IN ('cancelado', 'cancelled', 'canceled', 'finalizado', 'finished')
      OR lower(COALESCE(v_partido_result_status, '')) IN ('not_played', 'finished', 'draw')
      OR (v_partido_finished_at IS NOT NULL AND v_partido_finished_at <= now())
    ) THEN
      RAISE EXCEPTION 'No se puede editar un partido finalizado';
    END IF;
  END IF;

  IF p_cancha_cost IS NOT NULL AND p_cancha_cost < 0 THEN
    RAISE EXCEPTION 'El costo de cancha no puede ser negativo';
  END IF;

  IF p_format IS NOT NULL AND p_format NOT IN (5, 6, 7, 8, 9, 11) THEN
    RAISE EXCEPTION 'Formato invalido. Valores permitidos: 5,6,7,8,9,11';
  END IF;

  UPDATE public.challenges c
  SET
    scheduled_at = p_scheduled_at,
    location = NULLIF(btrim(COALESCE(p_location, '')), ''),
    location_name = NULLIF(btrim(COALESCE(p_location, '')), ''),
    cancha_cost = p_cancha_cost,
    field_price = p_cancha_cost,
    mode = NULLIF(btrim(COALESCE(p_mode, '')), ''),
    format = COALESCE(p_format, c.format),
    match_format = COALESCE(p_format, c.match_format, c.format),
    updated_at = now()
  WHERE c.id = v_match.challenge_id;

  v_next_status := CASE
    WHEN lower(COALESCE(v_match.status, '')) = 'played' THEN 'played'
    WHEN p_scheduled_at IS NOT NULL
      AND NULLIF(btrim(COALESCE(p_location, '')), '') IS NOT NULL THEN 'confirmed'
    ELSE 'pending'
  END;

  UPDATE public.team_matches tm
  SET
    scheduled_at = p_scheduled_at,
    location = NULLIF(btrim(COALESCE(p_location, '')), ''),
    location_name = NULLIF(btrim(COALESCE(p_location, '')), ''),
    cancha_cost = p_cancha_cost,
    mode = NULLIF(btrim(COALESCE(p_mode, '')), ''),
    format = COALESCE(p_format, tm.format),
    status = v_next_status,
    updated_at = now()
  WHERE tm.id = p_match_id
  RETURNING * INTO v_match;

  RETURN v_match;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_update_team_match_details(
  p_match_id uuid,
  p_scheduled_at timestamptz,
  p_location text,
  p_cancha_cost numeric,
  p_mode text
)
RETURNS public.team_matches
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.rpc_update_team_match_details(
    p_match_id,
    p_scheduled_at,
    p_location,
    p_cancha_cost,
    p_mode,
    NULL::smallint
  );
$$;

GRANT EXECUTE ON FUNCTION public.rpc_update_team_match_details(uuid, timestamptz, text, numeric, text, smallint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_update_team_match_details(uuid, timestamptz, text, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_get_challenge_head_to_head_stats(
  p_team_a_id uuid,
  p_team_b_id uuid,
  p_exclude_match_id uuid DEFAULT NULL
)
RETURNS TABLE (
  "totalEncounters" bigint,
  "totalMatchesPlayed" bigint,
  "lastEncounterAt" timestamptz,
  "lastResultAt" timestamptz,
  "lastWinnerTeamId" uuid,
  "lastResultStatus" text,
  "winsTeamA" bigint,
  "winsTeamB" bigint,
  "draws" bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_team_a_id IS NULL OR p_team_b_id IS NULL THEN
    RAISE EXCEPTION 'Equipos invalidos';
  END IF;

  IF p_team_a_id = p_team_b_id THEN
    RETURN QUERY
    SELECT 0::bigint, 0::bigint, NULL::timestamptz, NULL::timestamptz,
           NULL::uuid, NULL::text, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF NOT (
    public.team_user_is_member(p_team_a_id, v_uid)
    OR public.team_user_is_member(p_team_b_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  WITH scoped_matches AS (
    SELECT
      tm.id,
      tm.team_a_id,
      tm.team_b_id,
      tm.status,
      tm.score_a,
      tm.score_b,
      tm.result_status,
      tm.result_confirmed,
      tm.result_conflict,
      COALESCE(tm.scheduled_at, tm.played_at, tm.created_at) AS encounter_at,
      COALESCE(tm.result_reported_at, tm.played_at, tm.updated_at, tm.created_at) AS result_at,
      tm.created_at
    FROM public.team_matches tm
    WHERE
      (lower(COALESCE(tm.origin_type, '')) = 'challenge' OR tm.challenge_id IS NOT NULL)
      AND (p_exclude_match_id IS NULL OR tm.id <> p_exclude_match_id)
      AND (
        (tm.team_a_id = p_team_a_id AND tm.team_b_id = p_team_b_id)
        OR (tm.team_a_id = p_team_b_id AND tm.team_b_id = p_team_a_id)
      )
  ),
  encounters AS (
    SELECT *
    FROM scoped_matches sm
    WHERE lower(COALESCE(sm.status, '')) <> 'cancelled'
  ),
  played AS (
    SELECT
      e.id,
      e.result_at,
      e.created_at,
      CASE
        WHEN e.result_status = 'team_a_win' THEN e.team_a_id
        WHEN e.result_status = 'team_b_win' THEN e.team_b_id
        WHEN e.result_status = 'draw' THEN NULL::uuid
        WHEN e.result_status IS NULL AND e.score_a > e.score_b THEN e.team_a_id
        WHEN e.result_status IS NULL AND e.score_b > e.score_a THEN e.team_b_id
        ELSE NULL::uuid
      END AS winner_team_id,
      CASE
        WHEN e.result_status = 'draw' THEN true
        WHEN e.result_status IS NULL AND e.score_a = e.score_b THEN true
        ELSE false
      END AS is_draw
    FROM encounters e
    WHERE lower(COALESCE(e.status, '')) = 'played'
      AND COALESCE(e.result_conflict, false) = false
      AND (
        (COALESCE(e.result_confirmed, true) = true AND e.result_status IN ('team_a_win', 'team_b_win', 'draw'))
        OR (e.result_status IS NULL AND e.score_a IS NOT NULL AND e.score_b IS NOT NULL)
      )
  ),
  last_result AS (
    SELECT p.winner_team_id, p.is_draw, p.result_at
    FROM played p
    ORDER BY p.result_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id DESC
    LIMIT 1
  )
  SELECT
    (SELECT COUNT(*) FROM encounters)::bigint AS "totalEncounters",
    (SELECT COUNT(*) FROM played)::bigint AS "totalMatchesPlayed",
    (SELECT MAX(e.encounter_at) FROM encounters e) AS "lastEncounterAt",
    (SELECT lr.result_at FROM last_result lr) AS "lastResultAt",
    (SELECT lr.winner_team_id FROM last_result lr) AS "lastWinnerTeamId",
    (SELECT CASE
        WHEN lr.is_draw THEN 'draw'
        WHEN lr.winner_team_id = p_team_a_id THEN 'team_a_win'
        WHEN lr.winner_team_id = p_team_b_id THEN 'team_b_win'
        ELSE NULL
      END FROM last_result lr) AS "lastResultStatus",
    COALESCE((SELECT COUNT(*) FROM played p WHERE p.winner_team_id = p_team_a_id), 0)::bigint AS "winsTeamA",
    COALESCE((SELECT COUNT(*) FROM played p WHERE p.winner_team_id = p_team_b_id), 0)::bigint AS "winsTeamB",
    COALESCE((SELECT COUNT(*) FROM played p WHERE p.is_draw), 0)::bigint AS "draws";
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_challenge_head_to_head_stats(uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_team_history_by_rival(p_team_id uuid)
RETURNS TABLE (
  rival_id uuid,
  rival_name text,
  rival_format smallint,
  rival_base_zone text,
  rival_skill_level text,
  rival_crest_url text,
  rival_color_primary text,
  rival_color_secondary text,
  rival_color_accent text,
  played bigint,
  won bigint,
  draw bigint,
  lost bigint,
  last_played_at timestamptz
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scoped_matches AS (
    SELECT
      COALESCE(tm.result_reported_at, tm.played_at, tm.created_at) AS played_at,
      CASE
        WHEN tm.team_a_id = p_team_id THEN tm.team_b_id
        ELSE tm.team_a_id
      END AS rival_id,
      CASE
        WHEN tm.result_status = 'draw' THEN 'draw'
        WHEN tm.result_status = 'team_a_win' THEN (CASE WHEN tm.team_a_id = p_team_id THEN 'won' ELSE 'lost' END)
        WHEN tm.result_status = 'team_b_win' THEN (CASE WHEN tm.team_b_id = p_team_id THEN 'won' ELSE 'lost' END)
        WHEN tm.result_status IS NULL AND tm.score_a = tm.score_b THEN 'draw'
        WHEN (CASE WHEN tm.team_a_id = p_team_id THEN tm.score_a ELSE tm.score_b END)
           > (CASE WHEN tm.team_a_id = p_team_id THEN tm.score_b ELSE tm.score_a END)
          THEN 'won'
        ELSE 'lost'
      END AS outcome
    FROM public.team_matches tm
    WHERE lower(COALESCE(tm.status, '')) = 'played'
      AND (tm.team_a_id = p_team_id OR tm.team_b_id = p_team_id)
      AND COALESCE(tm.result_conflict, false) = false
      AND (
        (COALESCE(tm.result_confirmed, true) = true AND tm.result_status IN ('team_a_win', 'team_b_win', 'draw'))
        OR (tm.result_status IS NULL AND tm.score_a IS NOT NULL AND tm.score_b IS NOT NULL)
      )
  )
  SELECT
    sm.rival_id,
    t.name AS rival_name,
    t.format AS rival_format,
    t.base_zone AS rival_base_zone,
    t.skill_level AS rival_skill_level,
    t.crest_url AS rival_crest_url,
    t.color_primary AS rival_color_primary,
    t.color_secondary AS rival_color_secondary,
    t.color_accent AS rival_color_accent,
    COUNT(*)::bigint AS played,
    SUM(CASE WHEN sm.outcome = 'won' THEN 1 ELSE 0 END)::bigint AS won,
    SUM(CASE WHEN sm.outcome = 'draw' THEN 1 ELSE 0 END)::bigint AS draw,
    SUM(CASE WHEN sm.outcome = 'lost' THEN 1 ELSE 0 END)::bigint AS lost,
    MAX(sm.played_at) AS last_played_at
  FROM scoped_matches sm
  JOIN public.teams t ON t.id = sm.rival_id
  GROUP BY
    sm.rival_id,
    t.name,
    t.format,
    t.base_zone,
    t.skill_level,
    t.crest_url,
    t.color_primary,
    t.color_secondary,
    t.color_accent
  ORDER BY MAX(sm.played_at) DESC NULLS LAST, t.name ASC;
$$;

REVOKE ALL ON FUNCTION public.rpc_team_history_by_rival(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_team_history_by_rival(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.process_challenge_result_survey_notifications_backend(
  p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(COALESCE(p_limit, 200), 1);
  v_scanned integer := 0;
  v_inserted integer := 0;
  v_queued_pushes integer := 0;
  v_resolved_stale integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('challenge_result_survey_backend_fanout'));

  WITH stale_notifications AS (
    UPDATE public.notifications n
    SET
      read = true,
      status = 'resolved'
    FROM public.team_matches tm
    WHERE n.type = 'challenge_result_survey'
      AND COALESCE(n.status, '') IS DISTINCT FROM 'resolved'
      AND tm.id::text = COALESCE(n.data ->> 'team_match_id', n.data ->> 'teamMatchId')
      AND (COALESCE(tm.result_confirmed, false) = true OR COALESCE(tm.result_conflict, false) = true)
    RETURNING n.id
  )
  SELECT COUNT(*) INTO v_resolved_stale
  FROM stale_notifications;

  WITH eligible_matches AS (
    SELECT
      tm.id AS team_match_id,
      tm.challenge_id,
      tm.partido_id,
      tm.team_a_id,
      tm.team_b_id,
      tm.scheduled_at,
      COALESCE(team_a.name, 'Equipo A') AS team_a_name,
      COALESCE(team_b.name, 'Equipo B') AS team_b_name,
      c.challenger_team_id,
      c.accepted_team_id,
      c.status AS challenge_status
    FROM public.team_matches tm
    JOIN public.challenges c
      ON c.id = tm.challenge_id
    LEFT JOIN public.teams team_a
      ON team_a.id = tm.team_a_id
    LEFT JOIN public.teams team_b
      ON team_b.id = tm.team_b_id
    WHERE tm.challenge_id IS NOT NULL
      AND c.accepted_team_id IS NOT NULL
      AND tm.team_a_id = c.challenger_team_id
      AND tm.team_b_id = c.accepted_team_id
      AND COALESCE(tm.scheduled_at, c.scheduled_at) IS NOT NULL
      AND COALESCE(tm.scheduled_at, c.scheduled_at) + interval '60 minutes' <= now()
      AND COALESCE(tm.scheduled_at, c.scheduled_at) >= now() - interval '48 hours'
      AND lower(COALESCE(c.status, '')) IN ('accepted', 'confirmed', 'completed')
      AND lower(COALESCE(c.status, '')) NOT IN ('open', 'cancelled', 'canceled', 'cancelado', 'rejected')
      AND lower(COALESCE(tm.status, '')) NOT IN ('open', 'cancelled', 'canceled', 'cancelado', 'rejected')
      AND COALESCE(tm.result_confirmed, false) = false
      AND COALESCE(tm.result_conflict, false) = false
    ORDER BY COALESCE(tm.scheduled_at, c.scheduled_at) DESC
    LIMIT v_limit
  ),
  recipients AS (
    SELECT DISTINCT ON (e.team_match_id, r.user_id)
      e.team_match_id,
      e.challenge_id,
      e.partido_id,
      e.team_a_id,
      e.team_b_id,
      e.team_a_name,
      e.team_b_name,
      e.challenger_team_id,
      e.accepted_team_id,
      r.user_id,
      r.managed_team_id
    FROM eligible_matches e
    CROSS JOIN LATERAL (
      SELECT t.owner_user_id AS user_id, t.id AS managed_team_id
      FROM public.teams t
      WHERE t.id IN (e.team_a_id, e.team_b_id)
        AND t.owner_user_id IS NOT NULL

      UNION

      SELECT tm.user_id AS user_id, tm.team_id AS managed_team_id
      FROM public.team_members tm
      WHERE tm.team_id IN (e.team_a_id, e.team_b_id)
        AND tm.user_id IS NOT NULL
        AND (
          COALESCE(tm.is_captain, false) = true
          OR lower(COALESCE(tm.permissions_role, '')) IN ('owner', 'admin')
        )

      UNION

      SELECT j.usuario_id AS user_id, tm.team_id AS managed_team_id
      FROM public.team_members tm
      JOIN public.jugadores j
        ON j.id = tm.jugador_id
      WHERE tm.team_id IN (e.team_a_id, e.team_b_id)
        AND j.usuario_id IS NOT NULL
        AND (
          COALESCE(tm.is_captain, false) = true
          OR lower(COALESCE(tm.permissions_role, '')) IN ('owner', 'admin')
        )
    ) r
    WHERE r.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.challenge_result_reports report
        WHERE report.team_match_id = e.team_match_id
          AND report.reporting_team_id = r.managed_team_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications existing
        WHERE existing.user_id = r.user_id
          AND existing.type = 'challenge_result_survey'
          AND COALESCE(existing.data ->> 'team_match_id', existing.data ->> 'teamMatchId') = e.team_match_id::text
      )
    ORDER BY
      e.team_match_id,
      r.user_id,
      CASE WHEN r.managed_team_id = e.team_a_id THEN 0 ELSE 1 END
  ),
  inserted_notifications AS (
    INSERT INTO public.notifications (
      user_id,
      partido_id,
      type,
      title,
      message,
      data,
      status,
      read,
      send_at,
      created_at
    )
    SELECT
      r.user_id,
      r.partido_id,
      'challenge_result_survey',
      'Resultado pendiente',
      '¿Cómo salió el desafío vs ' ||
        CASE
          WHEN r.managed_team_id = r.team_a_id THEN r.team_b_name
          ELSE r.team_a_name
        END || '?',
      jsonb_build_object(
        'source', 'team_challenge',
        'source_detail', 'backend_scheduler',
        'action', 'open_challenge_result_modal',
        'team_match_id', r.team_match_id,
        'teamMatchId', r.team_match_id,
        'challenge_id', r.challenge_id,
        'challengeId', r.challenge_id,
        'partido_id', r.partido_id,
        'partidoId', r.partido_id,
        'managed_team_id', r.managed_team_id,
        'reporting_team_id', r.managed_team_id,
        'challenger_team_id', r.challenger_team_id,
        'accepted_team_id', r.accepted_team_id,
        'rival_team_id',
          CASE
            WHEN r.managed_team_id = r.team_a_id THEN r.team_b_id
            ELSE r.team_a_id
          END,
        'rival_name',
          CASE
            WHEN r.managed_team_id = r.team_a_id THEN r.team_b_name
            ELSE r.team_a_name
          END,
        'team_a_name', r.team_a_name,
        'team_b_name', r.team_b_name,
        'target_path', '/desafios/equipos/partidos/' || r.team_match_id::text || '?action=open_challenge_result_modal',
        'route', '/desafios/equipos/partidos/' || r.team_match_id::text || '?action=open_challenge_result_modal',
        'link', '/desafios/equipos/partidos/' || r.team_match_id::text || '?action=open_challenge_result_modal'
      ),
      'sent',
      false,
      now(),
      now()
    FROM recipients r
    ON CONFLICT DO NOTHING
    RETURNING id, user_id, partido_id, type, title, message, data
  ),
  queued_pushes AS (
    INSERT INTO public.notification_delivery_log (
      partido_id,
      user_id,
      notification_type,
      payload_json,
      channel,
      status
    )
    SELECT
      n.partido_id,
      n.user_id,
      'challenge_result_survey',
      n.data || jsonb_build_object(
        'event_channel', 'ACTION',
        'notification_id', n.id,
        'source_notification_type', n.type,
        'notification_type', 'challenge_result_survey',
        'title', COALESCE(n.title, 'Resultado pendiente'),
        'message', COALESCE(n.message, 'Respondé cómo salió el desafío.'),
        'source', 'backend_scheduler'
      ),
      'push',
      'queued'
    FROM inserted_notifications n
    RETURNING id
  )
  SELECT
    (SELECT COUNT(*) FROM eligible_matches),
    (SELECT COUNT(*) FROM inserted_notifications),
    (SELECT COUNT(*) FROM queued_pushes)
  INTO v_scanned, v_inserted, v_queued_pushes;

  RETURN jsonb_build_object(
    'success', true,
    'scanned', v_scanned,
    'inserted_notifications', v_inserted,
    'queued_pushes', v_queued_pushes,
    'resolved_stale', v_resolved_stale
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_challenge_result_survey_notifications_backend(integer) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'service_role'
  ) THEN
    GRANT EXECUTE ON FUNCTION public.process_challenge_result_survey_notifications_backend(integer) TO service_role;
  END IF;
END
$$;

COMMENT ON FUNCTION public.process_challenge_result_survey_notifications_backend(integer)
IS 'Backend fanout for challenge result prompts. Keeps prompting teams that have not reported until the result is confirmed or disputed.';

WITH aged_notifications AS (
  SELECT n.id
  FROM public.notifications n
  JOIN public.team_matches tm
    ON tm.id::text = COALESCE(n.data ->> 'team_match_id', n.data ->> 'teamMatchId')
  LEFT JOIN public.challenges c
    ON c.id = tm.challenge_id
  WHERE n.type = 'challenge_result_survey'
    AND COALESCE(n.status, '') IS DISTINCT FROM 'resolved'
    AND COALESCE(tm.result_confirmed, false) = false
    AND COALESCE(tm.result_conflict, false) = false
    AND COALESCE(tm.scheduled_at, c.scheduled_at) < now() - interval '48 hours'
)
UPDATE public.notifications n
SET
  read = true,
  status = 'resolved'
FROM aged_notifications a
WHERE n.id = a.id;

UPDATE public.notification_delivery_log l
SET
  status = 'skipped',
  error_code = COALESCE(l.error_code, 'stale_backfill_window'),
  error_text = COALESCE(l.error_text, 'Skipped challenge_result_survey push for a match outside the recent (48h) window.'),
  next_retry_at = NULL,
  processing_started_at = NULL,
  processing_by = NULL
FROM public.team_matches tm
LEFT JOIN public.challenges c
  ON c.id = tm.challenge_id
WHERE l.notification_type = 'challenge_result_survey'
  AND l.channel = 'push'
  AND l.status IN ('queued', 'processing', 'retryable_failed')
  AND tm.id::text = COALESCE(l.payload_json ->> 'team_match_id', l.payload_json ->> 'teamMatchId')
  AND COALESCE(tm.result_confirmed, false) = false
  AND COALESCE(tm.result_conflict, false) = false
  AND COALESCE(tm.scheduled_at, c.scheduled_at) < now() - interval '48 hours';

COMMIT;
