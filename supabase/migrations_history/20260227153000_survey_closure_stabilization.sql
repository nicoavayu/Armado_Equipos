BEGIN;

ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS survey_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS survey_closes_at timestamptz,
  ADD COLUMN IF NOT EXISTS survey_expected_voters integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS survey_status text NOT NULL DEFAULT 'open';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'partidos_survey_status_check'
      AND conrelid = 'public.partidos'::regclass
  ) THEN
    ALTER TABLE public.partidos
      ADD CONSTRAINT partidos_survey_status_check
      CHECK (survey_status IN ('open', 'closed'));
  END IF;
END;
$$;

WITH eligible AS (
  SELECT
    p.id AS partido_id,
    COUNT(DISTINCT j.usuario_id)::int AS expected_voters
  FROM public.partidos p
  LEFT JOIN public.jugadores j
    ON j.partido_id = p.id
   AND j.usuario_id IS NOT NULL
  GROUP BY p.id
)
UPDATE public.partidos p
SET
  survey_opened_at = COALESCE(p.survey_opened_at, p.finished_at, now()),
  survey_closes_at = COALESCE(
    p.survey_closes_at,
    COALESCE(p.survey_opened_at, p.finished_at, now()) + interval '12 hours'
  ),
  survey_expected_voters = CASE
    WHEN p.survey_expected_voters IS NULL OR p.survey_expected_voters < 0 THEN COALESCE(e.expected_voters, 0)
    WHEN p.survey_expected_voters = 0 AND COALESCE(e.expected_voters, 0) > 0 THEN e.expected_voters
    ELSE p.survey_expected_voters
  END,
  survey_status = CASE
    WHEN COALESCE(p.result_status, 'pending') IN ('finished', 'draw', 'not_played') THEN 'closed'
    ELSE COALESCE(p.survey_status, 'open')
  END
FROM eligible e
WHERE e.partido_id = p.id;

-- Backfill result_status from legacy winner fields on partidos.
UPDATE public.partidos p
SET result_status = CASE
  WHEN lower(COALESCE(p.winner_team, '')) IN ('a', 'equipo_a', 'team_a', 'b', 'equipo_b', 'team_b') THEN 'finished'
  WHEN lower(COALESCE(p.winner_team, '')) IN ('draw', 'empate') THEN 'draw'
  WHEN lower(COALESCE(p.winner_team, '')) IN ('not_played', 'cancelled', 'cancelado') THEN 'not_played'
  ELSE p.result_status
END
WHERE p.result_status = 'pending'
  AND p.winner_team IS NOT NULL;

-- Backfill result_status from survey_results legacy winner fields where partidos is still pending.
UPDATE public.partidos p
SET result_status = CASE
  WHEN lower(COALESCE(sr.winner_team, '')) IN ('a', 'equipo_a', 'team_a', 'b', 'equipo_b', 'team_b') THEN 'finished'
  WHEN lower(COALESCE(sr.winner_team, '')) IN ('draw', 'empate') THEN 'draw'
  WHEN lower(COALESCE(sr.winner_team, '')) IN ('not_played', 'cancelled', 'cancelado') THEN 'not_played'
  ELSE p.result_status
END
FROM public.survey_results sr
WHERE sr.partido_id = p.id
  AND p.result_status = 'pending'
  AND sr.winner_team IS NOT NULL;

UPDATE public.survey_results sr
SET result_status = CASE
  WHEN lower(COALESCE(sr.winner_team, '')) IN ('a', 'equipo_a', 'team_a', 'b', 'equipo_b', 'team_b') THEN 'finished'
  WHEN lower(COALESCE(sr.winner_team, '')) IN ('draw', 'empate') THEN 'draw'
  WHEN lower(COALESCE(sr.winner_team, '')) IN ('not_played', 'cancelled', 'cancelado') THEN 'not_played'
  ELSE sr.result_status
END
WHERE sr.result_status = 'pending'
  AND sr.winner_team IS NOT NULL;

UPDATE public.survey_results sr
SET finished_at = COALESCE(sr.finished_at, sr.encuesta_cerrada_at, now())
WHERE sr.result_status IN ('finished', 'draw')
  AND sr.finished_at IS NULL;

UPDATE public.partidos p
SET finished_at = COALESCE(p.finished_at, sr.finished_at, sr.encuesta_cerrada_at, now())
FROM public.survey_results sr
WHERE sr.partido_id = p.id
  AND p.result_status IN ('finished', 'draw')
  AND p.finished_at IS NULL;

UPDATE public.partidos
SET survey_status = 'closed'
WHERE result_status IN ('finished', 'draw', 'not_played');

-- Keep one award record per (partido, award_type) before adding unique key.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY partido_id, award_type
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.player_awards
)
DELETE FROM public.player_awards pa
USING ranked r
WHERE pa.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS player_awards_partido_award_type_uidx
  ON public.player_awards (partido_id, award_type);

COMMIT;
