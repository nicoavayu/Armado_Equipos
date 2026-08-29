BEGIN;

DO $migration$
DECLARE
  v_fn text;
  v_old_join text;
  v_new_join text;
  v_old_join_kicked text;
  v_new_join_kicked text;
BEGIN
  SELECT pg_get_functiondef('public.enqueue_remote_push_from_notification()'::regprocedure)
  INTO v_fn;

  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Function public.enqueue_remote_push_from_notification() not found';
  END IF;

  v_old_join := E'  IF v_channel = ''JOIN_REQUEST'' THEN\n    RETURN NEW;\n  END IF;\n\n  IF NOT public.notification_channel_allows_push(v_channel) THEN';
  v_new_join := E'  IF v_channel IN (''JOIN_REQUEST'', ''VOTE_REQUEST'') THEN\n    RETURN NEW;\n  END IF;\n\n  IF NOT public.notification_channel_allows_push(v_channel) THEN';

  v_old_join_kicked := E'  IF v_channel = ''JOIN_REQUEST'' THEN\n    RETURN NEW;\n  END IF;\n\n  IF NEW.type = ''match_kicked'' THEN\n    RETURN NEW;\n  END IF;\n\n  IF NOT public.notification_channel_allows_push(v_channel) THEN';
  v_new_join_kicked := E'  IF v_channel IN (''JOIN_REQUEST'', ''VOTE_REQUEST'') THEN\n    RETURN NEW;\n  END IF;\n\n  IF NEW.type = ''match_kicked'' THEN\n    RETURN NEW;\n  END IF;\n\n  IF NOT public.notification_channel_allows_push(v_channel) THEN';

  IF position(v_new_join IN v_fn) > 0 OR position(v_new_join_kicked IN v_fn) > 0 THEN
    RETURN;
  END IF;

  IF position(v_old_join_kicked IN v_fn) > 0 THEN
    v_fn := replace(v_fn, v_old_join_kicked, v_new_join_kicked);
  ELSIF position(v_old_join IN v_fn) > 0 THEN
    v_fn := replace(v_fn, v_old_join, v_new_join);
  ELSIF position(E'  IF NOT public.notification_channel_allows_push(v_channel) THEN' IN v_fn) > 0 THEN
    v_fn := replace(
      v_fn,
      E'  IF NOT public.notification_channel_allows_push(v_channel) THEN',
      E'  IF v_channel = ''VOTE_REQUEST'' THEN\n    RETURN NEW;\n  END IF;\n\n  IF NOT public.notification_channel_allows_push(v_channel) THEN'
    );
  ELSE
    RAISE EXCEPTION 'Could not patch enqueue_remote_push_from_notification()';
  END IF;

  EXECUTE v_fn;
END;
$migration$;

COMMIT;
