BEGIN;

CREATE OR REPLACE FUNCTION public.finalize_match_survey_closure(
  p_partido_id bigint,
  p_opened_at timestamptz,
  p_closes_at timestamptz,
  p_expected_voters integer,
  p_result_status text,
  p_winner_team text,
  p_finished_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_authorized boolean := false;
  v_expected_voters int := GREATEST(COALESCE(p_expected_voters, 0), 0);
  v_result_status text := COALESCE(NULLIF(trim(p_result_status), ''), 'pending');
  v_winner_team text := NULLIF(trim(COALESCE(p_winner_team, '')), '');
  v_target_estado text := 'active';
  v_row record;
BEGIN
  IF p_partido_id IS NULL OR p_partido_id <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_match_id');
  END IF;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  SELECT (
    p.creado_por = v_uid
    OR EXISTS (
      SELECT 1
      FROM public.jugadores j
      WHERE j.partido_id = p.id
        AND j.usuario_id = v_uid
    )
  )
  INTO v_is_authorized
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'match_not_found');
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('success', false, 'reason', 'forbidden');
  END IF;

  v_target_estado := CASE
    WHEN v_result_status IN ('finished', 'draw') THEN 'finalizado'
    WHEN v_result_status = 'not_played' THEN 'cancelado'
    ELSE 'active'
  END;

  UPDATE public.partidos p
  SET
    estado = CASE
      WHEN v_result_status IN ('finished', 'draw', 'not_played') THEN v_target_estado
      ELSE COALESCE(NULLIF(p.estado, ''), 'active')
    END,
    survey_status = 'closed',
    -- Keep canonical values provided by finalizer; stale rows should not survive by COALESCE.
    survey_opened_at = COALESCE(p_opened_at, p.survey_opened_at, now()),
    survey_closes_at = COALESCE(p_closes_at, p.survey_closes_at, now()),
    survey_expected_voters = GREATEST(COALESCE(p.survey_expected_voters, 0), v_expected_voters),
    result_status = v_result_status,
    winner_team = v_winner_team,
    finished_at = p_finished_at
  WHERE p.id = p_partido_id
    AND COALESCE(p.survey_status, 'open') = 'open'
  RETURNING p.survey_status, p.result_status, p.winner_team, p.finished_at, p.estado
  INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'closed_by_this_call', true,
      'already_closed', false,
      'survey_status', v_row.survey_status,
      'result_status', v_row.result_status,
      'winner_team', v_row.winner_team,
      'finished_at', v_row.finished_at,
      'estado', v_row.estado
    );
  END IF;

  SELECT p.survey_status, p.result_status, p.winner_team, p.finished_at, p.estado
  INTO v_row
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  RETURN jsonb_build_object(
    'success', true,
    'closed_by_this_call', false,
    'already_closed', COALESCE(v_row.survey_status, 'open') = 'closed',
    'survey_status', v_row.survey_status,
    'result_status', v_row.result_status,
    'winner_team', v_row.winner_team,
    'finished_at', v_row.finished_at,
    'estado', v_row.estado
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_reset_survey_window_on_schedule_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.fecha IS DISTINCT FROM OLD.fecha OR NEW.hora IS DISTINCT FROM OLD.hora) THEN
    IF COALESCE(NEW.result_status, 'pending') = 'pending'
      AND COALESCE(lower(NEW.estado), 'active') NOT IN ('cancelado', 'cancelled', 'deleted')
    THEN
      NEW.survey_opened_at := NULL;
      NEW.survey_closes_at := NULL;
      NEW.survey_expected_voters := NULL;
      NEW.survey_status := 'open';
      NEW.surveys_sent := false;
      NEW.winner_team := NULL;
      NEW.finished_at := NULL;
      -- Keep compatibility with legacy schema variants where this column may/may not exist.
      NEW := jsonb_populate_record(NEW, jsonb_build_object('survey_deadline_at', NULL));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_survey_window_on_schedule_change ON public.partidos;
CREATE TRIGGER trg_reset_survey_window_on_schedule_change
BEFORE UPDATE OF fecha, hora
ON public.partidos
FOR EACH ROW
EXECUTE FUNCTION public.trg_reset_survey_window_on_schedule_change();

WITH normalized AS (
  SELECT
    p.id,
    CASE
      WHEN p.fecha IS NULL OR p.hora IS NULL THEN NULL::timestamptz
      WHEN replace(trim(p.hora), '.', ':') !~ '^[0-9]{1,2}:[0-9]{2}' THEN NULL::timestamptz
      ELSE (
        (p.fecha::timestamp + substring(replace(trim(p.hora), '.', ':') FROM '^[0-9]{1,2}:[0-9]{2}')::time)
        AT TIME ZONE 'America/Argentina/Buenos_Aires'
      )
    END AS kickoff_at
  FROM public.partidos p
  WHERE COALESCE(p.survey_status, 'open') = 'open'
    AND COALESCE(p.result_status, 'pending') = 'pending'
),
windows AS (
  SELECT
    n.id,
    n.kickoff_at + interval '1 hour' AS expected_open_at,
    n.kickoff_at + interval '25 hours' AS expected_close_at
  FROM normalized n
  WHERE n.kickoff_at IS NOT NULL
)
UPDATE public.partidos p
SET
  survey_opened_at = w.expected_open_at,
  survey_closes_at = w.expected_close_at,
  survey_status = 'open',
  surveys_sent = CASE
    WHEN now() < w.expected_open_at THEN false
    ELSE COALESCE(p.surveys_sent, false)
  END
FROM windows w
WHERE p.id = w.id
  AND (
    p.survey_opened_at IS NULL
    OR p.survey_closes_at IS NULL
    OR p.survey_closes_at <= p.survey_opened_at
    OR p.survey_closes_at <= w.expected_open_at
    OR abs(extract(epoch FROM (p.survey_opened_at - w.expected_open_at))) > 60
    OR abs(extract(epoch FROM (p.survey_closes_at - w.expected_close_at))) > 60
  );

COMMIT;
