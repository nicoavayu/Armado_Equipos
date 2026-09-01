BEGIN;

-- Keep survey_progress as observability only.
-- This trigger must never enqueue "survey_results_ready" nor close surveys.
CREATE OR REPLACE FUNCTION public.check_survey_completion_from_post_match_surveys()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_response_count int;
BEGIN
  INSERT INTO public.survey_progress (
    partido_id,
    enabled_at,
    first_response_at,
    response_count,
    results_notified,
    created_at,
    updated_at
  )
  VALUES (NEW.partido_id, now(), NEW.created_at, 0, false, now(), now())
  ON CONFLICT (partido_id) DO NOTHING;

  SELECT COUNT(DISTINCT s.votante_id)
  INTO v_response_count
  FROM public.post_match_surveys s
  WHERE s.partido_id = NEW.partido_id;

  UPDATE public.survey_progress
  SET
    response_count = COALESCE(v_response_count, 0),
    first_response_at = COALESCE(first_response_at, NEW.created_at, now()),
    updated_at = now()
  WHERE partido_id = NEW.partido_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_post_match_survey_completion ON public.post_match_surveys;
CREATE TRIGGER trg_post_match_survey_completion
AFTER INSERT ON public.post_match_surveys
FOR EACH ROW
EXECUTE FUNCTION public.check_survey_completion_from_post_match_surveys();

COMMENT ON FUNCTION public.check_survey_completion_from_post_match_surveys()
IS 'Observability-only trigger: tracks survey_progress response_count. Does not notify or close surveys.';

-- Legacy trigger helper (on public.votos in older flows) must never notify either.
CREATE OR REPLACE FUNCTION public.check_survey_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.survey_progress (
    partido_id,
    enabled_at,
    first_response_at,
    response_count,
    results_notified,
    created_at,
    updated_at
  )
  VALUES (NEW.partido_id, now(), now(), 0, false, now(), now())
  ON CONFLICT (partido_id) DO NOTHING;

  UPDATE public.survey_progress
  SET
    response_count = COALESCE(response_count, 0) + 1,
    first_response_at = COALESCE(first_response_at, now()),
    updated_at = now()
  WHERE partido_id = NEW.partido_id;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.check_survey_completion()
IS 'Legacy compatibility only. Does not enqueue notifications or close surveys.';

-- Timeout helper stays callable but intentionally emits no user-facing readiness signals.
CREATE OR REPLACE FUNCTION public.check_survey_timeouts()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN jsonb_build_object(
    'success', true,
    'processed', 0,
    'disabled', true,
    'reason', 'finalization_is_controlled_by_finalizeIfComplete'
  );
END;
$function$;

COMMENT ON FUNCTION public.check_survey_timeouts()
IS 'Disabled legacy timeout notifier. Finalization now runs exclusively through finalizeIfComplete.';

-- One-time cleanup: suppress legacy readiness notifications that don't have
-- a real backing survey_results row in ready state.
UPDATE public.notifications n
SET
  read = true,
  status = 'suppressed_inconsistent'
WHERE n.type IN ('survey_results_ready', 'awards_ready')
  AND n.partido_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.survey_results sr
    WHERE sr.partido_id = n.partido_id
      AND sr.results_ready = true
      AND (
        n.type <> 'awards_ready'
        OR sr.mvp IS NOT NULL
        OR sr.golden_glove IS NOT NULL
        OR (array_length(sr.red_cards, 1) IS NOT NULL AND array_length(sr.red_cards, 1) > 0)
        OR NULLIF(sr.awards -> 'mvp' ->> 'player_id', '') IS NOT NULL
        OR NULLIF(sr.awards -> 'best_gk' ->> 'player_id', '') IS NOT NULL
        OR NULLIF(sr.awards -> 'red_card' ->> 'player_id', '') IS NOT NULL
      )
  );

-- Canonical, permission-safe survey closure gate.
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

  UPDATE public.partidos p
  SET
    survey_status = 'closed',
    survey_opened_at = COALESCE(p.survey_opened_at, p_opened_at, now()),
    survey_closes_at = COALESCE(p.survey_closes_at, p_closes_at, now()),
    survey_expected_voters = GREATEST(COALESCE(p.survey_expected_voters, 0), v_expected_voters),
    result_status = v_result_status,
    winner_team = v_winner_team,
    finished_at = p_finished_at
  WHERE p.id = p_partido_id
    AND COALESCE(p.survey_status, 'open') = 'open'
  RETURNING p.survey_status, p.result_status, p.winner_team, p.finished_at
  INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'closed_by_this_call', true,
      'already_closed', false,
      'survey_status', v_row.survey_status,
      'result_status', v_row.result_status,
      'winner_team', v_row.winner_team,
      'finished_at', v_row.finished_at
    );
  END IF;

  SELECT p.survey_status, p.result_status, p.winner_team, p.finished_at
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
    'finished_at', v_row.finished_at
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
