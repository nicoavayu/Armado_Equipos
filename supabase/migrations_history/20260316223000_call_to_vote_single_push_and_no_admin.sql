BEGIN;

CREATE OR REPLACE FUNCTION public.send_call_to_vote(
  p_partido_id bigint,
  p_title text DEFAULT '¡Hora de votar!',
  p_message text DEFAULT 'Entrá a la app y calificá a los jugadores para armar los equipos.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_affected int := 0;
  v_match_code text;
BEGIN
  SELECT codigo
  INTO v_match_code
  FROM public.partidos
  WHERE id = p_partido_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido % not found', p_partido_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications
    WHERE (
      (data ->> 'match_id')::text = p_partido_id::text
      OR (data ->> 'matchId')::text = p_partido_id::text
    )
    AND type IN ('survey_start', 'post_match_survey', 'survey_reminder')
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'survey_exists');
  END IF;

  WITH recipients AS (
    SELECT DISTINCT j.usuario_id AS user_id
    FROM public.jugadores j
    WHERE j.partido_id = p_partido_id
      AND j.usuario_id IS NOT NULL
  ),
  upserted AS (
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      partido_id,
      data,
      read,
      created_at,
      send_at
    )
    SELECT
      r.user_id,
      p_title,
      p_message,
      'call_to_vote',
      p_partido_id,
      jsonb_build_object(
        'match_id', p_partido_id::text,
        'matchId', p_partido_id,
        'matchCode', v_match_code
      ),
      false,
      now(),
      now()
    FROM recipients r
    ON CONFLICT (user_id, (data ->> 'match_id'), type)
    DO UPDATE SET
      title = EXCLUDED.title,
      message = EXCLUDED.message,
      partido_id = EXCLUDED.partido_id,
      data = EXCLUDED.data,
      read = false,
      send_at = now()
    RETURNING id
  )
  SELECT count(*) INTO v_rows_affected FROM upserted;

  RETURN jsonb_build_object('success', true, 'inserted', v_rows_affected);
END;
$$;

DO $migration$
DECLARE
  v_fn text;
BEGIN
  SELECT pg_get_functiondef('public.enqueue_remote_push_from_notification()'::regprocedure)
  INTO v_fn;

  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Function public.enqueue_remote_push_from_notification() not found';
  END IF;

  v_fn := replace(
    v_fn,
    E'  IF v_partido_id IS NOT NULL\n     AND COALESCE(v_is_active, false)\n     AND v_last_seen_partido_id = v_partido_id\n     AND v_channel NOT IN (''VOTE_REQUEST'', ''CANCELLATION'')\n  THEN',
    E'  IF v_partido_id IS NOT NULL\n     AND COALESCE(v_is_active, false)\n     AND v_last_seen_partido_id = v_partido_id\n     AND v_channel NOT IN (''CANCELLATION'')\n  THEN'
  );

  EXECUTE v_fn;
END;
$migration$;

COMMIT;
