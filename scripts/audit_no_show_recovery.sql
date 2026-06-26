-- Read-only audit for the no-show penalty / recovery system (GRADUAL rule).
--
-- Makes NO changes. Safe to run against prod. To be extra safe you can wrap it in
-- BEGIN; ... ROLLBACK;.
-- Usage: supabase db query --linked < scripts/audit_no_show_recovery.sql
--
-- Business rule it audits:
--   * A confirmed no-show applies a -0.5 penalty.
--   * Every 3 correctly-played matches afterwards restore +0.2 (the last cycle only
--     the leftover), so a single -0.5 penalty takes NINE correct matches to fully
--     clear: 4.5 → 4.7 (3) → 4.9 (6) → 5.0 (9).
--   * Cancelled / not-played matches and matches where the player was confirmed
--     absent again do NOT advance the streak.
--
-- It reconstructs, per affected player, the outstanding no-show debt and the current
-- attendance streak by replaying their closed, eligible matches in chronological
-- order, then flags whether a 4.9 / mid-recovery player is simply still climbing the
-- 9-match ladder or is GENUINELY STUCK (the recovery logic should have fired but a
-- recovery row is missing).

WITH closed AS (
  SELECT
    sr.partido_id,
    COALESCE(sr.encuesta_cerrada_at, sr.finished_at, sr.updated_at, sr.created_at, now()) AS closed_at
  FROM public.survey_results sr
  WHERE COALESCE(sr.results_ready, false) = true
),
played AS (
  SELECT s.partido_id
  FROM public.post_match_surveys s
  JOIN closed cm ON cm.partido_id = s.partido_id
  GROUP BY s.partido_id
  HAVING COUNT(*) FILTER (WHERE s.se_jugo IS TRUE) > 0
     OR COUNT(*) FILTER (WHERE s.se_jugo IS FALSE) = 0
),
raw_absences AS (
  SELECT
    s.partido_id,
    s.votante_id::text AS voter_ref,
    a.player_ref::bigint AS absent_player_id
  FROM public.post_match_surveys s
  JOIN played pm ON pm.partido_id = s.partido_id
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(to_jsonb(s.jugadores_ausentes), '[]'::jsonb)
  ) AS a(player_ref)
  WHERE s.se_jugo IS TRUE AND a.player_ref ~ '^[0-9]+$'
),
absences AS (
  SELECT DISTINCT c.partido_id, j.usuario_id AS user_id
  FROM (
    SELECT partido_id, absent_player_id
    FROM raw_absences
    GROUP BY 1, 2
    HAVING COUNT(DISTINCT voter_ref) FILTER (
      WHERE voter_ref IS NOT NULL AND btrim(voter_ref) <> ''
        AND voter_ref <> absent_player_id::text
    ) >= 2
  ) c
  JOIN public.jugadores j ON j.id = c.absent_player_id AND j.partido_id = c.partido_id
  WHERE j.usuario_id IS NOT NULL
),
-- Per (user, match) events ordered chronologically, only for players who ever had a
-- no-show penalty.
events AS (
  SELECT
    j.usuario_id AS user_id,
    cl.partido_id,
    cl.closed_at,
    (ab.user_id IS NOT NULL) AS was_absent
  FROM closed cl
  JOIN played pm ON pm.partido_id = cl.partido_id
  JOIN public.jugadores j ON j.partido_id = cl.partido_id AND j.usuario_id IS NOT NULL
  LEFT JOIN absences ab ON ab.partido_id = cl.partido_id AND ab.user_id = j.usuario_id
  WHERE j.usuario_id IN (SELECT DISTINCT user_id FROM public.rating_adjustments WHERE type = 'no_show_penalty')
),
-- Gap-island trick, step 1: label each row with the absence "island" it belongs to
-- (a running count of how many absences happened up to and including this row).
grouped AS (
  SELECT
    user_id, partido_id, closed_at, was_absent,
    SUM(CASE WHEN was_absent THEN 1 ELSE 0 END) OVER (
      PARTITION BY user_id ORDER BY closed_at, partido_id
    ) AS absence_group
  FROM events
),
-- Step 2: correct matches accumulated since the player's most recent absence.
walk AS (
  SELECT
    user_id, partido_id, closed_at, was_absent,
    SUM(CASE WHEN was_absent THEN 0 ELSE 1 END) OVER (
      PARTITION BY user_id, absence_group ORDER BY closed_at, partido_id
    ) AS correct_since_absence
  FROM grouped
),
user_state AS (
  SELECT
    user_id,
    MAX(correct_since_absence) FILTER (WHERE NOT was_absent) AS latest_streak
  FROM walk
  GROUP BY user_id
),
agg AS (
  SELECT
    u.id AS user_id,
    u.ranking,
    u.partidos_abandonados,
    COALESCE(SUM(ra.amount) FILTER (WHERE ra.type = 'no_show_penalty'), 0)::numeric(8,2) AS total_penalized,
    COALESCE(SUM(ra.amount) FILTER (WHERE ra.type = 'no_show_recovery'), 0)::numeric(8,2) AS total_recovered,
    COALESCE(SUM(ra.amount), 0)::numeric(8,2) AS net_no_show_delta,
    COUNT(*) FILTER (WHERE ra.type = 'no_show_penalty') AS penalty_rows,
    COUNT(*) FILTER (WHERE ra.type = 'no_show_recovery') AS recovery_rows,
    COALESCE(st.latest_streak, 0) AS current_correct_streak
  FROM public.usuarios u
  JOIN (SELECT DISTINCT user_id FROM public.rating_adjustments WHERE type = 'no_show_penalty') aff
    ON aff.user_id = u.id
  LEFT JOIN public.rating_adjustments ra
    ON ra.user_id = u.id AND ra.type IN ('no_show_penalty', 'no_show_recovery')
  LEFT JOIN user_state st ON st.user_id = u.id
  GROUP BY u.id, u.ranking, u.partidos_abandonados, st.latest_streak
)
SELECT
  user_id,
  ranking,
  partidos_abandonados,
  total_penalized,
  total_recovered,
  -- Remaining debt = how much ranking is still withheld (>0 means below pre-penalty).
  GREATEST(0, ROUND(-net_no_show_delta, 2)) AS remaining_debt,
  penalty_rows,
  recovery_rows,
  current_correct_streak,
  -- How many recovery cycles the current streak has completed (3 correct = 1 cycle).
  FLOOR(current_correct_streak / 3)::int AS cycles_completed,
  -- Correct matches still needed to reach the next +0.2 milestone.
  (3 - MOD(current_correct_streak, 3))::int AS matches_to_next_cycle,
  -- GENUINELY STUCK: the player completed more recovery cycles than the recovery rows
  -- they actually received, yet still owes debt → the recovery logic failed to fire.
  (
    GREATEST(0, ROUND(-net_no_show_delta, 2)) > 0
    AND FLOOR(current_correct_streak / 3)::int > recovery_rows
  ) AS is_stuck,
  -- FINAL-STEP OWED: only the trailing +0.1 (or less) is left AND the player has the
  -- streak that should already have granted it but no matching recovery row exists.
  (
    GREATEST(0, ROUND(-net_no_show_delta, 2)) > 0
    AND GREATEST(0, ROUND(-net_no_show_delta, 2)) <= 0.1
    AND FLOOR(current_correct_streak / 3)::int > recovery_rows
  ) AS final_step_owed,
  -- Human-readable verdict for the row.
  CASE
    WHEN ROUND(-net_no_show_delta, 2) <= 0 THEN 'fully recovered'
    WHEN FLOOR(current_correct_streak / 3)::int > recovery_rows THEN 'STUCK — recovery did not fire'
    ELSE 'on track — needs ' || (3 - MOD(current_correct_streak, 3))::text || ' more correct match(es) for next +0.2'
  END AS verdict
FROM agg
ORDER BY is_stuck DESC, remaining_debt DESC, current_correct_streak DESC;
