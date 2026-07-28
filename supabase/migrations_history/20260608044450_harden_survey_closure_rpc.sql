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
  v_match record;
  v_row record;
  v_survey_status text;
  v_stored_expected_voters int := 0;
  v_stored_opened_at timestamptz := NULL;
  v_stored_closes_at timestamptz := NULL;
  v_kickoff_at timestamptz := NULL;
  v_canonical_opened_at timestamptz := NULL;
  v_canonical_closes_at timestamptz := NULL;
  v_effective_closes_at timestamptz := NULL;
  v_is_challenge_like_team_match boolean := false;
  v_eligible_user_ids uuid[] := ARRAY[]::uuid[];
  v_eligible_user_count int := 0;
  v_effective_expected_voters int := 0;
  v_submitted_voters int := 0;
  v_deadline_reached boolean := false;
  v_all_eligible_voted boolean := false;
  v_closure_allowed boolean := false;
BEGIN
  IF p_partido_id IS NULL OR p_partido_id <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_match_id');
  END IF;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  SELECT
    p.creado_por,
    p.survey_status,
    p.survey_opened_at,
    p.survey_expected_voters,
    p.survey_closes_at,
    p.result_status,
    p.winner_team,
    p.finished_at,
    p.estado,
    p.fecha,
    p.hora
  INTO v_match
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'match_not_found');
  END IF;

  SELECT (
    v_match.creado_por = v_uid
    OR EXISTS (
      SELECT 1
      FROM public.jugadores j
      WHERE j.partido_id = p_partido_id
        AND j.usuario_id = v_uid
    )
  )
  INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('success', false, 'reason', 'forbidden');
  END IF;

  v_survey_status := COALESCE(NULLIF(lower(trim(v_match.survey_status)), ''), 'open');

  IF v_survey_status = 'closed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'closed_by_this_call', false,
      'already_closed', true,
      'survey_status', v_match.survey_status,
      'result_status', v_match.result_status,
      'winner_team', v_match.winner_team,
      'finished_at', v_match.finished_at,
      'estado', v_match.estado
    );
  END IF;

  IF v_survey_status <> 'open' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'invalid_survey_status',
      'survey_status', v_match.survey_status
    );
  END IF;

  v_stored_expected_voters := GREATEST(COALESCE(v_match.survey_expected_voters, 0), 0);
  v_stored_opened_at := v_match.survey_opened_at;
  v_stored_closes_at := v_match.survey_closes_at;

  IF v_match.fecha IS NOT NULL
    AND v_match.hora IS NOT NULL
    AND replace(trim(v_match.hora::text), '.', ':') ~ '^[0-9]{1,2}:[0-9]{2}'
  THEN
    v_kickoff_at := (
      (
        v_match.fecha::timestamp
        + substring(replace(trim(v_match.hora::text), '.', ':') FROM '^[0-9]{1,2}:[0-9]{2}')::time
      )
      AT TIME ZONE 'America/Argentina/Buenos_Aires'
    );
  END IF;

  IF v_kickoff_at IS NULL THEN
    SELECT
      tm.scheduled_at,
      COALESCE(NULLIF(lower(trim(tm.origin_type)), ''), '') = 'challenge'
        OR tm.challenge_id IS NOT NULL
    INTO v_kickoff_at, v_is_challenge_like_team_match
    FROM public.team_matches tm
    WHERE tm.partido_id = p_partido_id
    ORDER BY tm.id ASC
    LIMIT 1;
  END IF;

  IF v_kickoff_at IS NOT NULL THEN
    v_canonical_opened_at := v_kickoff_at + CASE
      WHEN v_is_challenge_like_team_match THEN interval '0 hours'
      ELSE interval '1 hour'
    END;
    v_canonical_closes_at := v_canonical_opened_at + interval '24 hours';
  END IF;

  v_effective_closes_at := CASE
    WHEN v_canonical_closes_at IS NOT NULL
      AND (
        v_stored_opened_at IS NULL
        OR v_stored_closes_at IS NULL
        OR v_stored_closes_at <= v_canonical_opened_at
        OR abs(extract(epoch FROM (v_stored_opened_at - v_canonical_opened_at))) > 60
        OR abs(extract(epoch FROM (v_stored_closes_at - v_canonical_closes_at))) > 60
      )
      THEN v_canonical_closes_at
    ELSE v_stored_closes_at
  END;

  v_eligible_user_ids := COALESCE(
    public.resolve_partido_survey_notification_recipients(p_partido_id),
    ARRAY[]::uuid[]
  );
  v_eligible_user_count := COALESCE(array_length(v_eligible_user_ids, 1), 0);
  v_effective_expected_voters := GREATEST(
    v_stored_expected_voters,
    v_expected_voters,
    v_eligible_user_count
  );

  IF v_eligible_user_count > 0 THEN
    SELECT COUNT(DISTINCT j.usuario_id)::int
    INTO v_submitted_voters
    FROM public.post_match_surveys s
    JOIN public.jugadores j
      ON j.id = s.votante_id
     AND j.partido_id = s.partido_id
    WHERE s.partido_id = p_partido_id
      AND j.usuario_id = ANY(v_eligible_user_ids);
  ELSE
    SELECT COUNT(DISTINCT j.usuario_id)::int
    INTO v_submitted_voters
    FROM public.post_match_surveys s
    JOIN public.jugadores j
      ON j.id = s.votante_id
     AND j.partido_id = s.partido_id
    WHERE s.partido_id = p_partido_id
      AND j.usuario_id IS NOT NULL;
  END IF;

  v_submitted_voters := GREATEST(COALESCE(v_submitted_voters, 0), 0);
  v_deadline_reached := v_effective_closes_at IS NOT NULL AND now() >= v_effective_closes_at;
  v_all_eligible_voted := v_effective_expected_voters > 0
    AND v_submitted_voters >= v_effective_expected_voters;
  v_closure_allowed := v_all_eligible_voted OR v_deadline_reached;

  IF NOT v_closure_allowed THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'closure_not_ready',
      'survey_status', v_match.survey_status,
      'expected_voters', v_effective_expected_voters,
      'submitted_voters', v_submitted_voters,
      'remaining_votes', GREATEST(v_effective_expected_voters - v_submitted_voters, 0),
      'deadline_reached', v_deadline_reached,
      'all_eligible_voted', v_all_eligible_voted,
      'already_closed', false,
      'closed_by_this_call', false
    );
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
    survey_opened_at = COALESCE(p_opened_at, p.survey_opened_at, v_canonical_opened_at, now()),
    survey_closes_at = COALESCE(p_closes_at, p.survey_closes_at, v_canonical_closes_at, now()),
    survey_expected_voters = GREATEST(COALESCE(p.survey_expected_voters, 0), v_effective_expected_voters),
    result_status = v_result_status,
    winner_team = v_winner_team,
    finished_at = p_finished_at
  WHERE p.id = p_partido_id
    AND COALESCE(NULLIF(lower(trim(p.survey_status)), ''), 'open') = 'open'
    AND v_closure_allowed = true
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
      'estado', v_row.estado,
      'expected_voters', v_effective_expected_voters,
      'submitted_voters', v_submitted_voters,
      'deadline_reached', v_deadline_reached,
      'all_eligible_voted', v_all_eligible_voted
    );
  END IF;

  SELECT p.survey_status, p.result_status, p.winner_team, p.finished_at, p.estado
  INTO v_row
  FROM public.partidos p
  WHERE p.id = p_partido_id;

  RETURN jsonb_build_object(
    'success', true,
    'closed_by_this_call', false,
    'already_closed', COALESCE(NULLIF(lower(trim(v_row.survey_status)), ''), 'open') = 'closed',
    'survey_status', v_row.survey_status,
    'result_status', v_row.result_status,
    'winner_team', v_row.winner_team,
    'finished_at', v_row.finished_at,
    'estado', v_row.estado,
    'expected_voters', v_effective_expected_voters,
    'submitted_voters', v_submitted_voters,
    'deadline_reached', v_deadline_reached,
    'all_eligible_voted', v_all_eligible_voted
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.finalize_match_survey_closure(
  bigint, timestamptz, timestamptz, integer, text, text, timestamptz
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.finalize_match_survey_closure(
  bigint, timestamptz, timestamptz, integer, text, text, timestamptz
) TO service_role;

COMMIT;
