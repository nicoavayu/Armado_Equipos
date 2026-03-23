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

  -- match_join_request already has an explicit immediate dispatch path.
  -- Skip the generic notification-triggered push queue to avoid double sends.
  v_fn := replace(
    v_fn,
    E'  IF NOT public.notification_channel_allows_push(v_channel) THEN',
    E'  IF v_channel = ''JOIN_REQUEST'' THEN\n    RETURN NEW;\n  END IF;\n\n  IF NOT public.notification_channel_allows_push(v_channel) THEN'
  );

  EXECUTE v_fn;
END;
$migration$;

COMMIT;
