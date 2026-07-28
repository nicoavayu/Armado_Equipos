BEGIN;

CREATE TEMP TABLE tmp_closed_no_show_matches ON COMMIT DROP AS
SELECT
  sr.partido_id,
  COALESCE(sr.encuesta_cerrada_at, sr.finished_at, sr.updated_at, sr.created_at, now()) AS closed_at
FROM public.survey_results sr
WHERE COALESCE(sr.results_ready, false) = true
ORDER BY 2, 1;

CREATE TEMP TABLE tmp_played_no_show_matches ON COMMIT DROP AS
SELECT s.partido_id
FROM public.post_match_surveys s
JOIN tmp_closed_no_show_matches cm
  ON cm.partido_id = s.partido_id
GROUP BY s.partido_id
HAVING COUNT(*) FILTER (WHERE s.se_jugo IS TRUE) > 0
  OR COUNT(*) FILTER (WHERE s.se_jugo IS FALSE) = 0;

CREATE TEMP TABLE tmp_confirmed_no_show_absences (
  partido_id bigint NOT NULL,
  user_id uuid NOT NULL,
  player_id bigint NOT NULL,
  confirmation_count integer NOT NULL,
  PRIMARY KEY (partido_id, user_id)
) ON COMMIT DROP;

INSERT INTO tmp_confirmed_no_show_absences (
  partido_id,
  user_id,
  player_id,
  confirmation_count
)
WITH raw_absences AS (
  SELECT
    s.partido_id,
    s.votante_id::text AS voter_ref,
    abs.player_ref::bigint AS absent_player_id
  FROM public.post_match_surveys s
  JOIN tmp_played_no_show_matches pm
    ON pm.partido_id = s.partido_id
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(to_jsonb(s.jugadores_ausentes), '[]'::jsonb)
  ) AS abs(player_ref)
  WHERE s.se_jugo IS TRUE
    AND abs.player_ref ~ '^[0-9]+$'
),
confirmed AS (
  SELECT
    partido_id,
    absent_player_id,
    COUNT(DISTINCT voter_ref) FILTER (
      WHERE voter_ref IS NOT NULL
        AND btrim(voter_ref) <> ''
        AND voter_ref <> absent_player_id::text
    )::integer AS confirmation_count
  FROM raw_absences
  GROUP BY 1, 2
)
SELECT
  c.partido_id,
  j.usuario_id,
  c.absent_player_id,
  c.confirmation_count
FROM confirmed c
JOIN public.jugadores j
  ON j.id = c.absent_player_id
 AND j.partido_id = c.partido_id
WHERE c.confirmation_count >= 2
  AND j.usuario_id IS NOT NULL;

CREATE TEMP TABLE tmp_expected_no_show_adjustments (
  user_id uuid NOT NULL,
  partido_id bigint NOT NULL,
  type text NOT NULL,
  amount numeric(8,2) NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, partido_id, type)
) ON COMMIT DROP;

CREATE TEMP TABLE tmp_no_show_rebuild_state (
  user_id uuid PRIMARY KEY,
  debt numeric(8,2) NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0
) ON COMMIT DROP;

DO $$
DECLARE
  match_row record;
  player_row record;
  current_state record;
  next_recovery numeric(8,2);
