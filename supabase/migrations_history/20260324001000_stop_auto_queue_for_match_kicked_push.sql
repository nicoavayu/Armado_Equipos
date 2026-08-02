BEGIN;

DO $migration$
DECLARE
  v_fn text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.enqueue_remote_push_from_notification()'::regprocedure)
  INTO v_fn;

  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Function public.enqueue_remote_push_from_notification() not found';
  END IF;

  v_old := E'  IF v_channel = ''JOIN_REQUEST'' THEN\n    RETURN NEW;\n  END IF;\n\n  IF NOT public.notification_channel_allows_push(v_channel) THEN';
  v_new := E'  IF v_channel = ''JOIN_REQUEST'' THEN\n    RETURN NEW;\n  END IF;\n\n  IF NEW.type = ''match_kicked'' THEN\n    RETURN NEW;\n  END IF;\n\n  IF NOT public.notification_channel_allows_push(v_channel) THEN';

  IF position(v_new IN v_fn) > 0 THEN
    RETURN;
  END IF;

  IF position(v_old IN v_fn) > 0 THEN
    v_fn := replace(v_fn, v_old, v_new);
  ELSIF position(E'  IF NOT public.notification_channel_allows_push(v_channel) THEN' IN v_fn) > 0 THEN
    v_fn := replace(
      v_fn,
      E'  IF NOT public.notification_channel_allows_push(v_channel) THEN',
      E'  IF NEW.type = ''match_kicked'' THEN\n    RETURN NEW;\n  END IF;\n\n  IF NOT public.notification_channel_allows_push(v_channel) THEN'
    );
  ELSE
    RAISE EXCEPTION 'Could not patch enqueue_remote_push_from_notification()';
  END IF;

  EXECUTE v_fn;
END;
$migration$;

COMMIT;
