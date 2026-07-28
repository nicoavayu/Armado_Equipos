BEGIN;

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
      OR COALESCE(data ->> 'match_id', '') = match_id::text
      OR COALESCE(data ->> 'matchId', '') = match_id::text
      OR COALESCE(data ->> 'partido_id', '') = match_id::text
      OR COALESCE(data ->> 'partidoId', '') = match_id::text
    );

  IF to_regclass('public.notification_delivery_log') IS NOT NULL THEN
    DELETE FROM public.notification_delivery_log
    WHERE partido_id = match_id
      AND (
        notification_type IN ('call_to_vote', 'pre_match_vote')
        OR COALESCE(payload_json ->> 'event_channel', '') = 'VOTE_REQUEST'
        OR COALESCE(payload_json ->> 'eventType', '') = 'call_to_vote'
        OR COALESCE(payload_json ->> 'match_id', '') = match_id::text
        OR COALESCE(payload_json ->> 'matchId', '') = match_id::text
      );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_votacion(bigint) TO authenticated, service_role, anon;

COMMIT;