BEGIN
  FOR match_row IN
    SELECT partido_id, closed_at
    FROM tmp_closed_no_show_matches
    ORDER BY closed_at, partido_id
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM tmp_played_no_show_matches pm
      WHERE pm.partido_id = match_row.partido_id
    ) THEN
      CONTINUE;
    END IF;

    FOR player_row IN
      SELECT user_id, confirmation_count
      FROM tmp_confirmed_no_show_absences
      WHERE partido_id = match_row.partido_id
    LOOP
      INSERT INTO tmp_expected_no_show_adjustments (
        user_id,
        partido_id,
        type,
        amount,
        meta
      ) VALUES (
        player_row.user_id,
        match_row.partido_id,
        'no_show_penalty',
        -0.5,
        jsonb_build_object(
          'reason', 'absence_without_notice',
          'confirmation_count', player_row.confirmation_count,
          'backfilled', true
        )
      )
      ON CONFLICT (user_id, partido_id, type) DO NOTHING;

      INSERT INTO tmp_no_show_rebuild_state (user_id, debt, streak)
      VALUES (player_row.user_id, 0.5, 0)
      ON CONFLICT (user_id) DO UPDATE
      SET
        debt = ROUND(tmp_no_show_rebuild_state.debt + 0.5, 2),
        streak = 0;
    END LOOP;

    FOR player_row IN
      SELECT DISTINCT j.usuario_id AS user_id
      FROM public.jugadores j
      WHERE j.partido_id = match_row.partido_id
        AND j.usuario_id IS NOT NULL
    LOOP
      IF EXISTS (
        SELECT 1
        FROM tmp_confirmed_no_show_absences a
        WHERE a.partido_id = match_row.partido_id
          AND a.user_id = player_row.user_id
      ) THEN
        INSERT INTO tmp_no_show_rebuild_state (user_id, debt, streak)
        VALUES (player_row.user_id, 0, 0)
        ON CONFLICT (user_id) DO UPDATE
        SET streak = 0;
        CONTINUE;
      END IF;

      INSERT INTO tmp_no_show_rebuild_state (user_id, debt, streak)
      VALUES (player_row.user_id, 0, 0)
      ON CONFLICT (user_id) DO NOTHING;

      SELECT debt, streak
      INTO current_state
      FROM tmp_no_show_rebuild_state
      WHERE user_id = player_row.user_id;

      IF COALESCE(current_state.debt, 0) <= 0 THEN
        UPDATE tmp_no_show_rebuild_state
        SET streak = 0
        WHERE user_id = player_row.user_id;
        CONTINUE;
      END IF;

      UPDATE tmp_no_show_rebuild_state
      SET streak = COALESCE(current_state.streak, 0) + 1
      WHERE user_id = player_row.user_id;

      SELECT debt, streak
      INTO current_state
      FROM tmp_no_show_rebuild_state
      WHERE user_id = player_row.user_id;

      IF MOD(COALESCE(current_state.streak, 0), 3) <> 0 THEN
        CONTINUE;
      END IF;

      next_recovery := LEAST(0.2, COALESCE(current_state.debt, 0));
      IF COALESCE(next_recovery, 0) <= 0 THEN
        CONTINUE;
      END IF;

      INSERT INTO tmp_expected_no_show_adjustments (
        user_id,
        partido_id,
        type,
        amount,
        meta
      ) VALUES (
        player_row.user_id,
        match_row.partido_id,
        'no_show_recovery',
        next_recovery,
        jsonb_build_object(
          'cycle_index', FLOOR(COALESCE(current_state.streak, 0) / 3.0),
          'source_partido_id', match_row.partido_id,
          'backfilled', true
        )
      )
      ON CONFLICT (user_id, partido_id, type) DO NOTHING;

      UPDATE tmp_no_show_rebuild_state
      SET debt = ROUND(GREATEST(0, debt - next_recovery), 2)
      WHERE user_id = player_row.user_id;
    END LOOP;
  END LOOP;
END
$$;

