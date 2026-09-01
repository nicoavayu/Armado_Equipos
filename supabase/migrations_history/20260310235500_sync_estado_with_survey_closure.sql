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
    survey_opened_at = COALESCE(p.survey_opened_at, p_opened_at, now()),
    survey_closes_at = COALESCE(p.survey_closes_at, p_closes_at, now()),
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

-- Keep legacy estado aligned for matches already closed by survey lifecycle.
UPDATE public.partidos p
SET estado = 'finalizado'
WHERE COALESCE(p.survey_status, 'open') = 'closed'
  AND COALESCE(p.result_status, 'pending') IN ('finished', 'draw')
  AND COALESCE(lower(p.estado), 'active') IN ('active', 'activo');

UPDATE public.partidos p
SET estado = 'cancelado'
WHERE COALESCE(p.survey_status, 'open') = 'closed'
  AND COALESCE(p.result_status, 'pending') = 'not_played'
  AND COALESCE(lower(p.estado), 'active') IN ('active', 'activo');

COMMIT;
