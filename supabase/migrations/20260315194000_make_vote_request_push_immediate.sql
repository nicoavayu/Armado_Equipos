BEGIN;

DO $migration$
DECLARE
  v_fn text;
BEGIN
  SELECT pg_get_functiondef('public.enqueue_remote_push_from_notification()'::regprocedure)
  INTO v_fn;

  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Function public.enqueue_remote_push_from_notification() not found';
  END IF;

  -- JOIN_REQUEST remains admin-only/grouped. VOTE_REQUEST must fan out to players.
  v_fn := replace(
    v_fn,
    'IF v_channel IN (''JOIN_REQUEST'', ''VOTE_REQUEST'') AND v_partido_id IS NOT NULL THEN',
    'IF v_channel = ''JOIN_REQUEST'' AND v_partido_id IS NOT NULL THEN'
  );

  -- Vote requests should be allowed to re-fire immediately when the admin triggers them again.
  v_fn := replace(
    v_fn,
    'IF v_channel NOT IN (''CANCELLATION'', ''REMINDER'')',
    'IF v_channel NOT IN (''CANCELLATION'', ''REMINDER'', ''VOTE_REQUEST'')'
  );

  EXECUTE v_fn;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.reset_votacion(match_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.votos
  WHERE partido_id = match_id;

  DELETE FROM public.votos_publicos
  WHERE partido_id = match_id;

  DELETE FROM public.public_voters
  WHERE partido_id = match_id;

  UPDATE public.jugadores
  SET score = NULL
  WHERE partido_id = match_id;

  DELETE FROM public.notifications
  WHERE type IN ('call_to_vote', 'pre_match_vote')
    AND (
      partido_id = match_id
      OR match_ref = match_id
      OR COALESCE(data ->> 'match_id', '') = match_id::text
      OR COALESCE(data ->> 'matchId', '') = match_id::text
    );

  IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
    DELETE FROM public.notification_delivery_log
    WHERE partido_id = match_id
      AND (
        notification_type IN ('call_to_vote', 'pre_match_vote')
        OR COALESCE(payload_json ->> 'event_channel', '') = 'VOTE_REQUEST'
      );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_votacion(bigint) TO authenticated, service_role, anon;

COMMIT;