CREATE TEMP TABLE tmp_affected_no_show_users (
  user_id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO tmp_affected_no_show_users (user_id)
SELECT DISTINCT e.user_id
FROM tmp_expected_no_show_adjustments e
UNION
SELECT DISTINCT ra.user_id
FROM public.rating_adjustments ra
WHERE ra.type IN ('no_show_penalty', 'no_show_recovery');

CREATE TEMP TABLE tmp_existing_no_show_base ON COMMIT DROP AS
SELECT
  u.id AS user_id,
  COALESCE(u.ranking, 0)::numeric(8,2) AS current_ranking,
  COALESCE(u.partidos_abandonados, 0)::integer AS current_partidos_abandonados,
  COALESCE(
    SUM(CASE WHEN ra.type IN ('no_show_penalty', 'no_show_recovery') THEN ra.amount ELSE 0 END),
    0
  )::numeric(8,2) AS existing_delta,
  COUNT(*) FILTER (WHERE ra.type = 'no_show_penalty')::integer AS existing_penalty_count
FROM public.usuarios u
JOIN tmp_affected_no_show_users a
  ON a.user_id = u.id
LEFT JOIN public.rating_adjustments ra
  ON ra.user_id = u.id
 AND ra.type IN ('no_show_penalty', 'no_show_recovery')
GROUP BY 1, 2, 3;

INSERT INTO public.rating_adjustments (
  user_id,
  partido_id,
  type,
  amount,
  meta,
  created_at
)
SELECT
  e.user_id,
  e.partido_id,
  e.type,
  e.amount,
  e.meta,
  now()
FROM tmp_expected_no_show_adjustments e
ON CONFLICT (user_id, partido_id, type) DO NOTHING;

WITH final_no_show_totals AS (
  SELECT
    ra.user_id,
    COALESCE(SUM(ra.amount), 0)::numeric(8,2) AS final_delta,
    COUNT(*) FILTER (WHERE ra.type = 'no_show_penalty')::integer AS final_penalty_count
  FROM public.rating_adjustments ra
  JOIN tmp_affected_no_show_users a
    ON a.user_id = ra.user_id
  WHERE ra.type IN ('no_show_penalty', 'no_show_recovery')
  GROUP BY 1
)
UPDATE public.usuarios u
SET
  ranking = ROUND(
    (b.current_ranking - b.existing_delta) + COALESCE(t.final_delta, 0),
    2
  ),
  partidos_abandonados = GREATEST(
    0,
    (b.current_partidos_abandonados - b.existing_penalty_count) + COALESCE(t.final_penalty_count, 0)
  )
FROM tmp_existing_no_show_base b
LEFT JOIN final_no_show_totals t
  ON t.user_id = b.user_id
WHERE u.id = b.user_id;

TRUNCATE tmp_no_show_rebuild_state;

DO $$
DECLARE
  match_row record;
  player_row record;
  current_state record;
  applied_penalty numeric(8,2);
  applied_recovery numeric(8,2);
BEGIN
  FOR match_row IN
    SELECT partido_id, closed_at
    FROM tmp_closed_no_show_matches
    ORDER BY closed_at, partido_id
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM tmp_played_no_show_matches pm
      WHERE pm.partido_id = match_row.partido_id
    ) THEN
      CONTINUE;
    END IF;

    FOR player_row IN
      SELECT DISTINCT j.usuario_id AS user_id
      FROM public.jugadores j
      JOIN tmp_affected_no_show_users a
        ON a.user_id = j.usuario_id
      WHERE j.partido_id = match_row.partido_id
        AND j.usuario_id IS NOT NULL
    LOOP
      SELECT
        COALESCE(SUM(CASE WHEN ra.type = 'no_show_penalty' THEN ABS(ra.amount) ELSE 0 END), 0)::numeric(8,2),
        COALESCE(SUM(CASE WHEN ra.type = 'no_show_recovery' THEN GREATEST(ra.amount, 0) ELSE 0 END), 0)::numeric(8,2)
      INTO applied_penalty, applied_recovery
      FROM public.rating_adjustments ra
      WHERE ra.user_id = player_row.user_id
        AND ra.partido_id = match_row.partido_id
        AND ra.type IN ('no_show_penalty', 'no_show_recovery');

      IF EXISTS (
        SELECT 1
        FROM tmp_confirmed_no_show_absences a
        WHERE a.partido_id = match_row.partido_id
          AND a.user_id = player_row.user_id
      ) THEN
        INSERT INTO tmp_no_show_rebuild_state (user_id, debt, streak)
        VALUES (player_row.user_id, COALESCE(applied_penalty, 0), 0)
        ON CONFLICT (user_id) DO UPDATE
        SET
          debt = ROUND(tmp_no_show_rebuild_state.debt + COALESCE(applied_penalty, 0), 2),
          streak = 0;
        CONTINUE;
      END IF;

      INSERT INTO tmp_no_show_rebuild_state (user_id, debt, streak)
      VALUES (player_row.user_id, 0, 0)
      ON CONFLICT (user_id) DO NOTHING;

      SELECT debt, streak
      INTO current_state
      FROM tmp_no_show_rebuild_state
      WHERE user_id = player_row.user_id;

      IF COALESCE(current_state.debt, 0) <= 0 THEN
        UPDATE tmp_no_show_rebuild_state
        SET
          debt = ROUND(GREATEST(0, COALESCE(current_state.debt, 0) - COALESCE(applied_recovery, 0)), 2),
          streak = 0
        WHERE user_id = player_row.user_id;
        CONTINUE;
      END IF;

      UPDATE tmp_no_show_rebuild_state
      SET
        debt = ROUND(GREATEST(0, COALESCE(current_state.debt, 0) - COALESCE(applied_recovery, 0)), 2),
        streak = COALESCE(current_state.streak, 0) + 1
      WHERE user_id = player_row.user_id;
    END LOOP;
  END LOOP;
END
$$;

INSERT INTO public.no_show_recovery_state (
  user_id,
  current_streak,
  updated_at
)
SELECT
  a.user_id,
  COALESCE(s.streak, 0),
  now()
FROM tmp_affected_no_show_users a
LEFT JOIN tmp_no_show_rebuild_state s
  ON s.user_id = a.user_id
ON CONFLICT (user_id) DO UPDATE
SET
  current_streak = EXCLUDED.current_streak,
  updated_at = EXCLUDED.updated_at;

COMMIT;
