BEGIN;

DO $migration$
DECLARE
  v_fn text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.run_push_sender_scheduler_tick(text, integer, integer, integer)'::regprocedure)
  INTO v_fn;

  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Function public.run_push_sender_scheduler_tick(text, integer, integer, integer) not found';
  END IF;

  v_old := $$ELSIF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vault') THEN$$;
  v_new := $$ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname IN ('vault', 'supabase_vault')
  ) THEN$$;

  IF position(v_new IN v_fn) > 0 THEN
    RETURN;
  END IF;

  IF position(v_old IN v_fn) = 0 THEN
    RAISE EXCEPTION 'Could not find vault extension guard in public.run_push_sender_scheduler_tick()';
  END IF;

  v_fn := replace(v_fn, v_old, v_new);
  EXECUTE v_fn;
END;
$migration$;

COMMIT;
